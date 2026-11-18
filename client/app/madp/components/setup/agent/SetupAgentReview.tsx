/** "Here's what your business agent found": the findings of its readings, grouped like the setup ("What it must do",
 *  "Key workflows", "What to leave out", "What we must respect", goal and users), each with where it was found and
 *  Add / Edit / Ignore. Add saves through project.setup.save (goal and users through the guided start's answers,
 *  project.setup), so the "Project brief" follows; then the finding is marked added. Nothing
 *  goes into the setup unless a person adds it. Same window as the other setup windows (SetupWindow). */
import { useId, useMemo, useRef, useState, type ReactNode } from "react";
import { Ban, Check, FileText, ListChecks, PencilLine, Route, ShieldCheck, Target, Undo2, Users, X } from "lucide-react";
import type { ProjectRecord } from "@/madp/blocks/projects/records";
import { useProjectsContext } from "@/madp/blocks/projects/context";
import { useSetupProject } from "@/madp/blocks/projects/mutations";
import { answersFromProject, toSetupArgs } from "@/madp/domain/guidedStart";
import { CONSTRAINT_KINDS, type ConstraintKind, type Priority } from "@/madp/domain/setupDetails";
import {
  SUGGESTION_KINDS, TEXT_MAX, addToDetails, type SetupSuggestion, type SuggestionKind,
} from "@/madp/domain/setupAgent";
import { Banner, Button, Chip, Select, Textarea } from "@/madp/ui/kit";
import { showToast } from "@/madp/ui/Toast";
import { cn } from "@/madp/lib/cn";
import { t, useT } from "@/madp/i18n";
import { StepHeading } from "@/madp/components/guided/GuidedSteps";
import { SetupWindow } from "../SetupWindow";
import { PriorityPicker, priorityLabel } from "../PriorityPicker";
import { constraintKindName } from "@/madp/components/requirements/domainLabels";
import { saveSetup, useSetupDetails } from "../data";
import { setupMessage } from "../messages";
import { decideSuggestions, useSetupAgent } from "./data";

const ICON: Record<SuggestionKind, ReactNode> = {
  mustHave: <ListChecks size={16} />, workflow: <Route size={16} />, exclusion: <Ban size={16} />,
  constraint: <ShieldCheck size={16} />, goal: <Target size={16} />, users: <Users size={16} />,
};

/** The review window's section of each kind (shown; the domain's SUGGESTION_SECTION keeps the English). */
function sectionLabel(k: SuggestionKind): string {
  switch (k) {
    case "mustHave": return t("shell.setup.review.section.mustHave", "What it must do");
    case "workflow": return t("shell.setup.review.section.workflow", "Key workflows");
    case "exclusion": return t("shell.setup.review.section.exclusion", "What to leave out");
    case "constraint": return t("shell.setup.review.section.constraint", "What we must respect");
    case "goal": return t("shell.setup.review.section.goal", "Goal");
    default: return t("shell.setup.review.section.users", "Who will use it");
  }
}

/** The small line under a finding: its priority or kind of constraint, and where it was found ("Must · from PRD v2.pdf"). */
function findingMeta(s: Pick<SetupSuggestion, "kind" | "priority" | "constraintKind" | "sourceName">): string {
  const what = s.kind === "mustHave" ? priorityLabel(s.priority) : s.kind === "constraint" && s.constraintKind !== "other" ? constraintKindName(s.constraintKind) : "";
  const from = s.sourceName ? t("shell.setup.review.from", "from {source}", { source: s.sourceName }) : "";
  return [what, from].filter(Boolean).join(" · ");
}

interface Draft { text: string; priority: Priority; constraintKind: ConstraintKind }
const draftOf = (s: SetupSuggestion): Draft => ({ text: s.text, priority: s.priority, constraintKind: s.constraintKind });

export interface SetupAgentReviewProps {
  project: ProjectRecord;
  canEdit: boolean;
  /** Why the findings can only be read (shown at the top in plain words), when `canEdit` is false. */
  readOnlyReason?: { title: string; text: string } | null;
  onClose: () => void;
}

