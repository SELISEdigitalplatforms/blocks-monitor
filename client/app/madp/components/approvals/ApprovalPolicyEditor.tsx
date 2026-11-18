import { useEffect, useId, useMemo, useRef, useState } from "react";
import { AlertCircle, CircleCheck, CircleDashed, Plus, ShieldCheck, Trash2 } from "lucide-react";
import { Button, Card, Input, Select, Tabs } from "@/madp/ui/kit";
import { cn } from "@/madp/lib/cn";
import { formatDateTime } from "@/madp/lib/dates";
import type { DeliveryContext } from "@/madp/blocks/delivery/context";
import type { PolicyRecord } from "@/madp/blocks/delivery/types";
import { useApprovalPolicySave } from "@/madp/blocks/delivery/actions";
import { approvalStepLabel, LIMITS } from "@/madp/domain/delivery";
import { normalizePolicy, policyGaps, type ApprovalPolicyStep, type ApprovalStepType, type GatedEnvironment } from "@/madp/domain/promotion";
import { useT } from "@/madp/i18n";
import { draftProblem, draftSupersededBySaved, editorDraftFrom, envInSentence, envLabel, forcedRequiredReason, policyStepsSignature, stepMissingApprovers } from "./approvalsUi";

function typeOptions(t: (key: string, english: string) => string) {
  return [
    { value: "architect", label: t("platform.approvals.policy.type.architect", "Architect") },
    { value: "security", label: t("platform.approvals.policy.type.security", "Security") },
    { value: "qa", label: t("platform.approvals.policy.type.qa", "QA tester") },
    { value: "custom", label: t("platform.approvals.policy.type.custom", "Custom") },
  ];
}
const FILTER_ABOVE = 8;

