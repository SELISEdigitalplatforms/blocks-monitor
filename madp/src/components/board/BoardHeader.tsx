import { Lock } from "lucide-react";
import { scopeName } from "@/components/scope/blocks/ScopeHeader";
import type { DeliveryProject } from "@/blocks/delivery/context";
import { Bar, Chip, Dot } from "@/ui/kit";
import { useCulture, useT } from "@/i18n";

/** The board's summary line: the lock badge, the ticket counts with the done bar, and whether the board is live.
 *  The Build step above owns the page title and the one primary action, so this has no heading of its own. */
export function BoardHeader({ project, counts, live }: {
  project: DeliveryProject; counts: { total: number; done: number; donePct: number }; live: boolean;
}) {
  const t = useT();
  const culture = useCulture();
  const version = project.currentScopeVersion;
  // "Scope · locked Sat 31 Oct" (a later version: "Scope version 2 · locked …"), the same names as the Scope step
  const day = project.scopeLockedAt && !Number.isNaN(Date.parse(project.scopeLockedAt))
    ? new Date(project.scopeLockedAt).toLocaleDateString(culture === "de-CH" ? "de-CH" : "en-GB", { weekday: "short", day: "numeric", month: "short" }).replace(/,/g, "")
    : "";
  const lock = typeof version !== "number" ? null
    : day ? t("build.board.header.lockedOn", "{scope} · locked {day}", { scope: scopeName(version), day }) : t("build.board.header.locked", "{scope} · locked", { scope: scopeName(version) });
  return (
    <div className="mb-4 flex flex-wrap items-center gap-x-3 gap-y-2 text-[13px] text-ink2">
      {lock && <Chip icon={<Lock size={12} strokeWidth={1.75} aria-hidden />}>{lock}</Chip>}
      <span className="num">{counts.total === 1 ? t("build.step.ticketsOne", "{count} ticket", { count: 1 }) : t("build.step.ticketsMany", "{count} tickets", { count: counts.total })}</span>
      <span className="num">{t("build.board.header.done", "{done} done · {pct}%", { done: counts.done, pct: counts.donePct })}</span>
      <div className="w-24"><Bar value={counts.donePct} /></div>
      {live ? (
        <span role="status" className="inline-flex items-center gap-2">
          <Dot tone="accent" pulse />
          <span>{t("build.board.header.live", "Live: MADP agents are building. Tickets move here as they report.")}</span>
        </span>
      ) : <span>{t("build.board.header.idle", "Every ticket moves on its own, with proof.")}</span>}
    </div>
  );
}