export function SetupAgentReview({ project, canEdit, readOnlyReason, onClose }: SetupAgentReviewProps) {
  useT();
  const { workspaceId } = useProjectsContext();
  const agent = useSetupAgent(project.id, { live: false });
  const stored = useSetupDetails(project.id);
  const setupProject = useSetupProject();
  const form = useRef<HTMLFormElement>(null);
  const headingId = useId();
  const [busy, setBusy] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [failure, setFailure] = useState<string | null>(null);
  // what was reviewed in this window stays in view (with its outcome) until the window closes
  const [seenHere] = useState(() => new Set(agent.open.map((s) => s.id)));

  const shown = useMemo(() => agent.suggestions.filter((s) => s.status === "open" || seenHere.has(s.id)), [agent.suggestions, seenHere]);
  const open = shown.filter((s) => s.status === "open");
  const draft = (s: SetupSuggestion): Draft => drafts[s.id] ?? draftOf(s);

  async function add(items: SetupSuggestion[]) {
    if (!workspaceId || items.length === 0) return;
    setFailure(null);
    setBusy(items.length === 1 ? items[0]!.id : "all");
    try {
      const chosen = items.map((s) => ({ ...s, ...draft(s), text: draft(s).text.trim() })).filter((s) => s.text);
      const details = chosen.filter((s) => s.kind !== "goal" && s.kind !== "users");
      // the lists are saved whole: adding to them before the stored ones were read would replace them
      if (details.length && !stored.loaded) {
        setFailure(stored.error ? t("shell.setup.review.loadFailed", "Your setup couldn't be loaded just now, so nothing was added. Try again in a moment.") : t("shell.setup.review.stillLoading", "Your setup is still loading. Try again in a moment."));
        return;
      }
      if (details.length) await saveSetup(workspaceId, { projectId: project.id, ...addToDetails(stored.details, details) });
      const goal = chosen.find((s) => s.kind === "goal");
      const users = chosen.find((s) => s.kind === "users");
      if (goal || users) {
        const a = answersFromProject(project);
        const next = { ...a, ...(goal ? { goal: goal.text, goalTags: [] } : {}), ...(users ? { users: users.text, userTags: [] } : {}) };
        await setupProject.run(toSetupArgs(project.id, next, project.name));
      }
      await decideSuggestions(workspaceId, project.id, chosen.map((s) => s.id), "added");
      setEditing(null);
      // "Add all": done in one go, back to the page
      if (items.length > 1) {
        showToast(t("shell.setup.review.addedToast", "Added {count} to your setup", { count: chosen.length }));
        onClose();
      }
    } catch (e) {
      setFailure(setupMessage(e));
    } finally {
      setBusy(null);
    }
  }

  async function decide(s: SetupSuggestion, decision: "ignored" | "open") {
    if (!workspaceId) return;
    setFailure(null);
    setBusy(s.id);
    try {
      await decideSuggestions(workspaceId, project.id, [s.id], decision);
      if (editing === s.id) setEditing(null);
    } catch (e) {
      setFailure(setupMessage(e));
    } finally {
      setBusy(null);
    }
  }

  const sources = [...new Set(shown.map((s) => s.sourceName).filter(Boolean))];
  const foundIn = sources.length === 0 ? ""
    : sources.length === 1 ? t("shell.setup.review.foundInOne", "Found in {source}.", { source: sources[0]! })
    : sources.length === 2 ? t("shell.setup.review.foundInTwo", "Found in {first} and {second}.", { first: sources[0]!, second: sources[1]! })
    : t("shell.setup.review.foundInMany", "Found in {count} of your documents.", { count: sources.length });
  const intro = shown.length === 0
    ? t("shell.setup.review.allReviewed", "Everything it found is reviewed. It reads new material as soon as you share it.")
    : [foundIn, canEdit ? t("shell.setup.review.howTo", "Add what fits, change the words if you like, or ignore it. Nothing goes into your setup unless you add it.") : ""].filter(Boolean).join(" ");

  return (
    <SetupWindow name={t("shell.setup.agent.name", "Your business analyst")} steps={[t("shell.setup.review.step", "What it found")]} step={0} headingId={headingId} formRef={form}
      onClose={onClose} onNext={() => (open.length && canEdit ? void add(open) : onClose())}
      nextLabel={open.length && canEdit ? (open.length === 1 ? t("shell.setup.review.addIt", "Add it") : t("shell.setup.review.addAll", "Add all {count}", { count: open.length })) : t("common.actions.done", "Done")} busy={busy !== null}
      footerNote={open.length && canEdit ? t("shell.setup.review.toReview", "{count} to review", { count: open.length }) : undefined}
      secondary={open.length && canEdit ? <Button variant="ghost" onClick={onClose} disabled={busy !== null}>{t("shell.setup.review.later", "Later")}</Button> : undefined}>
      <StepHeading id={headingId} title={t("shell.setup.review.title", "Here's what your business analyst found")} text={intro} />
      {failure && <Banner tone="danger" className="mb-5" title={failure} />}
      {!canEdit && readOnlyReason && <Banner tone="neutral" className="mb-5" title={readOnlyReason.title} text={readOnlyReason.text} />}
      <div className="flex max-w-3xl flex-col gap-7">
        {SUGGESTION_KINDS.map((k) => {
          const items = shown.filter((s) => s.kind === k);
          if (!items.length) return null;
          return (
            <section key={k} aria-label={sectionLabel(k)}>
              <h3 className="mb-2.5 flex items-center gap-2 text-[14px] font-medium text-ink2">
                <span aria-hidden className="text-ink3">{ICON[k]}</span>{sectionLabel(k)}
              </h3>
              <ul className="flex flex-col gap-2">
                {items.map((s) => (
                  <Finding key={s.id} s={s} draft={draft(s)} editing={editing === s.id} busy={busy === s.id || busy === "all"} readOnly={!canEdit} disabled={!canEdit || (busy !== null && busy !== s.id)}
                    onDraft={(d) => setDrafts((all) => ({ ...all, [s.id]: d }))}
                    onEdit={() => setEditing(s.id)} onCancel={() => { setEditing(null); setDrafts((all) => { const { [s.id]: _, ...rest } = all; return rest; }); }}
                    onAdd={() => void add([s])} onIgnore={() => void decide(s, "ignored")} onUndo={() => void decide(s, "open")} />
                ))}
              </ul>
            </section>
          );
        })}
      </div>
    </SetupWindow>
  );
}