function StepRow({ env, index, step, ctx, editable, flagged = false, onChange, onRemove }: {
  env: GatedEnvironment;
  index: number;
  step: ApprovalPolicyStep;
  ctx: DeliveryContext;
  editable: boolean;
  /** Save was pressed while this required step has nobody ticked: ringed so the person sees where to tick. */
  flagged?: boolean;
  onChange: (s: ApprovalPolicyStep) => void;
  onRemove: () => void;
}) {
  const t = useT();
  const id = useId();
  const [filter, setFilter] = useState("");
  const reason = forcedRequiredReason(env, step.type);
  const required = reason !== null || step.required;
  // the roles a release there always needs: their step stays (no remove, no change of role)
  const mandatory = (env === "production" ? ["architect", "security", "qa"] : ["architect", "security"]).includes(step.type);
  const name = approvalStepLabel(step.type, step.label);
  const q = filter.trim().toLowerCase();
  const known = new Set(ctx.members.map((m) => m.userId));
  const people = [
    ...ctx.members.map((m) => ({ userId: m.userId, name: m.displayName })),
    ...step.approverUserIds.filter((u) => !known.has(u)).map((u) => ({ userId: u, name: ctx.memberName(u) })),
  ].filter((p) => !q || p.name.toLowerCase().includes(q) || step.approverUserIds.includes(p.userId));
  const toggle = (userId: string, on: boolean) => {
    const set = on ? [...step.approverUserIds, userId] : step.approverUserIds.filter((u) => u !== userId);
    onChange({ ...step, approverUserIds: set });
  };
  return (
    <li data-step-missing={flagged ? "" : undefined} className={cn("rounded-block bg-surface2 p-4", flagged && "ring-2 ring-danger/60")}>
      <div className="flex flex-wrap items-end gap-3">
        <div className="w-44">
          <Select label={t("platform.approvals.policy.stepType", "Step {n} type", { n: index + 1 })} value={step.type} options={typeOptions(t)} disabled={!editable || mandatory}
            onChange={(v) => {
              const type = v as ApprovalStepType;
              const { label: _label, ...rest } = step;
              onChange({ ...rest, type, ...(type === "custom" ? { label: step.label ?? "" } : {}) });
            }} />
        </div>
        {step.type === "custom" && (
          <div className="min-w-[10rem] flex-1">
            <Input aria-label={t("platform.approvals.policy.stepLabel", "Step {n} label", { n: index + 1 })} placeholder={t("platform.approvals.policy.stepLabelPlaceholder", "Step label")} maxLength={LIMITS.customLabel}
              value={step.label ?? ""} disabled={!editable} onChange={(e) => onChange({ ...step, label: e.target.value })} />
          </div>
        )}
        <div className="flex items-center gap-2">
          <button type="button" role="switch" aria-checked={required} aria-label={t("platform.approvals.policy.requiredSwitch", "{name} approval required", { name })}
            aria-describedby={reason ? `${id}-why` : undefined} disabled={!editable || reason !== null}
            onClick={() => onChange({ ...step, required: !step.required })}
            className={cn("relative h-6 w-11 shrink-0 rounded-full outline-none transition focus-visible:ring-2 focus-visible:ring-accent/50 disabled:cursor-not-allowed disabled:opacity-60",
              required ? "bg-accent" : "bg-line")}>
            <span className={cn("absolute top-0.5 h-5 w-5 rounded-full bg-surface transition-all", required ? "left-[22px]" : "left-0.5")} />
          </button>
          {/* the switch's state in words, the same "Required" / "Optional" the approval request shows for this step */}
          <span className="text-[13px] text-ink2">{required ? t("platform.approvals.request.required", "Required") : t("platform.approvals.request.optional", "Optional")}</span>
        </div>
        {!mandatory && (
          <Button variant="ghost" size="sm" icon={<Trash2 size={14} strokeWidth={1.75} />} disabled={!editable}
            aria-label={t("platform.approvals.policy.removeStepN", "Remove step {n}", { n: index + 1 })} onClick={onRemove}>{t("platform.approvals.policy.removeStep", "Remove step")}</Button>
        )}
      </div>
      {reason && <p id={`${id}-why`} className="mt-2 text-[12px] text-ink3">{reason}</p>}
      <fieldset className="mt-3 min-w-0" disabled={!editable}>
        <legend className="mb-1.5 text-[12px] font-medium uppercase tracking-wider text-ink3">{t("platform.approvals.policy.approvers", "{name} approvers", { name })}</legend>
        {ctx.members.length > FILTER_ABOVE && (
          <div className="mb-2"><Input aria-label={t("platform.approvals.policy.filterApprovers", "Filter {name} approvers", { name })} placeholder={t("platform.approvals.policy.filterPeople", "Filter people")} value={filter} onChange={(e) => setFilter(e.target.value)} /></div>
        )}
        {people.length === 0 ? (
          <p className="text-[13px] text-ink3">{t("platform.approvals.policy.noMembers", "No active members to choose from.")}</p>
        ) : (
          <div className="grid gap-1 sm:grid-cols-2">
            {people.map((p) => {
              const on = step.approverUserIds.includes(p.userId);
              const capped = !on && step.approverUserIds.length >= LIMITS.stepApprovers;
              return (
                <label key={p.userId} className="flex min-w-0 items-center gap-2 rounded-md px-2 py-1.5 text-[14px] text-ink2">
                  <input type="checkbox" className="h-4 w-4 shrink-0 accent-accent focus-visible:ring-2 focus-visible:ring-accent/50"
                    checked={on} disabled={!editable || capped} onChange={(e) => toggle(p.userId, e.target.checked)} />
                  <span className="min-w-0 truncate">{p.name}</span>
                </label>
              );
            })}
          </div>
        )}
      </fieldset>
    </li>
  );
}

