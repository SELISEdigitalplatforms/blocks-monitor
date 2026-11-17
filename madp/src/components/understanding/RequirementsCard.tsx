/** "What it should do": the requirements from your project setup and your files, grouped by area. What was stated is
 *  confirmed; what was only suggested waits for you to confirm it or set it aside ("Not needed"). Set-aside items
 *  live in the Details area, where they can be brought back. */
import { useT } from "@/i18n";
import { useState } from "react";
import { Check, ChevronDown, FileText, Lightbulb, ListChecks } from "lucide-react";
import { Button, Card, Chip } from "@/ui/kit";
import { cn } from "@/lib/cn";
import type { BriefFeature, BriefRequirement } from "./briefApi";
import { ownWordsOnly, requirementCounts, requirementSource, type SetupFinding } from "./model";

export type RequirementDecision = "confirmed" | "rejected" | null;

function Row({ r, proposed, actions, pending, onDecide }: {
  r: BriefRequirement; proposed: boolean; actions: boolean; pending: boolean; onDecide: (value: RequirementDecision) => void;
}) {
  const t = useT();
  return (
    <li className={cn("flex min-w-0 flex-wrap items-start gap-x-3 gap-y-2 rounded-block px-4 py-3", proposed ? "bg-accent-soft/40 ring-1 ring-inset ring-accent/20" : "bg-surface2")}>
      {proposed
        ? <Lightbulb size={16} strokeWidth={1.75} aria-hidden className="mt-0.5 shrink-0 text-[rgb(var(--c-accent-text))]" />
        : <span aria-hidden className="mt-0.5 grid h-[18px] w-[18px] shrink-0 place-items-center rounded-full bg-success text-white dark:text-canvas"><Check size={12} strokeWidth={3} /></span>}
      <div className="min-w-0 flex-1 basis-56">
        <p className="break-words text-[15px] leading-snug text-ink">{r.description}</p>
        <p className="mt-0.5 text-[12px] text-ink3">{requirementSource(r)}</p>
      </div>
      {actions && (proposed || r.basis === "confirmed" || !ownWordsOnly(r)) && (
        <div className="flex shrink-0 items-center gap-2">
          {proposed && (
            <Button size="sm" variant="secondary" disabled={pending} onClick={() => onDecide("confirmed")} aria-label={t("analysis.understanding.confirmItem", "Confirm: {title}", { title: r.description })}>{t("analysis.understanding.confirm", "Confirm")}</Button>
          )}
          {proposed && r.basis !== "explicit" ? (
            <Button size="sm" variant="ghost" disabled={pending} onClick={() => onDecide("rejected")} aria-label={t("analysis.understanding.notNeededItem", "Not needed: {title}", { title: r.description })}>{t("analysis.understanding.notNeeded", "Not needed")}</Button>
          ) : r.basis === "confirmed" ? (
            <Button size="sm" variant="ghost" disabled={pending} onClick={() => onDecide(null)} aria-label={t("analysis.understanding.undoConfirmItem", "Undo confirm: {title}", { title: r.description })}>{t("analysis.understanding.undo", "Undo")}</Button>
          ) : (
            <Button size="sm" variant="ghost" disabled={pending} onClick={() => onDecide("rejected")} aria-label={t("analysis.understanding.setAsideItem", "Set aside: {title}", { title: r.description })}>{t("analysis.understanding.setAside", "Set aside")}</Button>
          )}
        </div>
      )}
    </li>
  );
}

function Area({ f, actions, pendingKey, onDecide }: {
  f: BriefFeature; actions: boolean; pendingKey: string | null; onDecide: (key: string, value: RequirementDecision) => void;
}) {
  const total = f.confirmedRequirements.length + f.proposedRequirements.length;
  const [open, setOpen] = useState(true);
  return (
    <div className="flex flex-col gap-2">
      <button type="button" onClick={() => setOpen(!open)} aria-expanded={open}
        className="flex items-center gap-2 rounded-full py-1 text-left text-[14px] font-medium text-ink2 outline-none hover:text-ink focus-visible:ring-2 focus-visible:ring-accent/50">
        <ChevronDown size={16} aria-hidden className={cn("shrink-0 transition", !open && "-rotate-90")} />
        <span className="min-w-0 flex-1">{f.name}</span>
        <span className="num text-[12px] text-ink3">{total}</span>
      </button>
      {open && (
        <ul className="flex flex-col gap-2">
          {f.proposedRequirements.map((r) => (
            <Row key={r.id} r={r} proposed actions={actions} pending={pendingKey === r.id} onDecide={(v) => onDecide(r.id, v)} />
          ))}
          {f.confirmedRequirements.map((r) => (
            <Row key={r.id} r={r} proposed={false} actions={actions} pending={pendingKey === r.id} onDecide={(v) => onDecide(r.id, v)} />
          ))}
        </ul>
      )}
    </div>
  );
}

/** One must-have the project setup found (read only here: it is changed in Project setup). */
function SetupRow({ f }: { f: SetupFinding }) {
  return (
    <li className="flex min-w-0 items-start gap-x-3 rounded-block bg-surface2 px-4 py-3">
      <FileText size={16} strokeWidth={1.75} aria-hidden className="mt-0.5 shrink-0 text-ink3" />
      <div className="min-w-0 flex-1">
        <p className="break-words text-[15px] leading-snug text-ink">{f.text}</p>
        <p className="mt-0.5 text-[12px] text-ink3">{f.source}</p>
      </div>
    </li>
  );
}