function Finding({ s, draft, editing, busy, readOnly, disabled, onDraft, onEdit, onCancel, onAdd, onIgnore, onUndo }: {
  s: SetupSuggestion; draft: Draft; editing: boolean; busy: boolean; readOnly: boolean; disabled: boolean;
  onDraft: (d: Draft) => void; onEdit: () => void; onCancel: () => void; onAdd: () => void; onIgnore: () => void; onUndo: () => void;
}) {
  useT();
  const id = useId();
  const decided = s.status !== "open";
  const meta = findingMeta({ ...s, priority: draft.priority, constraintKind: draft.constraintKind });
  return (
    <li className={cn("rounded-block px-4 py-3.5 ring-1 transition", decided ? "bg-surface2 ring-transparent" : "bg-surface ring-line", editing && "ring-accent/60")}>
      {editing ? (
        <div className="flex flex-col gap-3" data-enter-own="">
          <label htmlFor={id} className="sr-only">{sectionLabel(s.kind)}</label>
          <Textarea id={id} data-step-focus="" autoFocus rows={2} value={draft.text} maxLength={TEXT_MAX[s.kind]} disabled={disabled}
            className="text-[15px] leading-relaxed" onChange={(e) => onDraft({ ...draft, text: e.target.value })} />
          <div className="flex flex-wrap items-center gap-2">
            {s.kind === "mustHave" && <PriorityPicker size="sm" label={t("shell.setup.review.howImportant", "How important")} value={draft.priority} disabled={disabled} onChange={(priority) => onDraft({ ...draft, priority })} />}
            {s.kind === "constraint" && (
              <Select size="sm" label={t("shell.setup.review.constraintKind", "Kind of constraint")} className="w-[180px]" value={draft.constraintKind} disabled={disabled}
                options={CONSTRAINT_KINDS.map((k) => ({ value: k, label: constraintKindName(k) }))} onChange={(v) => onDraft({ ...draft, constraintKind: v as ConstraintKind })} />
            )}
            <span className="ml-auto flex gap-2">
              <Button size="sm" variant="ghost" onClick={onCancel} disabled={busy}>{t("common.actions.cancel", "Cancel")}</Button>
              <Button size="sm" variant="primary" icon={<Check size={14} aria-hidden />} onClick={onAdd} disabled={disabled || busy || !draft.text.trim()} aria-busy={busy || undefined}>{t("common.actions.add", "Add")}</Button>
            </span>
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap items-start gap-x-4 gap-y-2">
          <div className="min-w-0 flex-1 basis-72">
            <p className={cn("text-[15px] leading-snug", decided && s.status === "ignored" ? "text-ink3 line-through decoration-ink3/40" : "text-ink")}>{draft.text}</p>
            {meta && <p className="mt-1 flex items-center gap-1.5 text-[12px] text-ink3"><FileText size={12} aria-hidden />{meta}</p>}
          </div>
          {s.status === "added" ? (
            <Chip tone="success" icon={<Check size={12} aria-hidden />}>{t("shell.setup.review.added", "Added")}</Chip>
          ) : s.status === "ignored" ? (
            <span className="flex items-center gap-2">
              <Chip>{t("shell.setup.review.ignored", "Ignored")}</Chip>
              {!readOnly && <Button size="sm" variant="ghost" icon={<Undo2 size={14} aria-hidden />} onClick={onUndo} disabled={disabled || busy}>{t("shell.setup.review.undo", "Undo")}</Button>}
            </span>
          ) : readOnly ? (
            // read-only (past setup, or no right to edit): no dead buttons; the banner at the top says why
            <Chip>{t("shell.setup.review.notAdded", "Not added")}</Chip>
          ) : (
            <span className="flex shrink-0 gap-1.5">
              <Button size="sm" variant="primary" icon={<Check size={14} aria-hidden />} onClick={onAdd} disabled={disabled || busy} aria-busy={busy || undefined}
                aria-label={t("shell.setup.review.addItem", "Add: {text}", { text: draft.text })}>{t("common.actions.add", "Add")}</Button>
              <Button size="sm" variant="ghost" icon={<PencilLine size={14} aria-hidden />} onClick={onEdit} disabled={disabled || busy} aria-label={t("shell.setup.review.editItem", "Edit: {text}", { text: draft.text })}>{t("common.actions.edit", "Edit")}</Button>
              <Button size="sm" variant="ghost" icon={<X size={14} aria-hidden />} onClick={onIgnore} disabled={disabled || busy} aria-label={t("shell.setup.review.ignoreItem", "Ignore: {text}", { text: draft.text })}>{t("shell.setup.review.ignore", "Ignore")}</Button>
            </span>
          )}
        </div>
      )}
    </li>
  );
}
