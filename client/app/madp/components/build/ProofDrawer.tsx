/** A stage's proof: the artifacts and notes its agent really recorded on the milestone's tickets while they stood in the
 *  stage's column, each with ONE traceability row, feature -> ticket -> acceptance criteria -> this stage -> result. The
 *  raw records sit behind "Technical details"; Download and Copy hand over exactly those records. */
import { Fragment, useState } from "react";
import { byNewest } from "@/madp/lib/newest";
import { ArrowRight, Check, Copy, Download, TriangleAlert } from "lucide-react";
import { stageDef } from "@/madp/data/pipeline";
import type { StageId } from "@/madp/data/types";
import type { DeliveryTicket } from "@/madp/blocks/delivery/types";
import { TICKET_COLUMNS } from "@/madp/domain/delivery";
import { cn } from "@/madp/lib/cn";
import { AiTag, Button, Chip, Drawer, EmptyState, Label } from "@/madp/ui/kit";
import { authorName, fmtElapsed, STAGE_COLUMN, type BuildWindow, type ProofEntry } from "./model";
import { Disclosure } from "./Inspector";
import { stageWithAgent } from "./stageUi";
import { useT } from "@/madp/i18n";

export function ProofDrawer({ stageId, entries, final, window: w, ticketCode, columnName, onClose }: {
  stageId: StageId | null;
  entries: ProofEntry[];
  final: boolean;
  window: BuildWindow | null;
  ticketCode: (t: DeliveryTicket) => string;
  columnName: (c: string) => string;
  onClose: () => void;
}) {
  const t = useT();
  const [copied, setCopied] = useState(false);
  const open = stageId !== null;
  const id = stageId ?? "01";
  const def = stageDef(id);
  const col = STAGE_COLUMN[id] ?? "done";
  const file = `${def.artifact.replace(/[^A-Za-z0-9]+/g, "-").toLowerCase()}-proof.md`;
  const tickets = [...new Map(entries.map((e) => [e.ticket.id, e.ticket])).values()];
  const text = [
    `# ${t("build.proofDrawer.heading", "{stage} · proof", { stage: def.name })}`,
    "",
    ...entries.map((e) => `- ${new Date(e.at).toISOString()} · ${ticketCode(e.ticket)} ${e.ticket.title} · ${e.event.kind}${e.event.authorLabel ? ` · ${authorName(e.event.authorLabel)}` : ""}\n  ${e.event.text.replace(/\n/g, "\n  ")}`),
  ].join("\n") + "\n";

  const download = () => {
    try {
      const url = URL.createObjectURL(new Blob([text], { type: "text/markdown" }));
      const a = Object.assign(document.createElement("a"), { href: url, download: file });
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch { /* download blocked by the browser */ }
  };
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch { /* clipboard blocked */ }
  };

  return (
    <Drawer open={open} onClose={onClose} width={600}
      title={<span className="flex min-w-0 items-center gap-2"><span className="truncate font-mono text-[15px]">{file}</span></span>}>
      <div className="flex flex-wrap items-center gap-2">
        <Chip>{stageWithAgent(id)}</Chip>
        <Chip tone={final ? "success" : "accent"} icon={final ? <Check size={12} strokeWidth={2.25} /> : undefined}>{final ? t("build.proofDrawer.final", "Final") : t("build.proofDrawer.live", "Updated live")}</Chip>
        <Chip>{def.artifact}</Chip>
      </div>

      {entries.length === 0 ? (
        <div className="mt-5"><EmptyState title={t("build.proofDrawer.emptyTitle", "Nothing recorded yet")} text={t("build.proofDrawer.emptyText", "The agent's artifacts and notes for this stage appear here once it records them on a ticket.")} /></div>
      ) : (<>
        <div className="mt-5">
          <AiTag>{t("build.proofDrawer.recorded", "Recorded by the factory")}</AiTag>
          <ol className="mt-2.5 space-y-3">
            {/* newest first on screen; the copy and the download stay a log in time order */}
            {byNewest(entries, (e) => e.at).map((e) => (
              <li key={e.event.id} className="rounded-block bg-surface2 px-3.5 py-3">
                <span className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[12px] text-ink3">
                  <span className="num font-medium text-ink2">{ticketCode(e.ticket)}</span>
                  <span>{e.event.kind === "artifact" ? t("build.inspector.artifact", "Artifact") : t("build.proofDrawer.note", "Note")}</span>
                  {e.event.authorLabel && <span>· {authorName(e.event.authorLabel)}</span>}
                  {w && e.at >= w.start && <span className="num ml-auto">{t("build.page.intoBuild", "{elapsed} into the build", { elapsed: fmtElapsed(e.at - w.start) })}</span>}
                </span>
                <p className="mt-1.5 whitespace-pre-wrap break-words text-[14px] leading-relaxed text-ink">{e.event.text}</p>
              </li>
            ))}
          </ol>
        </div>

        <div className="mt-6">
          <Label>{t("build.proofDrawer.trace", "Traceability")}</Label>
          <p className="mb-3 text-[13px] text-ink2">{t("build.proofDrawer.traceHint", "From the scope's feature to this stage's result, for every ticket above.")}</p>
          <div className="space-y-3">
            {tickets.map((tk) => <TraceRow key={tk.id} ticket={tk} stageColumn={col} code={ticketCode(tk)} columnName={columnName} />)}
          </div>
        </div>

        <Disclosure label={t("build.inspector.technical", "Technical details")}>
          <pre className="scroll-thin overflow-x-auto rounded-block bg-surface2 p-4 font-mono text-[12px] leading-relaxed text-ink2">{text}</pre>
        </Disclosure>
      </>)}

      <div className="mt-6 flex flex-wrap gap-2.5 border-t border-line pt-5">
        <Button variant="ghost" size="sm" icon={<Download size={14} strokeWidth={1.75} />} onClick={download} disabled={entries.length === 0}>{t("build.proofDrawer.download", "Download")}</Button>
        <Button variant="ghost" size="sm" icon={copied ? <Check size={14} strokeWidth={2.25} /> : <Copy size={14} strokeWidth={1.75} />} onClick={copy} disabled={entries.length === 0}>
          {copied ? t("build.overview.copied", "Copied") : t("build.proofDrawer.copy", "Copy contents")}
        </Button>
        <span className="ml-auto self-center text-[12px] text-ink3">{final ? t("build.proofDrawer.finished", "The stage has finished") : t("build.proofDrawer.finalWhen", "Final when the stage finishes")}</span>
      </div>
    </Drawer>
  );
}

