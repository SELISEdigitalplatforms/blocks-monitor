/** The one line a page shows while a build's steps after the deploy are not finished (afterDeployUi.ts), with the action
 *  that runs them again when that can finish them (build.retryAfterDeploy). A new data table that may be open is said
 *  first and in the danger tone; everything else in the warning tone. */
import { CircleAlert, RotateCcw } from "lucide-react";
import { Button } from "@/ui/kit";
import { cn } from "@/lib/cn";
import type { OpenAfterDeploy } from "./afterDeployUi";
import { t, useT } from "@/i18n";

export const FINISH_LABEL = "Finish the steps after the deploy";
/** FINISH_LABEL in the current language (the constant stays the English source). */
export const finishLabel = (): string => t("build.afterDeploy.finish", "Finish the steps after the deploy");

export function AfterDeployNotice({ open, what, canRun, onFinish, pending, error, success, action = true }: {
  open: OpenAfterDeploy;
  /** "CR-007", "Milestone 2" */
  what: string;
  canRun: boolean;
  onFinish: () => void;
  pending?: boolean;
  error?: string | null;
  success?: string | null;
  /** false: the page's primary action is the finish already (one action per screen), so the line stands alone */
  action?: boolean;
}) {
  const t = useT();
  const a = open.attention;
  const offer = action && a.retry && !open.finishing;
  return (
    <div role="note" className={cn("rounded-block px-4 py-3 text-[14px] text-ink", a.security ? "bg-danger-soft" : "bg-warning-soft/60")}>
      <p className="flex items-start gap-2">
        <CircleAlert size={16} strokeWidth={1.75} aria-hidden className={cn("mt-0.5 shrink-0", a.security ? "text-[rgb(var(--c-danger-text))]" : "text-[rgb(var(--c-warning-text))]")} />
        <span className="min-w-0 break-words">
          <span className="font-medium">{a.broken ? t("build.afterDeploy.lineBroken", "{what} is on development, but not usable yet.", { what }) : t("build.afterDeploy.lineUnfinished", "{what} is on development, but not finished.", { what })}</span> {a.line}
        </span>
      </p>
      {open.finishing ? (
        <p role="status" className="mt-2 text-[13px] text-ink2">{t("build.afterDeploy.finishing", "The development team is finishing the steps after the deploy.")}</p>
      ) : offer ? (
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <Button size="sm" variant="secondary" icon={<RotateCcw size={14} strokeWidth={1.75} aria-hidden />} disabled={!canRun || pending} onClick={onFinish}>
            {pending ? t("changes.page.primary.requesting", "Requesting…") : finishLabel()}
          </Button>
          <span className="text-[12px] text-ink3">{canRun ? (a.issues.some((i) => i.startsWith("accept-")) ? t("build.afterDeploy.runsWithChecks", "Runs only the data tables, the texts and its checks again; the next build does it too.") : t("build.afterDeploy.runs", "Runs only the data tables and the texts again; the next build does it too."))
            : t("build.afterDeploy.teamCan", "The project team can finish them; the next build does it too.")}</span>
        </div>
      ) : null}
      {success && !error && <p role="status" className="mt-2 text-[13px] text-[rgb(var(--c-success-text))]">{success}</p>}
      {error && <p role="alert" className="mt-2 text-[13px] text-danger">{error}</p>}
    </div>
  );
}
