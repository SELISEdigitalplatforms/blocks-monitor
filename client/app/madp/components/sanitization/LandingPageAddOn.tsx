/** The "Landing page" add-on of Understanding your project: a highlighted chip in the step's checklist and its window.
 *  The client says whether they want a landing page (no / a new one / a change to the existing one) and, if so, what
 *  it should say and do. Saved through project.addon.landingPage.save; the answers become their own section in Goals
 *  & requirements. Rules: src/domain/landingPage.ts. */
import { landingChoiceName } from "@/madp/components/requirements/domainLabels";
import { useEffect, useId, useState, type FormEvent, type ReactNode } from "react";
import { Eye, Info, PanelsTopLeft } from "lucide-react";
import { Banner, Button, Modal, Textarea } from "@/madp/ui/kit";
import { showToast } from "@/madp/ui/Toast";
import { cn } from "@/madp/lib/cn";
import { callProjectOp, putRows } from "@/madp/blocks/projects/mutations";
import { messageFor } from "@/madp/blocks/projects/messages";
import { SCHEMA, type RawRow } from "@/madp/blocks/projects/records";
import type { StepChip } from "@/madp/components/step/StepFrame";
import { useBlocksContext } from "@/madp/blocks/context";
import { can } from "@/madp/domain/rbac";
import { effectiveStep } from "@/madp/domain/projects";
import {
  LANDING_LIMITS, checkLanding, landingAccess, type LandingWay, landingChipValue, landingDraft, landingProblemText, landingState,
  parseLandingAddOn, splitReferences, type LandingAddOn, type LandingAnswers, type LandingChoice,
} from "@/madp/domain/landingPage";
import { t, useT } from "@/madp/i18n";

export interface LandingProject {
  ItemId: string; RepoMode?: string | null; WebsiteUrl?: string | null; LandingPageAddOn?: string | null; Stage?: string | null; ResumeTo?: string | null;
}

export interface SaveLandingResult { project: RawRow; changeNumber: number | null }

export async function saveLanding(workspaceId: string, args: { projectId: string; choice: LandingChoice; answers: LandingAnswers | null }): Promise<SaveLandingResult> {
  const data = await callProjectOp<{ project: RawRow; changeNumber?: number | null }>("project.addon.landingPage.save", { ...args });
  putRows(workspaceId, SCHEMA.project, [data.project]);
  return { project: data.project, changeNumber: data.changeNumber ?? null };
}

/** Who may change the answers on this project now, and how (src/domain/landingPage.ts landingAccess). */
export function useLandingAccess(project: LandingProject): ReturnType<typeof landingAccess> {
  const { permissions, isSuperAdmin } = useBlocksContext();
  const stage = project.Stage ?? "";
  return landingAccess({
    stage, step: effectiveStep(stage, project.ResumeTo ?? undefined),
    canEditUnderstanding: isSuperAdmin || can(permissions, "sanitization.edit"),
    canRequestChange: isSuperAdmin || can(permissions, "build.run"),
  });
}

/** The checklist chip and its window, for a step frame. The chip always opens the window: to change the answers, or to
 *  read them with a line saying who can change them. */
export function useLandingAddOn({ workspaceId, project }: { workspaceId: string; project: LandingProject }):
  { chip: StepChip; dialog: ReactNode; addOn: LandingAddOn | null } {
  const t = useT();
  const [open, setOpen] = useState(false);
  const access = useLandingAccess(project);
  const addOn = parseLandingAddOn(project.LandingPageAddOn);
  const state = landingState(addOn);
  const chip: StepChip = {
    id: "landingPage",
    label: t("settings.sanitization.landing.title", "Landing page"),
    value: landingChipValue(addOn),
    state: state === "open" ? "todo" : "done",
    addOn: { icon: <PanelsTopLeft size={16} strokeWidth={1.75} /> },
    icon: state === "open" ? undefined : <PanelsTopLeft size={15} strokeWidth={1.75} />,
    title: state === "open"
      ? t("settings.sanitization.landing.chipAsk", "Optional: would you like a landing page for your product?")
      : t("settings.sanitization.landing.chipChosen", "Landing page · {choice}", { choice: addOn ? landingChoiceName(addOn.choice) : "" }),
    onClick: () => setOpen(true),
    todoLabel: access.editable ? undefined : "",
    editableAfterSignOff: true,
  };
  const dialog = (
    <LandingPageDialog open={open} onClose={() => setOpen(false)} workspaceId={workspaceId} projectId={project.ItemId}
      websiteUrl={project.WebsiteUrl ?? ""} saved={addOn}
      readOnlyReason={access.reason} way={access.way} />
  );
  return { chip, dialog, addOn };
}

