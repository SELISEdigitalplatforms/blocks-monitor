/** An existing product attached to the Factory as it is live (it never went through the analysis), past the analysis:
 *  the records that say what really happened, and the analyst's card about the product: what was written down from the
 *  live product and when, with "Document / Refresh from the live product" for people who may start it (the op
 *  project.documentExisting; its progress shows here like every other job), and the way to change the product, a
 *  change request (the same panel Release's "Request a change" and "Add a feature" open:
 *  openChangeRequest; the drawer is ChangeRequestLayer, which AnalystColumn mounts for a live product). Without the
 *  right to request changes the card links to Software Engineering instead. */
import { Link } from "react-router-dom";
import { ArrowRight, MessageSquareWarning, RefreshCw, ScanSearch } from "lucide-react";
import { useRequirementsContext } from "@/madp/blocks/requirements/context";
import { useScopeContext } from "@/madp/blocks/scope/context";
import { useScopeVersion } from "@/madp/blocks/scope/hooks";
import { useBlocksChangeAccess } from "@/madp/components/changes/blocksChanges";
import { openChangeRequest } from "@/madp/components/changes/changeUi";
import { Button } from "@/madp/ui/kit";
import { canStartDocumentation, documentBlockedText, documentButton, documentedLine, runningLine } from "../live/liveDoc";
import type { LiveDoc } from "../live/useLiveDoc";
import { liveProductSays } from "./analystModel";
import { useT } from "@/madp/i18n";
import { AnalystSays, ErrorNote, Note } from "./Talk";
import { WorkingDots } from "./Working";
import { prefixPath } from "@/madp/lib/pathPrefix";

/** The requirements' stored approval and the scope's stored lock, read only for a live product (the queries stay off
 *  otherwise; they are the same reads as the analysis' own rows, so nothing extra is fetched). A lock is a person's:
 *  the scope version the documentation writes is stored locked but nobody locked it (no LockedAt, no LockedByUserId),
 *  so it never reads as "Agree and lock the scope: Done". */
export function useLiveRecords(projectId: string, live: boolean): { requirementsApproved: boolean; scopeLocked: boolean } {
  const requirements = useRequirementsContext(live ? projectId : null);
  const version = useScopeVersion(useScopeContext(live ? projectId : "")).data ?? null;
  return {
    requirementsApproved: live && Boolean(requirements.project?.requirementsConfirmedAt),
    scopeLocked: live && Boolean(version?.lockedAt || version?.lockedByUserId),
  };
}

const LINK = "inline-flex h-10 w-fit items-center justify-center gap-2 whitespace-nowrap rounded-full bg-accent px-5 text-[14px] font-medium text-white outline-none transition hover:bg-accent-hover focus-visible:ring-2 focus-visible:ring-accent/50";

/** What the analyst says about the live product: what is written down and when, the documentation's action (or why
 *  there is none), and the way to change the product. */
export function LiveProductSays({ projectId, doc }: { projectId: string; doc: LiveDoc | null }) {
  const t = useT();
  const { canRun } = useBlocksChangeAccess(projectId);
  const f = doc?.facts ?? null;
  const blocked = f ? documentBlockedText(f) : null;
  return (
    <div className="flex flex-col gap-3.5">
      {!f || f.loading ? (
        <AnalystSays>{liveProductSays()}</AnalystSays>
      ) : f.running ? (
        <div role="status" aria-live="polite" className="flex flex-col gap-2">
          <AnalystSays>{t("analysis.analyst.live.writingDown", "I'm writing down what the live product does today, from its code and documents.")}</AnalystSays>
          <p className="flex items-center gap-2.5 rounded-block bg-surface2 px-3.5 py-2.5 text-[14px] leading-5 text-ink2">
            <WorkingDots className="shrink-0" />
            <span className="min-w-0 break-words">{runningLine(f.running)}</span>
          </p>
        </div>
      ) : f.documentedAt ? (
        <AnalystSays>{`${documentedLine(f.documentedAt)} ${t("analysis.analyst.live.partsShow", "The parts on the right show what it does today. To change it, request a change or a new feature.")}`}</AnalystSays>
      ) : (
        <AnalystSays>{t("analysis.analyst.live.nothingYet", "This product came to the Factory as it is live, so there was no analysis, and nothing is written down here yet. I can read its code and documents and write down what it does today: its objective, users, features, workflows, milestones and design system.")}</AnalystSays>
      )}
      {f?.stopped && !f.running && <Note>{t("analysis.analyst.live.stopped", "The last documentation stopped before it finished. Nothing written down before is lost.")}</Note>}
      {doc?.error && <ErrorNote text={doc.error} />}
      <div className="flex flex-wrap items-center gap-2">
        {f && canStartDocumentation(f) && doc && (
          <Button size="md" variant={f.documentedAt ? "ghost" : "primary"} disabled={doc.starting}
            icon={f.documentedAt ? <RefreshCw size={15} strokeWidth={1.75} aria-hidden /> : <ScanSearch size={15} strokeWidth={1.75} aria-hidden />}
            onClick={doc.start}>
            {doc.starting ? t("analysis.analyst.live.asking", "Asking…") : documentButton(f)}
          </Button>
        )}
        {canRun ? (
          <Button size="md" variant={f && !f.documentedAt && canStartDocumentation(f) ? "ghost" : "primary"} className="w-fit"
            icon={<MessageSquareWarning size={15} strokeWidth={1.75} aria-hidden />}
            onClick={() => openChangeRequest({ lane: "change", target: null })}>
            {t("analysis.analyst.live.requestChange", "Request a change")}
          </Button>
        ) : (
          <Link to={prefixPath(`/p/${projectId}/build`)} className={LINK}>
            {t("analysis.analyst.live.goToEngineering", "Go to Software Engineering")}<ArrowRight size={15} aria-hidden />
          </Link>
        )}
      </div>
      {blocked && <Note>{blocked}</Note>}
    </div>
  );
}