/** One ticket's trace: Feature -> Ticket -> Acceptance -> Stage -> Result (passed once the ticket is past the stage). */
function TraceRow({ ticket: tk, stageColumn, code, columnName }: { ticket: DeliveryTicket; stageColumn: string; code: string; columnName: (c: string) => string }) {
  const t = useT();
  const here = TICKET_COLUMNS.indexOf(tk.column), stage = TICKET_COLUMNS.indexOf(stageColumn as (typeof TICKET_COLUMNS)[number]);
  const result: "passed" | "failed" | "pending" = here > stage || tk.column === "done" ? "passed" : here < stage && here > 0 ? "failed" : "pending";
  const steps = [
    { key: "feature", label: t("changes.panel.feature", "Feature"), ref: tk.featureRef || t("build.proofDrawer.crossFeature", "Cross-feature") },
    { key: "ticket", label: t("build.proofDrawer.ticket", "Ticket"), ref: code },
    { key: "acceptance", label: t("build.proofDrawer.acceptance", "Acceptance"), ref: tk.acceptance.length === 1 ? t("build.proofDrawer.criterion", "1 criterion") : t("build.proofDrawer.criteria", "{count} criteria", { count: tk.acceptance.length }) },
    { key: "stage", label: t("build.timeline.stage", "Stage"), ref: columnName(stageColumn) },
    { key: "result", label: t("build.proofDrawer.result", "Result"), ref: result === "passed" ? t("build.proofDrawer.passed", "Passed") : result === "failed" ? t("build.proofDrawer.backIn", "Back in {column}", { column: columnName(tk.column) }) : t("build.proofDrawer.pending", "Pending") },
  ];
  return (
    <ol className="flex flex-wrap items-stretch gap-y-2" aria-label={t("build.proofDrawer.traceOf", "Traceability of {code}", { code })}>
      {steps.map((s, i) => {
        const isResult = s.key === "result";
        return (
          <Fragment key={s.key}>
            <li className={cn("flex min-w-[96px] flex-1 flex-col justify-between rounded-block px-2.5 py-2 ring-1 ring-inset transition-colors duration-500",
              isResult
                ? result === "passed" ? "bg-success-soft ring-success/30" : result === "failed" ? "bg-warning-soft ring-warning/30" : "hatched bg-surface2 ring-line"
                : s.key === "stage" ? "bg-accent-soft ring-accent/40" : "bg-surface2 ring-transparent")}>
              <span className="text-[11px] font-medium uppercase tracking-wide text-ink3">{s.label}</span>
              <span className={cn("mt-1 flex min-w-0 items-center gap-1 text-[13px] font-medium",
                isResult ? (result === "passed" ? "text-success" : result === "failed" ? "text-ink" : "text-ink3") : s.key === "stage" ? "text-accent" : "text-ink")}>
                {isResult && result === "passed" && <Check size={12} strokeWidth={2.25} />}
                {isResult && result === "failed" && <TriangleAlert size={12} strokeWidth={1.75} />}
                <span className="num truncate">{s.ref}</span>
              </span>
            </li>
            {/* the arrows are their own (hidden) items, so the five steps share the row equally */}
            {i < steps.length - 1 && <li aria-hidden className="grid w-3.5 shrink-0 place-items-center text-ink3"><ArrowRight size={12} strokeWidth={1.75} /></li>}
          </Fragment>
        );
      })}
    </ol>
  );
}
