// Version chip + history drawer. Reads versions through the s7 hooks; the only write is
// item.version (restore) through s8's useRestoreVersion — the browser holds no write rights.
import { t, useT } from "@/i18n";
import { useState } from "react";
import { History } from "lucide-react";
import { Button, Chip, Drawer } from "@/ui/kit";
import { cn } from "@/lib/cn";
import { formatDateTime } from "@/lib/dates";
import { useItemVersionsMeta, useItemVersionText } from "@/blocks/requirements/hooks";
import { useMemberName, useRequirementsContext } from "@/blocks/requirements/context";
import { useRestoreVersion } from "@/blocks/requirements/mutations";
import { OBJECTIVE_ITEM_KEY, currentVersionOf, parseRequirementVersionText, parseObjectiveVersionText } from "@/domain/requirements";
import { requirementsErrorMessage } from "./messages";

export interface VersionRow {
  id: string; itemKey: string; n: number; origin: string;
  createdByUserId?: string | null; createdAt?: string | Date | null; text?: string;
}

function originLabel(origin: string): string {
  switch (origin) {
    case "person": return t("analysis.requirements.versionPerson", "Edited by a person");
    case "engine": return t("analysis.requirements.versionEngine", "Written by your business analyst");
    case "feedback": return t("analysis.requirements.originFeedback", "From feedback");
    case "second-opinion": return t("analysis.requirements.originSecondOpinion", "From the second opinion");
    default: return t("analysis.requirements.versionEdited", "Edited");
  }
}

function whenLabel(v: string | Date | null | undefined): string {
  return formatDateTime(v);
}

/** Readable text of a stored version: requirement / objective JSON via the pure parsers, criteria one per line. */
export function readableVersionText(itemKey: string, text: string): string {
  try {
    if (itemKey === OBJECTIVE_ITEM_KEY) {
      const o = parseObjectiveVersionText(text) as unknown as Record<string, unknown> | null;
      return o && typeof o.statement === "string" ? o.statement : text;
    }
    if (itemKey.startsWith("requirement:")) {
      const r = parseRequirementVersionText(text) as unknown as Record<string, unknown> | null;
      if (!r) return text;
      const parts = [String(r.title ?? ""), String(r.text ?? r.detail ?? "")].filter(Boolean);
      return `${parts.join("\n")}${r.priority ? `\n${t("analysis.requirements.versionPriority", "Priority: {priority}", { priority: String(r.priority) })}` : ""}`;
    }
  } catch { /* fall through to the raw text */ }
  return text;
}

export function VersionHistoryView({ versions, current, editable, nameOf, onRestore, busyN, error }: {
  versions: VersionRow[]; current: number; editable: boolean; nameOf: (id: string) => string;
  onRestore: (n: number) => void; busyN: number | null; error: string | null;
}) {
  useT();
  const sorted = [...versions].sort((a, b) => b.n - a.n);
  return (
    <div>
      <div role="status" aria-live="polite" className="mb-3 min-h-[18px] text-[13px]">
        {busyN !== null ? <span className="text-ink2">{t("analysis.requirements.saving", "Saving…")}</span> : error ? <span className="text-danger">{t("analysis.requirements.notSaved", "Not saved: {error}", { error })}</span> : null}
      </div>
      {sorted.length === 0 ? <p className="text-[14px] text-ink2">{t("analysis.requirements.noVersions", "No versions yet.")}</p> : (
        <ol className="space-y-3">
          {sorted.map((v) => (
            <li key={v.id} className="rounded-block bg-surface2 p-4">
              <div className="flex flex-wrap items-center gap-2">
                <Chip tone={v.n === current ? "accent" : "neutral"}>v{v.n}{v.n === current ? ` · ${t("analysis.requirements.versionCurrent", "current")}` : ""}</Chip>
                <span className="text-[13px] font-medium">{originLabel(v.origin)}</span>
              </div>
              <div className="mt-1 text-[12px] text-ink3">
                {v.createdByUserId ? nameOf(v.createdByUserId) : t("analysis.requirements.aMember", "A workspace member")}
                {whenLabel(v.createdAt) && ` · ${whenLabel(v.createdAt)}`}
              </div>
              {v.text !== undefined && (
                <p className="mt-2 whitespace-pre-wrap break-words text-[14px] text-ink2">{readableVersionText(v.itemKey, v.text) || t("analysis.requirements.versionEmpty", "(empty)")}</p>
              )}
              {editable && v.n !== current && (
                <Button size="sm" variant="ghost" className="mt-3" disabled={busyN !== null}
                  onClick={() => onRestore(v.n)} aria-label={t("analysis.requirements.restoreVersionN", "Restore version {n}", { n: v.n })}>
                  {t("analysis.requirements.restoreVersion", "Restore this version")}
                </Button>
              )}
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

function VersionDrawerBody({ projectId, itemKey, current, editable }: { projectId: string; itemKey: string; current: number; editable: boolean }) {
  useT();
  const texts = useItemVersionText(projectId, itemKey, true);
  const { actorUserId } = useRequirementsContext(projectId);
  const memberName = useMemberName();
  const restore = useRestoreVersion(projectId);
  const [busyN, setBusyN] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const nameOf = (id: string) => (id === actorUserId ? t("analysis.requirements.ownerYou", "You") : memberName(id) || t("analysis.requirements.aMember", "A workspace member"));
  const onRestore = (n: number) => {
    setBusyN(n); setError(null); setSaved(false);
    restore.mutateAsync({ itemKey, restoreN: n, baseVersion: current })
      .then(() => setSaved(true))
      .catch((e: unknown) => setError(requirementsErrorMessage(e)))
      .finally(() => setBusyN(null));
  };
  return (
    <>
      <VersionHistoryView versions={(texts.data ?? []) as VersionRow[]} current={current} editable={editable}
        nameOf={nameOf} onRestore={onRestore} busyN={busyN} error={error} />
      <p role="status" aria-live="polite" className="mt-3 text-[13px] text-success">{saved ? t("analysis.requirements.saved", "Saved") : ""}</p>
    </>
  );
}

export function VersionChip({ projectId, itemKey, editable, label }: { projectId: string; itemKey: string; editable: boolean; label?: string }) {
  useT();
  const meta = useItemVersionsMeta(projectId);
  const [open, setOpen] = useState(false);
  const latest = meta.data?.latest;
  const n = latest ? currentVersionOf(latest, itemKey) : 0;
  // a first version has no history to show: the chip appears once the item has changed
  if (n < 2) return null;
  const what = label ?? t("analysis.requirements.thisItem", "this item");
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} aria-label={t("analysis.requirements.versionHistoryOf", "Version history of {what}", { what })}
        className={cn("inline-flex items-center gap-1 rounded-full bg-surface2 px-2.5 py-1 text-[12px] font-medium text-ink2 outline-none transition hover:bg-line focus-visible:ring-2 focus-visible:ring-accent/50")}>
        <History size={13} strokeWidth={1.75} aria-hidden />v{n}
      </button>
      <Drawer open={open} onClose={() => setOpen(false)} title={t("analysis.requirements.versionHistoryTitle", "Version history · {what}", { what })}>
        <VersionDrawerBody projectId={projectId} itemKey={itemKey} current={n} editable={editable} />
      </Drawer>
    </>
  );
}
