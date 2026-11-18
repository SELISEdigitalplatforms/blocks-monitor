/** What MADP produced (/p/:id/produced): everything the agents saved for the project, by part (requirements, planning,
 *  builds, releases …), each file with Open and Download. The list and the files come from the app's server. */
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Download, ExternalLink, File, FileCode, FileText, FolderOpen, Globe, Image as ImageIcon, RefreshCw, ScrollText, FileOutput } from "lucide-react";
import { useProject } from "@/madp/blocks/projects/reads";
import { useBlocksContext } from "@/madp/blocks/context";
import { EngineJobStatus } from "@/madp/components/engine/EngineJobStatus";
import { retryEngineJob, engineErrorMessage } from "@/madp/blocks/engine/actions";
import { useEngineJobs } from "@/madp/blocks/engine/jobs";
import { isActiveEngineJob, latestEngineJob } from "@/madp/blocks/engine/types";
import { callFunction, FunctionError, newRequestId } from "@/madp/blocks/fn";
import { queryClient } from "@/madp/blocks/queryClient";
import { Markdown } from "@/madp/components/wiki/Markdown";
import {
  OUTPUT_KIND_LABEL, OUTPUT_STATUS, READER_MAX_BYTES, fetchOutputText, fetchOutputs, groupOutputItems, outputFileCount, outputFileUrl,
  outputSize, readsInApp, type OutputItem, type OutputSection, type OutputsManifest, type OutputsResult,
} from "@/madp/data/outputs";
import { formatDateTime } from "@/madp/lib/dates";
import { t, useT } from "@/madp/i18n";
import { Banner, Button, Card, Chip, EmptyState, Modal, PageHeader } from "@/madp/ui/kit";
import { cn } from "@/madp/lib/cn";

const PAGE = "flex w-full min-w-0 flex-col";
/** The page title, in the current language. */
const title = (): string => t("build.produced.title", "What MADP produced");
/** A file kind and a status in the current language (src/data/outputs.ts keeps the English and the tones). */
const kindLabel = (kind: OutputItem["kind"]): string => ({
  md: t("build.produced.kind.md", "Document"), yaml: t("build.produced.kind.data", "Data file"), json: t("build.produced.kind.data", "Data file"),
  html: t("build.produced.kind.html", "Web page"), png: t("build.produced.kind.png", "Image"), log: t("build.produced.kind.log", "Work log"),
  txt: t("build.produced.kind.txt", "Text"), other: t("build.produced.kind.other", "File"),
} as Record<string, string>)[kind] ?? OUTPUT_KIND_LABEL[kind];
const statusLabel = (status: keyof typeof OUTPUT_STATUS): string => ({
  pass: t("build.produced.status.pass", "Passed"), fail: t("build.produced.status.fail", "Failed"), hold: t("build.produced.status.hold", "On hold"),
  open: t("build.produced.status.open", "Still open"), info: t("build.produced.status.info", "For information"),
} as Record<string, string>)[status] ?? OUTPUT_STATUS[status].label;
const fileCount = (n: number): string => (n === 1 ? t("build.produced.fileOne", "1 file") : t("build.produced.files", "{count} files", { count: n }));
/** A section shows this many files until "Show all" is pressed. */
export const SECTION_PREVIEW = 12;

const LINK_BUTTON = "inline-flex h-8 items-center justify-center gap-1.5 whitespace-nowrap rounded-full bg-surface2 px-3.5 text-[13px] font-medium text-ink outline-none transition hover:bg-line focus-visible:ring-2 focus-visible:ring-accent/50";

export const outputsQueryKey = (projectId: string) => ["madp-outputs", projectId] as const;

// ── Generate Docs on demand (Agent 06-docs outside the pipeline) ────────────