type Errors = Partial<Record<keyof LandingAnswers | "choice", string>>;

/** The three answers, in the current language (read at render time). */
function choices(): readonly { value: LandingChoice; title: string; text: string }[] {
  return [
    { value: "none", title: t("settings.sanitization.landing.choice.noneTitle", "No, thanks"), text: t("settings.sanitization.landing.choice.noneText", "We don't need a landing page for now.") },
    { value: "new", title: t("settings.sanitization.landing.choice.newTitle", "Yes, a new landing page"), text: t("settings.sanitization.landing.choice.newText", "A dedicated page for the product, made from scratch.") },
    { value: "modify", title: t("settings.sanitization.landing.choice.modifyTitle", "Yes, change our existing landing page"), text: t("settings.sanitization.landing.choice.modifyText", "We update the page you already have.") },
  ];
}

function Field({ label, hint, error, htmlFor, children }: { label: string; hint?: string; error?: string; htmlFor: string; children: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <label htmlFor={htmlFor} className="text-[12px] font-medium uppercase tracking-wider text-ink3">{label}</label>
      {hint && <p className="-mt-1 text-[13px] text-ink2">{hint}</p>}
      {children}
      {error && <p id={`${htmlFor}-error`} role="alert" className="text-[13px] text-danger">{error}</p>}
    </div>
  );
}

