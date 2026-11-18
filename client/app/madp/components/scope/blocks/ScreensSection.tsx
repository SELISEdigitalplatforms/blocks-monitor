/** The Screens section of the scope page. Screens are the output of the design.generate engine job: nothing is
 *  shown that the engine did not return, and while it has not run the job's real state is shown instead. */
import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { EngineJobStatus } from "@/madp/components/engine/EngineJobStatus";
import { retryEngineJob } from "@/madp/blocks/engine/actions";
import type { ScopeContext } from "@/madp/blocks/scope/context";
import {
  useDesignBrief, useDesignScreens, useFeatures, usePreviousScreens, useScopeJobs, useScopeVersion, useScreenUrls, useScreenVersions,
} from "@/madp/blocks/scope/hooks";
import type { DesignScreenRecord, FeatureRecord } from "@/madp/blocks/scope/records";
import { scopeErrorMessage } from "@/madp/blocks/scope/messages";
import { FEEDBACK_RESOLVE_PERMISSION, useFeedbackSetStatus } from "@/madp/blocks/scope/mutations";
import { useProjectThreads } from "@/madp/blocks/collab/feedback";
import { threadKey } from "@/madp/domain/feedback";
import { requirementsDesignPath } from "../links";
import { DesignCard } from "../DesignCard";
import { DesignPreviewModal, type PreviewPrevious, type PreviewThread } from "../DesignPreviewModal";
import { Layers, Maximize2 } from "lucide-react";
import { Button, Modal } from "@/madp/ui/kit";
import { parseProductPrototype } from "@/madp/domain/factoryDesign";
import { DesignViewer } from "@/madp/components/design/DesignViewer";
import { useRequirements } from "@/madp/blocks/requirements/hooks";
import { useT } from "@/madp/i18n";

const EMPTY: FeatureRecord[] = [];
/** Re-reads of the screens when the finished job names screens the list does not hold yet (the list can lag a moment). */
const SCREEN_REREADS = 4;
const REREAD_MS = 3000;

/** True only when the finished design job truly left no screens: the screens were read again after the job was seen
 *  finished, no read is on its way, and either the job names no screens or the re-reads that it does all came back empty. */
export function designCameBackEmpty(i: {
  succeeded: boolean; screenCount: number; jobNamesScreens: boolean;
  readAfterDone: boolean; fetching: boolean; rereads: number;
}): boolean {
  if (!i.succeeded || i.screenCount > 0 || !i.readAfterDone || i.fetching) return false;
  return !i.jobNamesScreens || i.rereads >= SCREEN_REREADS;
}