/** Request docs.generate through the collab function — same pattern as wiki.generate. */
async function generateDocs(projectId: string, requestId: string): Promise<{ jobId: string; existing: boolean }> {
  const res = await callFunction<{ jobId?: unknown; existing?: unknown }>("collab", "docs.generate", { projectId }, { requestId });
  if (typeof res.data.jobId !== "string" || res.data.jobId === "") throw new FunctionError("unknown", t("build.produced.notQueued", "The docs job could not be queued."), res.requestId);
  void queryClient.invalidateQueries({ predicate: (q) => q.queryKey[0] === "ws" && q.queryKey[2] === "EngineJob" });
  return { jobId: res.data.jobId, existing: res.data.existing === true };
}

/** Hook to trigger and track a docs.generate engine job — same pattern as wiki.generate. */
function useDocsGenerate(projectId: string) {
  const jobsQuery = useEngineJobs(projectId, ["docs.generate"]);
  const jobs = jobsQuery.data ?? [];
  const job = latestEngineJob(jobs, "docs.generate");
  const active = job !== null && isActiveEngineJob(job);
  const [requestId, setRequestId] = useState(newRequestId);
  const [requesting, setRequesting] = useState(false);
  const [retrying, setRetrying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // a failed docs job is started again by someone who may (job.retry: wiki.edit, as the wiki's own job)
  const canRetry = useBlocksContext().can("wiki.edit");

  const start = async () => {
    setError(null);
    setRequesting(true);
    try {
      await generateDocs(projectId, requestId);
      setRequestId(newRequestId());
    } catch (e) { setError(engineErrorMessage(e)); }
    finally { setRequesting(false); }
  };
  const retry = async () => {
    if (!job) return;
    setRetrying(true);
    setError(null);
    try { await retryEngineJob(job.id); } catch (e) { setError(engineErrorMessage(e)); } finally { setRetrying(false); }
  };
  return { job, active, requesting, error, start, retry, retrying, canRetry };
}

/** Compact status line for the docs generation job. */
function DocsJobLine({ gen }: { gen: ReturnType<typeof useDocsGenerate> }) {
  if (!gen.job && !gen.error) return null;
  return (
    <div role="status" className="mb-6">
      <EngineJobStatus job={gen.job} variant="compact" canRetry={gen.canRetry} onRetry={gen.retry} retrying={gen.retrying} requestError={gen.error} />
    </div>
  );
}

export function ProducedView({ projectId }: { projectId: string }) {
  const t = useT();
  const project = useProject(projectId).data;
  const q = useQuery({
    queryKey: outputsQueryKey(projectId),
    queryFn: ({ signal }) => fetchOutputs(projectId, signal),
    staleTime: 30_000,
    retry: false,
  });
  const gen = useDocsGenerate(projectId);
  // Refresh outputs when the docs job finishes
  const wasActive = useRef(false);
  useEffect(() => {
    if (wasActive.current && !gen.active) void q.refetch();
    wasActive.current = gen.active;
  }, [gen.active, q]);
  const eyebrow = [project?.clientName?.trim() ?? "", (project?.name ?? "").trim()].filter(Boolean).join(" · ") || t("build.produced.project", "Project");
  return (
    <ProducedContent projectId={projectId} eyebrow={eyebrow} result={q.data ?? null} refreshing={q.isFetching} onRefresh={() => void q.refetch()} gen={gen} />
  );
}

/** The page for one answer (null while it loads); separate from the read so every state renders on its own. */
export function ProducedContent({ projectId, eyebrow, result, refreshing = false, onRefresh, gen }: {
  projectId: string; eyebrow: string; result: OutputsResult | null; refreshing?: boolean; onRefresh?: () => void;
  gen?: ReturnType<typeof useDocsGenerate>;
}) {
  const t = useT();
  const TITLE = title();
  const refresh = (
    <div className="flex items-center gap-2">
      {gen && (
        <Button variant="secondary" size="sm" icon={<FileOutput size={14} strokeWidth={1.75} aria-hidden />}
          disabled={gen.active || gen.requesting} onClick={() => void gen.start()}>
          {gen.requesting ? t("build.produced.starting", "Starting…") : gen.active ? t("build.produced.generating", "Generating…") : t("build.produced.generate", "Generate docs")}
        </Button>
      )}
      {onRefresh && (
        <Button variant="ghost" size="sm" disabled={refreshing} onClick={onRefresh} icon={<RefreshCw size={14} strokeWidth={1.75} aria-hidden className={cn(refreshing && "animate-spin motion-reduce:animate-none")} />}>
          {refreshing ? t("build.produced.refreshing", "Refreshing…") : t("build.produced.refresh", "Refresh")}
        </Button>
      )}
    </div>
  );
  if (result === null) {
    return (
      <div className={PAGE} aria-busy="true">
        <PageHeader eyebrow={eyebrow} title={TITLE} />
        <p role="status" className="sr-only">{t("build.produced.loading", "Loading what MADP produced…")}</p>
        <div aria-hidden className="flex flex-col gap-4">
          <div className="hatched h-20 rounded-card bg-surface/60" />
          <div className="hatched h-48 rounded-card bg-surface/60" />
        </div>
      </div>
    );
  }
  if (result.status === "signed-out") {
    return (
      <div className={PAGE}>
        <PageHeader eyebrow={eyebrow} title={TITLE} />
        <Banner tone="warning" title={t("build.produced.signedOutTitle", "You are signed out.")} text={t("build.produced.signedOutText", "Sign in again to see what MADP produced for this project.")}
          action={<Link to="/sign-in" className={LINK_BUTTON}>{t("build.produced.signIn", "Sign in")}</Link>} />
      </div>
    );
  }
  if (result.status === "unavailable") {
    return (
      <div className={PAGE}>
        <PageHeader eyebrow={eyebrow} title={TITLE} />
        <Banner tone="danger" title={t("build.produced.unavailableTitle", "This can't be shown right now.")} text={t("build.produced.unavailableText", "What MADP produced is not available at the moment. Try again in a little while.")}
          action={onRefresh && <Button size="sm" variant="ghost" disabled={refreshing} onClick={onRefresh}>{refreshing ? t("build.produced.trying", "Trying…") : t("build.preview.tryAgain", "Try again")}</Button>} />
      </div>
    );
  }
  const m = result.status === "ok" ? result.manifest : null;
  if (!m || outputFileCount(m) === 0) {
    return (
      <div className={PAGE}>
        <PageHeader eyebrow={eyebrow} title={TITLE} actions={refresh} />
        {gen && <DocsJobLine gen={gen} />}
        <Card>
          <EmptyState icon={<FolderOpen size={28} strokeWidth={1.5} />} title={t("build.produced.emptyTitle", "Nothing here yet")}
            text={t("build.produced.emptyText", "MADP saves what it produces here as it works on the project.")} />
        </Card>
      </div>
    );
  }
  return <ProducedManifest projectId={projectId} eyebrow={eyebrow} manifest={m} refresh={refresh} gen={gen} />;
}

function ProducedManifest({ projectId, eyebrow, manifest, refresh, gen }: { projectId: string; eyebrow: string; manifest: OutputsManifest; refresh: ReactNode; gen?: ReturnType<typeof useDocsGenerate> }) {
  const t = useT();
  const TITLE = title();
  const [reading, setReading] = useState<OutputItem | null>(null);
  const updated = formatDateTime(manifest.generatedAt);
  const subtitle = (
    <>
      {manifest.summary && <span className="block">{manifest.summary}</span>}
      <span className="num mt-1 block text-[13px] text-ink3">
        {[fileCount(outputFileCount(manifest)), updated && t("build.produced.updated", "updated {at}", { at: updated })].filter(Boolean).join(" · ")}
      </span>
    </>
  );
  return (
    <div className={PAGE}>
      <PageHeader eyebrow={eyebrow} title={TITLE} subtitle={subtitle} actions={refresh} />
      {gen && <DocsJobLine gen={gen} />}
      {manifest.facts.length > 0 && (
        <dl aria-label={t("build.produced.glance", "At a glance")} className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 2xl:grid-cols-6">
          {manifest.facts.map((f, i) => (
            <div key={`${f.label}-${i}`} className="min-w-0 rounded-block bg-surface px-4 py-3 shadow-card dark:ring-1 dark:ring-line">
              <dt className="truncate text-[12px] text-ink3" title={f.label}>{f.label}</dt>
              <dd className="num mt-1 break-words text-[18px] font-medium leading-6 tracking-tight text-ink">{f.value}</dd>
            </div>
          ))}
        </dl>
      )}
      <div className="flex min-w-0 flex-col gap-6">
        {manifest.sections.map((s) => <SectionCard key={s.id} projectId={projectId} section={s} onRead={setReading} />)}
      </div>
      <Reader projectId={projectId} item={reading} onClose={() => setReading(null)} />
    </div>
  );
}

function SectionCard({ projectId, section, onRead }: { projectId: string; section: OutputSection; onRead: (item: OutputItem) => void }) {
  const t = useT();
  const [all, setAll] = useState(false);
  const total = section.items.length;
  const shown = all ? section.items : section.items.slice(0, SECTION_PREVIEW);
  const groups = groupOutputItems(shown);
  return (
    <div id={`produced-${section.id}`} className="min-w-0 scroll-mt-[calc(var(--project-nav-h,var(--topbar-h,0px))+24px)]">
      <Card title={section.title} action={<Chip>{fileCount(total)}</Chip>}>
        {section.summary && <p className="text-[14px] text-ink2">{section.summary}</p>}
        {total === 0 ? (
          <p className={cn("text-[13px] text-ink3", section.summary && "mt-3")}>{t("build.produced.sectionEmpty", "Nothing saved in this part yet.")}</p>
        ) : (
          <div className={cn("flex min-w-0 flex-col gap-4", section.summary && "mt-4")}>
            {groups.map((g, i) => (
              <div key={g.group ?? `loose-${i}`} className="min-w-0">
                {g.group && <h4 className="mb-1 text-[12px] font-medium uppercase tracking-wider text-ink3">{g.group}</h4>}
                <ul className="divide-y divide-line">
                  {g.items.map((item) => <ItemRow key={item.path} projectId={projectId} item={item} onRead={onRead} />)}
                </ul>
              </div>
            ))}
            {total > SECTION_PREVIEW && (
              <div>
                <Button variant="ghost" size="sm" aria-expanded={all} onClick={() => setAll((v) => !v)}>
                  {all ? t("build.produced.showFewer", "Show fewer") : t("build.produced.showAll", "Show all {count} files", { count: total })}
                </Button>
              </div>
            )}
          </div>
        )}
      </Card>
    </div>
  );
}

function KindIcon({ kind }: { kind: OutputItem["kind"] }) {
  const p = { size: 16, strokeWidth: 1.75, "aria-hidden": true } as const;
  switch (kind) {
    case "md": case "txt": return <FileText {...p} />;
    case "yaml": case "json": return <FileCode {...p} />;
    case "html": return <Globe {...p} />;
    case "png": return <ImageIcon {...p} />;
    case "log": return <ScrollText {...p} />;
    default: return <File {...p} />;
  }
}

function ItemRow({ projectId, item, onRead }: { projectId: string; item: OutputItem; onRead: (item: OutputItem) => void }) {
  const t = useT();
  const status = item.status ? { ...OUTPUT_STATUS[item.status], label: statusLabel(item.status) } : null;
  const updated = formatDateTime(item.updatedAt);
  const meta = [kindLabel(item.kind), outputSize(item.bytes), updated].filter(Boolean).join(" · ");
  const inApp = readsInApp(item.kind) && item.bytes <= READER_MAX_BYTES;
  return (
    <li className="flex min-w-0 flex-wrap items-start gap-x-4 gap-y-2 py-3">
      <span className="mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-full bg-surface2 text-ink2"><KindIcon kind={item.kind} /></span>
      <div className="min-w-0 flex-1 basis-56">
        <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
          <p className="min-w-0 break-words text-[14px] font-medium text-ink" title={item.path}>{item.title}</p>
          {status && <Chip tone={status.tone}>{status.label}</Chip>}
        </div>
        {item.summary && <p className="mt-0.5 break-words text-[13px] leading-5 text-ink2">{item.summary}</p>}
        <p className="num mt-0.5 text-[12px] text-ink3">{meta}</p>
      </div>
      <div className="flex shrink-0 items-center gap-2 max-sm:pl-12">
        {inApp ? (
          <Button variant="ghost" size="sm" onClick={() => onRead(item)} aria-label={t("build.produced.openItem", "Open {title}", { title: item.title })}>{t("build.produced.open", "Open")}</Button>
        ) : (
          <a href={outputFileUrl(projectId, item.path)} target="_blank" rel="noopener noreferrer" className={LINK_BUTTON} aria-label={t("build.produced.openItemTab", "Open {title} in a new tab", { title: item.title })}>
            {t("build.produced.open", "Open")}<ExternalLink size={13} strokeWidth={1.75} aria-hidden />
          </a>
        )}
        <a href={outputFileUrl(projectId, item.path, true)} download className={LINK_BUTTON} aria-label={t("build.produced.downloadItem", "Download {title}", { title: item.title })}>
          <Download size={14} strokeWidth={1.75} aria-hidden />{t("build.proofDrawer.download", "Download")}
        </a>
      </div>
    </li>
  );
}

/** The in-app reader: documents as formatted text, data files and logs as they are, images as images. */
function Reader({ projectId, item, onClose }: { projectId: string; item: OutputItem | null; onClose: () => void }) {
  const t = useT();
  return (
    <Modal open={item !== null} onClose={onClose} width={960} title={item?.title ?? ""}
      footer={item && (
        <>
          <a href={outputFileUrl(projectId, item.path)} target="_blank" rel="noopener noreferrer" className={LINK_BUTTON}>
            {t("build.produced.openTab", "Open in a new tab")}<ExternalLink size={13} strokeWidth={1.75} aria-hidden />
          </a>
          <a href={outputFileUrl(projectId, item.path, true)} download className={LINK_BUTTON}>
            <Download size={14} strokeWidth={1.75} aria-hidden />{t("build.proofDrawer.download", "Download")}
          </a>
        </>
      )}>
      {item && (item.kind === "png"
        ? <img src={outputFileUrl(projectId, item.path)} alt={item.title} className="mx-auto max-h-[70dvh] max-w-full rounded-block" />
        : <ReaderText projectId={projectId} item={item} />)}
    </Modal>
  );
}

function ReaderText({ projectId, item }: { projectId: string; item: OutputItem }) {
  const t = useT();
  const q = useQuery({
    queryKey: [...outputsQueryKey(projectId), "file", item.path, item.updatedAt],
    queryFn: ({ signal }) => fetchOutputText(projectId, item, signal),
    staleTime: 60_000,
    retry: false,
  });
  const r = q.data;
  if (!r) {
    return (
      <>
        <p role="status" className="sr-only">{t("build.produced.loadingFile", "Loading the file…")}</p>
        <div aria-hidden className="hatched h-48 rounded-block bg-surface2/60" />
      </>
    );
  }
  if (r.status === "too-large") return <p className="text-[14px] text-ink2">{t("build.produced.tooLarge", "This file is too large to read here. Open it in a new tab or download it.")}</p>;
  if (r.status === "signed-out") return <p role="alert" className="text-[14px] text-danger">{t("build.produced.fileSignedOut", "You are signed out. Sign in again to read this file.")}</p>;
  if (r.status === "unavailable") return <p role="alert" className="text-[14px] text-danger">{t("build.produced.fileUnavailable", "This file can't be read right now. Try again in a little while.")}</p>;
  if (!r.text.trim()) return <p className="text-[14px] text-ink3">{t("build.produced.fileEmpty", "This file is empty.")}</p>;
  if (item.kind === "md") return <Markdown md={r.text} compact />;
  return (
    <pre className="scroll-thin overflow-x-auto whitespace-pre-wrap break-words rounded-block bg-surface2 p-4 font-mono text-[12.5px] leading-5 text-ink">{r.text}</pre>
  );
}