function EnvEditor({ ctx, env, record, editable: mayEdit, loading = false, draft, setDraft }: {
  ctx: DeliveryContext; env: GatedEnvironment; record: PolicyRecord | null; editable: boolean; loading?: boolean;
  /** The unsaved steps, held by the parent per environment so a Stage / Production switch keeps them. */
  draft: ApprovalPolicyStep[] | null; setDraft: (steps: ApprovalPolicyStep[] | null) => void;
}) {
  const t = useT();
  const editable = mayEdit && !loading;
  const memberKey = ctx.activeMemberIds.join(",");
  // with one active member, the suggestion already ticks that person (nobody else could approve)
  const loaded = useMemo(() => editorDraftFrom(record, env, ctx.activeMemberIds).steps.map((s) => ({ ...s, approverUserIds: [...s.approverUserIds] })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [record, env, memberKey]);
  const sig = policyStepsSignature(loaded);
  const sigAtSave = useRef<string | null>(null);
  const steps = draft ?? loaded;
  const setSteps = setDraft;
  const [shown, setShown] = useState(false);
  const save = useApprovalPolicySave(ctx);
  const activeIds = ctx.activeMemberIds;
  const problem = draftProblem({ environment: env, steps }, env, activeIds);
  const missingAt = stepMissingApprovers(env, steps);
  const missingName = missingAt === null ? "" : approvalStepLabel(steps[missingAt].type, steps[missingAt].label);
  // said next to the Save button: what to do, not only what is wrong
  const problemText = problem && missingAt !== null && /needs at least one approver/.test(problem)
    ? t("platform.approvals.policy.tickApprover", "Tick at least one person under {name} approvers, then save.", { name: missingName })
    : problem;
  const onlyMember = ctx.activeMemberIds.length === 1 ? ctx.activeMemberIds[0] : null;
  // the roles a release there needs but the steps lack (saving is still allowed; the release waits for them)
  const gaps = policyGaps(env, { environment: env, steps });
  const gapSteps = gaps.map((g) => (g === "qa" ? t("platform.approvals.policy.gapQa", "a QA tester")
    : g === "architect" ? t("platform.approvals.policy.gapArchitect", "an architect") : t("platform.approvals.policy.gapSecurity", "a security"))).join(t("platform.approvals.and", " and "));
  const gapNote = gaps.length
    ? gaps.length > 1
      ? t("platform.approvals.policy.gapNoteMany", "A release to {env} also needs {steps} steps. Add them with Add step.", { env: envInSentence(env), steps: gapSteps })
      : t("platform.approvals.policy.gapNoteOne", "A release to {env} also needs {steps} step. Add it with Add step.", { env: envInSentence(env), steps: gapSteps })
    : null;
  const patch = (i: number, s: ApprovalPolicyStep) => { save.reset(); setSteps(steps.map((x, j) => (j === i ? s : x))); };
  useEffect(() => {
    if (draftSupersededBySaved(draft !== null, sigAtSave.current, sig)) {
      setDraft(null);
      sigAtSave.current = null;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sig]);
  const onSave = async () => {
    setShown(true);
    if (problem) return;
    const normalized = normalizePolicy({ environment: env, steps });
    sigAtSave.current = sig;
    await save.run({
      environment: env,
      steps: normalized.steps.map((s) => ({
        type: s.type,
        ...(s.type === "custom" ? { label: (s.label ?? "").trim() } : {}),
        required: s.required,
        approverUserIds: [...s.approverUserIds],
      })),
    });
  };
  // the saved state, said plainly (the Scope step's Approvals chip reads the same saved policies): a policy nobody saved
  // is a suggestion, never shown as if it were set up
  const isSet = Boolean(record && record.policy.steps.length > 0);
  const savedOn = isSet ? formatDateTime(record!.updatedAt) : "";
  const unsaved = draft !== null && policyStepsSignature(draft) !== sig;
  return (
    <div className="mt-4">
      <p role="status" data-approvals-state={isSet ? "set-up" : "not-set-up"}
        className={cn("mb-4 flex items-start gap-2 rounded-block px-3.5 py-2.5 text-[13px]",
          isSet ? "bg-success-soft text-[rgb(var(--c-success-text))]" : "bg-warning-soft text-[rgb(var(--c-warning-text))]")}>
        {isSet ? <CircleCheck size={16} aria-hidden className="mt-px shrink-0" /> : <CircleDashed size={16} aria-hidden className="mt-px shrink-0" />}
        <span className="min-w-0">
          {isSet
            ? <><span className="font-medium">{t("platform.approvals.policy.setUp", "Set up")}</span>{savedOn ? t("platform.approvals.policy.savedOn", " · saved {when}", { when: savedOn }) : ""}{unsaved ? t("platform.approvals.policy.unsaved", ". Your changes below are not saved yet.") : "."}</>
            : onlyMember
              ? <><span className="font-medium">{t("platform.approvals.policy.notSetUp", "Not set up yet.")}</span> {onlyMember === ctx.userId
                ? t("platform.approvals.policy.onlyMemberYou", "You are the only member of this workspace, so you are already ticked as the approver. Nothing is saved until you save.")
                : t("platform.approvals.policy.onlyMemberOther", "{name} is the only member of this workspace, so they are already ticked as the approver. Nothing is saved until you save.", { name: ctx.memberName(onlyMember) })}</>
              : <><span className="font-medium">{t("platform.approvals.policy.notSetUp", "Not set up yet.")}</span> {t("platform.approvals.policy.suggestion", "The steps below are a suggestion: nothing is saved until you choose the approvers and save.")}</>}
        </span>
      </p>
      {!editable && <p className="mb-3 text-[13px] text-ink3">{t("platform.approvals.policy.readOnly", "Only people who manage approvals can change this.")}</p>}
      <ul className="space-y-3">
        {steps.map((s, i) => (
          <StepRow key={i} env={env} index={i} step={s} ctx={ctx} editable={editable} flagged={shown && missingAt === i} onChange={(n) => patch(i, n)}
            onRemove={() => { save.reset(); setSteps(steps.filter((_, j) => j !== i)); }} />
        ))}
      </ul>
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <Button variant="ghost" size="sm" icon={<Plus size={14} strokeWidth={1.75} />}
          disabled={!editable || steps.length >= LIMITS.policySteps}
          onClick={() => { save.reset(); setSteps([...steps, { type: "custom", label: "", required: env === "production", approverUserIds: [] }]); }}>{t("platform.approvals.policy.addStep", "Add step")}</Button>
        {steps.length >= LIMITS.policySteps && <span className="text-[12px] text-ink3">{t("platform.approvals.policy.maxSteps", "At most {n} steps.", { n: LIMITS.policySteps })}</span>}
        <Button variant="secondary" disabled={!editable || save.pending} onClick={onSave}>
          {save.pending ? t("platform.approvals.policy.saving", "Saving…") : t("platform.approvals.policy.save", "Save {env} approvals", { env: envInSentence(env) })}
        </Button>
        {/* the outcome of Save, right next to it: never a click that seems to do nothing */}
        <span aria-live="polite" className="min-w-0 basis-full text-[13px] sm:basis-auto">
          {shown && problemText ? (
            <span role="alert" data-approvals-feedback="problem" className="inline-flex items-start gap-1.5 rounded-full bg-danger-soft px-3 py-1.5 font-medium text-danger">
              <AlertCircle size={15} aria-hidden className="mt-px shrink-0" />
              <span className="min-w-0">{t("platform.approvals.policy.notSaved", "Not saved. {reason}", { reason: problemText })}</span>
            </span>
          ) : save.error ? (
            <span role="alert" data-approvals-feedback="error" className="inline-flex items-start gap-1.5 rounded-full bg-danger-soft px-3 py-1.5 font-medium text-danger">
              <AlertCircle size={15} aria-hidden className="mt-px shrink-0" />
              <span className="min-w-0">{t("platform.approvals.policy.notSaved", "Not saved. {reason}", { reason: String(save.error) })}</span>
            </span>
          ) : save.success ? (
            <span data-approvals-feedback="saved" className="inline-flex items-center gap-1.5 font-medium text-[rgb(var(--c-success-text))]">
              <CircleCheck size={15} aria-hidden className="shrink-0" />{t("platform.approvals.policy.saved", "Saved.")}
            </span>
          ) : null}
        </span>
      </div>
      {gapNote && <p className="mt-3 text-[13px] text-[rgb(var(--c-warning-text))]">{gapNote}</p>}
    </div>
  );
}

/** Edits the stage and production approval policies of a project. The server decides; this only guides. */
export function ApprovalPolicyEditor({ ctx, policies, initialEnvironment = "stage", loading = false }: {
  ctx: DeliveryContext;
  policies: readonly PolicyRecord[];
  loading?: boolean;
  initialEnvironment?: GatedEnvironment;
}) {
  const t = useT();
  const [env, setEnv] = useState<GatedEnvironment>(initialEnvironment);
  const [drafts, setDrafts] = useState<Partial<Record<GatedEnvironment, ApprovalPolicyStep[] | null>>>({});
  const record = policies.find((p) => p.environment === env) ?? null;
  const editable = ctx.can("release.manage-approvals");
  return (
    <Card title={t("platform.approvals.policy.title", "Who approves a release")} icon={<ShieldCheck size={18} strokeWidth={1.75} />}>
      <Tabs label={t("platform.approvals.policy.environment", "Environment")} value={env} onChange={setEnv}
        tabs={[{ value: "stage", label: envLabel("stage") }, { value: "production", label: envLabel("production") }]} />
      {loading ? (
        <p role="status" className="mt-4 text-[14px] text-ink2">{t("platform.approvals.policy.loading", "Loading who approves…")}</p>
      ) : (
        // the unsaved steps of each environment live here: switching Stage / Production does not throw them away
        <EnvEditor key={env} ctx={ctx} env={env} record={record} editable={editable} loading={loading}
          draft={drafts[env] ?? null} setDraft={(steps) => setDrafts((d) => ({ ...d, [env]: steps }))} />
      )}
    </Card>
  );
}