export function LandingPageDialog({ open, onClose, workspaceId, projectId, websiteUrl, saved, readOnlyReason = null, way = "direct" }: {
  open: boolean; onClose: () => void; workspaceId: string; projectId: string; websiteUrl: string; saved: LandingAddOn | null;
  /** Set when the person can only read the answers: the line saying why and who can change them. */
  readOnlyReason?: string | null;
  /** "change": the requirements are approved, so saving opens (or updates) a draft change request. */
  way?: LandingWay;
}) {
  const t = useT();
  const readOnly = readOnlyReason !== null;
  const ids = useId();
  const [choice, setChoice] = useState<LandingChoice | null>(null);
  const [a, setA] = useState<LandingAnswers>(() => landingDraft(saved, websiteUrl).answers);
  const [refs, setRefs] = useState("");
  const [errors, setErrors] = useState<Errors>({});
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    const d = landingDraft(saved, websiteUrl);
    setChoice(d.choice);
    setA(d.answers);
    setRefs(d.answers.references.join("\n"));
    setErrors({});
    setError(null);
    // reopened on purpose: the saved answers are the starting point each time
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const set = (patch: Partial<LandingAnswers>) => {
    setA((x) => ({ ...x, ...patch }));
    setErrors((e) => { const n = { ...e }; for (const k of Object.keys(patch)) delete n[k as keyof Errors]; return n; });
  };
  const wanted = choice === "new" || choice === "modify";

  const submit = async (e?: FormEvent) => {
    e?.preventDefault();
    if (saving || readOnly) return;
    const answers = { ...a, references: splitReferences(refs) };
    const c = checkLanding({ choice, answers });
    if (!c.ok) {
      const next: Errors = {};
      for (const p of c.problems) next[p.key] ??= landingProblemText(p);
      setErrors(next);
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const res = await saveLanding(workspaceId, { projectId, ...c.value });
      showToast(res.changeNumber !== null
        ? t("settings.sanitization.landing.savedChange", "Saved as change request #{number} for the development team.", { number: res.changeNumber })
        : c.value.choice === "none" ? t("settings.sanitization.landing.savedNone", "Noted: no landing page for now.") : t("settings.sanitization.landing.saved", "Landing page saved. It's added to your requirements."));
      onClose();
    } catch (err) {
      setError(messageFor(err));
    } finally {
      setSaving(false);
    }
  };

  const id = (k: string) => `${ids}-${k}`;
  const err = (k: keyof Errors) => errors[k];
  const inv = (k: keyof Errors) => (errors[k] ? { "aria-invalid": true as const, "aria-describedby": `${id(k)}-error` } : {});

  return (
    <Modal open={open} onClose={onClose} title={t("settings.sanitization.landing.title", "Landing page")} width={640}
      footer={readOnly ? <Button variant="ghost" onClick={onClose}>{t("settings.sanitization.landing.close", "Close")}</Button> : <>
        <Button variant="ghost" onClick={onClose}>{t("settings.sanitization.landing.cancel", "Cancel")}</Button>
        <Button variant="primary" type="submit" form={id("form")} disabled={saving}>{saving ? t("settings.sanitization.landing.saving", "Saving…") : way === "change" ? t("settings.sanitization.landing.saveAsChange", "Save as a change request") : t("settings.sanitization.landing.save", "Save")}</Button>
      </>}>
      <form id={id("form")} onSubmit={(e) => void submit(e)} noValidate className="flex flex-col gap-5">
        {readOnly ? (
          <p role="note" className="flex items-start gap-2 rounded-block bg-surface2 px-4 py-3 text-[14px] text-ink2">
            <Eye size={16} aria-hidden className="mt-0.5 shrink-0 text-ink3" /><span>{readOnlyReason}</span>
          </p>
        ) : way === "change" ? (
          <p role="note" className="flex items-start gap-2 rounded-block bg-warning-soft/60 px-4 py-3 text-[14px] text-ink">
            <Info size={16} aria-hidden className="mt-0.5 shrink-0 text-[rgb(var(--c-warning-text))]" />
            <span>{saved?.changeNumber
              ? t("settings.sanitization.landing.approvedUpdate", "The requirements are already approved. Saving updates change request #{number} for the development team and rewrites the Landing page section in Goals & requirements.", { number: saved.changeNumber })
              : t("settings.sanitization.landing.approvedOpen", "The requirements are already approved. Saving opens a change request for the development team and rewrites the Landing page section in Goals & requirements.")}</span>
          </p>
        ) : null}
        <p className="text-[14px] text-ink2">
          {t("settings.sanitization.landing.intro", "A landing page is one web page that presents your product and invites visitors to take the next step.")} {readOnly ? "" : t("settings.sanitization.landing.introAsk", "Would you like one with this project?")}
        </p>
        <fieldset className="min-w-0">
          <legend className="sr-only">{t("settings.sanitization.landing.question", "Would you like a landing page?")}</legend>
          <div role="radiogroup" aria-label={t("settings.sanitization.landing.question", "Would you like a landing page?")} aria-describedby={errors.choice ? `${id("choice")}-error` : undefined}
            className="grid gap-2">
            {choices().map((o) => (
              <label key={o.value}
                className={cn("flex cursor-pointer items-start gap-3 rounded-block px-4 py-3 ring-1 transition",
                  choice === o.value ? "bg-accent-soft/60 ring-accent" : readOnly ? "bg-surface opacity-60 ring-line" : "bg-surface ring-line hover:bg-surface2")}>
                <input type="radio" name={id("choice")} value={o.value} checked={choice === o.value} className="mt-1 accent-accent" disabled={readOnly && choice !== o.value}
                  onChange={() => { if (!readOnly) { setChoice(o.value); setErrors({}); } }} />
                <span className="min-w-0">
                  <span className="block text-[14px] font-medium text-ink">{o.title}</span>
                  <span className="block text-[13px] text-ink2">{o.text}</span>
                </span>
              </label>
            ))}
          </div>
          {errors.choice && <p id={`${id("choice")}-error`} role="alert" className="mt-2 text-[13px] text-danger">{errors.choice}</p>}
        </fieldset>

        {wanted && (
          <div className="flex flex-col gap-4 border-t border-line pt-4">
            <Field label={t("settings.sanitization.landing.purposeLabel", "What should the page achieve, and for whom?")} htmlFor={id("purpose")} error={err("purpose")}>
              <Textarea id={id("purpose")} data-autofocus rows={3} className="min-h-[80px]" value={a.purpose} readOnly={readOnly} maxLength={LANDING_LIMITS.purpose}
                placeholder={t("settings.sanitization.landing.purposePlaceholder", "For example: tell small shop owners what the app does and get them to sign up")}
                onChange={(e) => set({ purpose: e.target.value })} {...inv("purpose")} />
            </Field>
            <Field label={t("settings.sanitization.landing.notesLabel", "Anything it must include? (optional)")} htmlFor={id("notes")} error={err("notes")}>
              <Textarea id={id("notes")} rows={2} className="min-h-[64px]" value={a.notes} readOnly={readOnly} maxLength={LANDING_LIMITS.notes}
                placeholder={t("settings.sanitization.landing.notesPlaceholder", "For example: customer quotes, a contact form, German and English")}
                onChange={(e) => set({ notes: e.target.value })} {...inv("notes")} />
            </Field>
            <Field label={t("settings.sanitization.landing.refsLabel", "Website or examples you like (optional)")} hint={t("settings.sanitization.landing.refsHint", "Web addresses, one per line.")} htmlFor={id("references")} error={err("references")}>
              <Textarea id={id("references")} rows={2} className="min-h-[64px]" value={refs} readOnly={readOnly} placeholder="www.example.com"
                onChange={(e) => { setRefs(e.target.value); setErrors((x) => ({ ...x, references: undefined })); }} {...inv("references")} />
            </Field>
          </div>
        )}
        {error && <Banner tone="danger" title={error} />}
      </form>
    </Modal>
  );
}