export function ScreensSection({ ctx, locked, preview, onPreviewChange }: {
  ctx: ScopeContext;
  locked: boolean;
  preview: number | null;
  onPreviewChange: (i: number | null) => void;
}) {
  const t = useT();
  const brief = useDesignBrief(ctx).data ?? null;
  const screensQuery = useDesignScreens(ctx);
  const screenData = screensQuery.data;
  const version = useScopeVersion(ctx).data ?? null;
  const features = useFeatures(ctx, version).data?.items ?? EMPTY;
  const job = useScopeJobs(ctx).design;
  const screens = useMemo(() => [...(screenData?.items ?? [])].sort((a, b) => a.sortOrder - b.sortOrder), [screenData]);
  const ids = useMemo(() => screens.map((s) => s.id), [screens]);
  const urlsQuery = useScreenUrls(ctx, ids);
  const urls = useMemo(
    () => Object.fromEntries(Object.entries(urlsQuery.data ?? {}).flatMap(([id, v]) => (v.url ? [[id, v.url]] : []))) as Record<string, string>,
    [urlsQuery.data],
  );
  // a screen redesigned from a comment is a new version (same Key, Version + 1); the older one stays as "superseded"
  const versions = useScreenVersions(ctx).data;
  const revised = useMemo(() => screens.some((s) => (versions?.get(s.id)?.version ?? 1) > 1), [screens, versions]);
  const previousScreens = usePreviousScreens(ctx, revised).data;
  const previousIds = useMemo(() => {
    if (preview === null || !previousScreens) return [];
    return screens.flatMap((s) => { const p = previousScreens.of(versions?.get(s.id)); return p ? [p.id] : []; });
  }, [preview, previousScreens, screens, versions]);
  const previousUrlsQuery = useScreenUrls(ctx, previousIds);
  const threads = useProjectThreads(ctx.projectId).data;
  // the viewer lists the requirements a screen shows by title (the same requirements the Business Analysis page reads)
  const requirementRows = useRequirements(ctx.projectId).data;
  const requirements = useMemo(() => (requirementRows ?? []).map((r) => ({ key: r.key || r.id, title: r.title })), [requirementRows]);
  const threadOf = (s: DesignScreenRecord): PreviewThread | null => {
    const t = threads?.get(threadKey("screen", s.id));
    return t ? { id: t.id, status: String(t.status) } : null;
  };
  const previousOf = (s: DesignScreenRecord): PreviewPrevious | null => {
    const p = previousScreens?.of(versions?.get(s.id));
    return p ? { id: p.id, url: previousUrlsQuery.data?.[p.id]?.url ?? undefined } : null;
  };
  const setThreadStatus = useFeedbackSetStatus(ctx);
  const canAccept = !locked && ctx.can(FEEDBACK_RESOLVE_PERMISSION.screen);
  const accept = (threadId: string) => setThreadStatus.mutateAsync({ projectId: ctx.projectId, threadId, status: "resolved" });
  const imageError = () => { void urlsQuery.refetch(); if (previousIds.length > 0) void previousUrlsQuery.refetch(); };
  const [retrying, setRetrying] = useState(false);
  const [retryError, setRetryError] = useState<string | null>(null);
  const closed = useRef<string | null>(null);

  // focus goes back to the opening card when the preview closes
  useEffect(() => {
    if (preview !== null) { closed.current = screens[preview]?.id ?? null; return; }
    const id = closed.current;
    closed.current = null;
    if (id) document.querySelector<HTMLElement>(`[data-screen-card="${id}"]`)?.focus();
  }, [preview, screens]);

  const featureName = (ref: string): string | null => features.find((f) => f.ref === ref)?.name ?? null;
  const featureNamesOf = (s: { featureRefs: string[] }) => s.featureRefs.map(featureName).filter((n): n is string => n !== null);

  const retry = async () => {
    if (!job) return;
    setRetrying(true);
    setRetryError(null);
    try {
      await retryEngineJob(job.id);
    } catch (e) {
      setRetryError(scopeErrorMessage(e));
    } finally {
      setRetrying(false);
    }
  };

  const confirmed = brief?.status === "confirmed";
  const succeeded = job?.status === "succeeded";
  const prototype = useMemo(() => parseProductPrototype(brief?.prototypeJson), [brief?.prototypeJson]);
  const isFigma = prototype?.provider === "figma-design";
  const prototypeScreenCount = isFigma ? prototype.screens.length : prototype ? 1 : 0;
  const totalScreenCount = screens.length + prototypeScreenCount;
  const incomplete = isFigma && prototype.reviewComplete === false;
  const [viewerOpen, setViewerOpen] = useState(false);
  const [mobile, setMobile] = useState(false);
  // "came back without screens" waits for a read of the screens made after the job was seen finished
  const [doneRead, setDoneRead] = useState<{ jobId: string; at: number; rereads: number } | null>(null);
  // a retried job keeps its id: its finish time and attempt tell the runs apart
  const jobId = job ? `${job.id}:${job.attempts}:${job.finishedAt ?? ""}` : null;
  const screenCount = totalScreenCount;
  const refetchScreens = screensQuery.refetch;
  useEffect(() => {
    if (!jobId || !succeeded || screenCount > 0 || doneRead?.jobId === jobId) return;
    setDoneRead({ jobId, at: Date.now(), rereads: 0 });
    void refetchScreens();
  }, [jobId, succeeded, screenCount, doneRead?.jobId, refetchScreens]);
  const fetching = screensQuery.isFetching === true;
  const readAfterDone = doneRead !== null && doneRead.jobId === jobId && (screensQuery.dataUpdatedAt ?? 0) >= doneRead.at;
  const jobNamesScreens = job?.outputRefs.some((r) => r.schema === "DesignScreen") ?? false;
  useEffect(() => {
    if (!doneRead || !readAfterDone || fetching || screenCount > 0 || !jobNamesScreens || doneRead.rereads >= SCREEN_REREADS) return;
    const timer = setTimeout(() => {
      setDoneRead({ ...doneRead, at: Date.now(), rereads: doneRead.rereads + 1 });
      void refetchScreens();
    }, REREAD_MS);
    return () => clearTimeout(timer);
  }, [doneRead, readAfterDone, fetching, screenCount, jobNamesScreens, refetchScreens]);
  const cameBackEmpty = designCameBackEmpty({
    succeeded, screenCount, jobNamesScreens, readAfterDone, fetching, rereads: doneRead?.jobId === jobId ? doneRead.rereads : 0,
  });
  const status = job && !succeeded ? (
    <EngineJobStatus job={job} variant={totalScreenCount === 0 ? "full" : "compact"} canRetry={ctx.can("design.edit")} onRetry={() => void retry()} retrying={retrying} requestError={retryError} />
  ) : null;

  let body;
  if (totalScreenCount === 0 && !confirmed) {
    body = (
      <div className="rounded-block bg-surface2 px-4 py-4 text-[14px] text-ink2">
        <p>{t("analysis.scope.screens.noBrief", "No design instruction yet. Confirm one in Goals & requirements → Screens & design.")}</p>
        <Link to={requirementsDesignPath(ctx.projectId)} className="mt-2 inline-block font-medium text-[rgb(var(--c-accent-text))] underline-offset-2 hover:underline">{t("analysis.scope.screens.openDesign", "Open Screens & design")}</Link>
      </div>
    );
  } else if (totalScreenCount === 0 && !succeeded) {
    body = status ?? <p role="status" className="text-[14px] text-ink2">{t("analysis.scope.screens.startsSoon", "Your designer starts on the screens in a moment.")}</p>;
  } else if (totalScreenCount === 0 && !cameBackEmpty) {
    body = <p role="status" className="text-[14px] text-ink2">{t("analysis.scope.screens.loading", "Loading the screens…")}</p>;
  } else if (totalScreenCount === 0) {
    body = <p className="text-[14px] text-ink2">{t("analysis.scope.screens.cameBackEmpty", "The design came back without screens. Ask for them again from Screens & design.")}</p>;
  } else {
    body = (
      <div className="space-y-4">
        {status && (
          <div className="space-y-2">
            {status}
            <p className="text-[14px] text-ink2">{t("analysis.scope.screens.newRequested", "New designs requested from the updated design instruction")}</p>
          </div>
        )}
        {prototype && (
          <div className="flex flex-wrap items-center justify-between gap-4 rounded-card border border-line bg-surface p-4 sm:p-5">
            <div className="flex items-center gap-3.5">
              <div className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-ai-soft text-ai">
                <Layers size={22} strokeWidth={1.5} />
              </div>
              <div>
                <h4 className="text-[15px] font-medium text-ink">
                  {isFigma ? t("analysis.scope.screens.approvedDesigns", "{count} approved screen designs", { count: prototypeScreenCount }) : t("analysis.scope.screens.prototype", "Product design prototype")}
                </h4>
                <p className="mt-0.5 text-[13px] text-ink3">
                  {isFigma
                    ? `${prototype.screens.slice(0, 3).map((s) => s.name.replace(/^\d+[. -]*/, "")).join(", ")}${prototype.screens.length > 3 ? ` ${t("analysis.scope.screens.andMore", "and more")}` : ""}.`
                    : t("analysis.scope.screens.interactive", "Interactive product design and screen states.")}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              {prototype.previewUrl && (
                <Button variant="primary" iconRight={<Maximize2 size={15} />} onClick={() => setViewerOpen(true)}>
                  {t("analysis.scope.screens.viewDesigns", "View designs")}
                </Button>
              )}
            </div>
          </div>
        )}
        {viewerOpen && prototype?.previewUrl && (
          isFigma ? (
            <DesignViewer
              open={viewerOpen}
              onClose={() => setViewerOpen(false)}
              previewUrl={prototype.previewUrl}
              incomplete={incomplete}
              requirements={requirements}
            />
          ) : (
            <Modal open={viewerOpen} onClose={() => setViewerOpen(false)} title={t("analysis.scope.screens.productDesign", "Product design")} width={1200}>
              <div className="mb-3 flex gap-2">
                <Button size="sm" variant={mobile ? "ghost" : "secondary"} onClick={() => setMobile(false)} aria-pressed={!mobile}>{t("analysis.scope.design.desktop", "Desktop")}</Button>
                <Button size="sm" variant={mobile ? "secondary" : "ghost"} onClick={() => setMobile(true)} aria-pressed={mobile}>{t("analysis.scope.screens.phone", "Phone")}</Button>
              </div>
              <div className="overflow-auto rounded-block border border-line bg-white">
                <iframe
                  key={`${prototype.revision}:${mobile}`}
                  title={t("analysis.scope.screens.interactiveTitle", "Interactive product design")}
                  src={prototype.previewUrl}
                  className="mx-auto block h-[640px] max-w-full border-0"
                  style={{ width: mobile ? 390 : "100%" }}
                  sandbox={prototype.provider === "factory" ? "allow-scripts allow-forms" : "allow-scripts allow-same-origin allow-forms"}
                  referrerPolicy="no-referrer"
                  loading="lazy"
                />
              </div>
            </Modal>
          )
        )}
        {screens.length > 0 && (
        <ul className="grid grid-cols-1 gap-4 md:grid-cols-2 2xl:grid-cols-3">
          {screens.map((s, i) => (
            <DesignCard key={s.id} screen={s} index={i} url={urls[s.id]} onOpen={() => onPreviewChange(i)} onImageError={() => void urlsQuery.refetch()}
              featureNames={featureNamesOf(s)} version={versions?.get(s.id)?.version ?? null} threadStatus={threadOf(s)?.status ?? null} />
          ))}
        </ul>
        )}
        {preview !== null && screens[preview] && (
          <DesignPreviewModal screens={screens} index={preview} urls={urls} featureNamesOf={featureNamesOf} onIndexChange={onPreviewChange}
            onClose={() => onPreviewChange(null)} onImageError={imageError}
            threadOf={threadOf} previousOf={previousOf} onAccept={canAccept ? accept : undefined}
            noAcceptReason={locked ? undefined : t("analysis.scope.screens.noAccept", "Only people who can edit the designs can accept and close this.")} />
        )}
      </div>
    );
  }

  return (
    <section id="screens" tabIndex={-1} aria-labelledby="screens-heading" className="space-y-4 outline-none">
      <h2 id="screens-heading" className="text-[19px] font-medium">{t("analysis.scope.summary.screens", "Screens")}{totalScreenCount > 0 && <span className="num ml-2 text-ink3">{totalScreenCount}</span>}</h2>
      {body}
    </section>
  );
}