export function RequirementsCard({ features, actions, pendingKey, onDecide, emptyText, fromSetup = [] }: {
  features: readonly BriefFeature[];
  actions: boolean;
  pendingKey: string | null;
  onDecide: (key: string, value: RequirementDecision) => void;
  emptyText: string;
  /** What the project setup found (must-haves, the business agent's findings) that the files didn't name. */
  fromSetup?: readonly SetupFinding[];
}) {
  const t = useT();
  const { confirmed, proposed } = requirementCounts({ features: [...features] });
  const ordered = [...features].sort((a, b) => b.proposedRequirements.length - a.proposedRequirements.length)
    .map((f) => (f.name === "General" ? { ...f, name: t("analysis.understanding.areaOther", "Other") } : f));
  // A short list reads best as one list; areas help once there is more to scan.
  const grouped = ordered.length > 1 && confirmed + proposed > 8;
  return (
    <div id="understanding-requirements" className="scroll-mt-[calc(var(--project-nav-h,var(--topbar-h,0px))+24px)]">
      <Card title={t("analysis.understanding.shouldDoTitle", "What it should do")} icon={<ListChecks size={18} strokeWidth={1.75} />}
        action={confirmed + proposed > 0 ? (
          <div className="flex flex-wrap items-center gap-1.5">
            {proposed > 0 && <Chip tone="accent">{t("analysis.understanding.toCheckCount", "{count} to check", { count: proposed })}</Chip>}
            {confirmed > 0 && <Chip tone="success">{t("analysis.understanding.confirmedCount", "{count} confirmed", { count: confirmed })}</Chip>}
          </div>
        ) : undefined}>
        {confirmed + proposed === 0 && fromSetup.length > 0 ? (
          <div className="flex flex-col gap-3">
            <p className="text-[13px] text-ink2">{actions
              ? t("analysis.understanding.fromSetupNext", "From your project setup. Your business analyst turns these into requirements with you next.")
              : t("analysis.understanding.fromSetupSentence", "From your project setup.")}</p>
            <ul className="flex flex-col gap-2">{fromSetup.map((f) => <SetupRow key={f.key} f={f} />)}</ul>
          </div>
        ) : confirmed + proposed === 0 ? (
          <p className="rounded-block bg-surface2 px-4 py-3 text-[14px] text-ink2">{t("analysis.understanding.nothingToCheck", "Nothing to check yet. {more}", { more: emptyText })}</p>
        ) : (
          <div className="flex flex-col gap-4">
            {proposed > 0 && actions && (
              <p className="text-[13px] text-ink2">{t("analysis.understanding.suggestedIntro", "Suggested items come from your files. Confirm what you need and set aside the rest; your business analyst works with what you confirm.")}</p>
            )}
            {grouped
              ? ordered.map((f) => <Area key={f.name} f={f} actions={actions} pendingKey={pendingKey} onDecide={onDecide} />)
              : (
                <ul className="flex flex-col gap-2">
                  {ordered.flatMap((f) => f.proposedRequirements).map((r) => (
                    <Row key={r.id} r={r} proposed actions={actions} pending={pendingKey === r.id} onDecide={(v) => onDecide(r.id, v)} />
                  ))}
                  {ordered.flatMap((f) => f.confirmedRequirements).map((r) => (
                    <Row key={r.id} r={r} proposed={false} actions={actions} pending={pendingKey === r.id} onDecide={(v) => onDecide(r.id, v)} />
                  ))}
                </ul>
              )}
            {fromSetup.length > 0 && (
              <section aria-label={t("analysis.understanding.alsoFromSetup", "Also from your project setup")} className="flex flex-col gap-2">
                <h3 className="text-[13px] font-medium text-ink3">{t("analysis.understanding.alsoFromSetup", "Also from your project setup")}</h3>
                <ul className="flex flex-col gap-2">{fromSetup.map((f) => <SetupRow key={f.key} f={f} />)}</ul>
              </section>
            )}
          </div>
        )}
      </Card>
    </div>
  );
}

/** The set-aside requirements (Details area), each with "Bring back". */
export function SetAsideList({ items, actions, pendingKey, onBringBack }: {
  items: readonly BriefRequirement[]; actions: boolean; pendingKey: string | null; onBringBack: (key: string) => void;
}) {
  const t = useT();
  if (!items.length) return <p className="text-[14px] text-ink2">{t("analysis.understanding.nothingSetAside", "Nothing set aside.")}</p>;
  return (
    <ul className="flex flex-col gap-2">
      {items.map((r) => (
        <li key={r.id} className="flex min-w-0 flex-wrap items-start gap-x-3 gap-y-1.5 rounded-block bg-surface2 px-4 py-3">
          <div className="min-w-0 flex-1 basis-56">
            <p className="break-words text-[14px] text-ink2 line-through decoration-ink3/50">{r.description}</p>
            <p className="mt-0.5 text-[12px] text-ink3">{requirementSource({ ...r, basis: "explicit" })}</p>
          </div>
          {actions && <Button size="sm" variant="ghost" disabled={pendingKey === r.id} onClick={() => onBringBack(r.id)}>{t("analysis.understanding.bringBack", "Bring back")}</Button>}
        </li>
      ))}
    </ul>
  );
}
