/** Technical consultation: stack, architecture, integrations and non-functional requirements, agreed with the tech lead. */
import { areaName, nameOr, nfrCategoryName, techStatusName } from "@/components/requirements/domainLabels";
import { byNewestNumber } from "@/lib/newest";
import { useEffect, useRef, useState } from "react";
import { Check, CircleCheck, CircleDot, CircleX, Cpu, Lightbulb, Pencil, Trash2, X } from "lucide-react";
import { Button, Card, Chip, EmptyState, Input, Modal, Select, Textarea } from "@/ui/kit";
import { EngineJobStatus } from "@/components/engine/EngineJobStatus";
import { useEngineJobs } from "@/blocks/engine/jobs";
import { engineOutputIds, latestAssistJob, useTechDecisions } from "@/blocks/sanitization/hooks";
import { useAskMadp, useDeleteTechDecision, useSaveTechDecision } from "@/blocks/sanitization/ops";
import { sanitizationErrorText } from "@/blocks/sanitization/messages";
import {
  NFR_CATEGORIES, SANITIZATION_CAPS, TECH_AREAS, TECH_AREA_GROUPS, TECH_STATUSES,
} from "@/domain/sanitization";
import { formatNumber } from "@/domain/numbering";
import { FromMadpChip, LoadError, ReadOnlyNote, WriteNote, type SectionProps } from "./shared";
import { startOnce } from "./CompleteSanitizationModal";
import { deleteOnce } from "./DiscussionSection";
import { t, useT } from "@/i18n";

interface TechRow {
  ItemId: string; Number: number; Area: string; Title: string; Choice?: string | null; Rationale?: string | null; Alternatives?: string | string[] | null;
  ExpertUserIds?: string[] | null; Status: string; NfrCategory?: string | null; NfrTarget?: string | null; IntegrationSystem?: string | null;
  LastUpdatedDate?: string | null;
}
interface Group { label: string; areas: string[] }

type ChipTone = "neutral" | "success" | "warning" | "danger";
const TONE: Record<string, ChipTone> = { accepted: "success", proposed: "warning", rejected: "danger" };
const ICON: Record<string, typeof CircleCheck> = { accepted: CircleCheck, proposed: CircleDot, rejected: CircleX };
const MAX_CONSULTED = 10;

function readRows<T>(r: unknown): { rows: T[]; isError: boolean; refetch: () => void } {
  if (Array.isArray(r)) return { rows: r as T[], isError: false, refetch: () => undefined };
  const q = (r ?? {}) as { data?: unknown; isError?: boolean; refetch?: () => void };
  return { rows: Array.isArray(q.data) ? (q.data as T[]) : [], isError: q.isError === true, refetch: q.refetch ?? (() => undefined) };
}

function groupsOf(): Group[] {
  return (TECH_AREA_GROUPS as readonly string[]).map((a) => ({ label: nameOr(areaName, TECH_AREAS, a), areas: [a] }));
}

interface Form {
  id: string | null; area: string; topic: string; choice: string; rationale: string; alternatives: string; status: string;
  nfrCategory: string; target: string; system: string; consulted: string[]; expectedUpdatedAt: string | undefined;
}
const altText = (a: string | string[] | null | undefined): string => (Array.isArray(a) ? a.join("\n") : a ?? "");
const EMPTY: Form = { id: null, area: "stack", topic: "", choice: "", rationale: "", alternatives: "", status: "proposed", nfrCategory: "performance", target: "", system: "", consulted: [], expectedUpdatedAt: undefined };

/** Why 'Save technical decision' is disabled because of a missing NFR target or integration system, if it is. */
export function technicalSaveHint(f: { area: string; target: string; system: string }): string | null {
  if (f.area === "nfr" && f.target.trim() === "") return t("settings.sanitization.technical.hintTarget", "Add a target for this non-functional requirement.");
  if (f.area === "integration" && f.system.trim() === "") return t("settings.sanitization.technical.hintSystem", "Name the integration system.");
  return null;
}

export function TechnicalSaveHint({ id, hint }: { id: string; hint: string | null }) {
  return hint ? <p id={id} className="text-[12px] text-ink3">{hint}</p> : null;
}

export function TechnicalSection({ workspaceId, projectId, access, members, existing, title, headerAction }: SectionProps) {
  const t = useT();
  const ctx = { workspaceId, projectId };
  const tq = readRows<TechRow>(useTechDecisions(ctx));
  const save = useSaveTechDecision(ctx);
  const del = useDeleteTechDecision(ctx);
  const ask = useAskMadp(ctx);
  const jobs = useEngineJobs(projectId, ["sanitization.assist"]).data ?? [];
  const suggested = new Set<string>(engineOutputIds(jobs, "sanitization.assist", "TechDecision") as Iterable<string>);
  const assistJob = latestAssistJob(jobs, "technical");
  const [form, setForm] = useState<Form | null>(null);
  const formRef = useRef<HTMLFormElement>(null);
  // opening the form (new or edit) brings it into view and focuses the first field
  const formKey = form ? (form.id ?? "") : null;
  useEffect(() => {
    if (formKey === null) return;
    formRef.current?.scrollIntoView?.({ block: "center", behavior: "smooth" });
    formRef.current?.querySelector<HTMLElement>("#tech-topic")?.focus({ preventScroll: true });
  }, [formKey]);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const delInFlight = useRef(false);
  const saveInFlight = useRef(false);
  const caps = SANITIZATION_CAPS as Record<string, number>;

  if (tq.isError) return <LoadError onRetry={tq.refetch} />;

  // newest first in each area (a decision's number is its creation order), as Decisions so far
  const rows = byNewestNumber(tq.rows, (r) => r.Number);
  const editingRow = form?.id ? rows.find((r) => r.ItemId === form.id) : undefined;
  const editing = editingRow ? formatNumber("T", editingRow.Number) : null;
  const groups = groupsOf();
  const known = new Set(groups.flatMap((g) => g.areas));
  const others = rows.filter((r) => !known.has(r.Area));
  const all: Array<Group & { rows: TechRow[] }> = groups.map((g) => ({ ...g, rows: rows.filter((r) => g.areas.includes(r.Area)) }));
  if (others.length > 0) all.push({ label: t("settings.sanitization.technical.otherAreas", "Other areas"), areas: [], rows: others });

  const canSubmit = form !== null && form.topic.trim() !== "" && !save.isPending
    && (form.area !== "nfr" || form.target.trim() !== "") && (form.area !== "integration" || form.system.trim() !== "");
  const saveHint = form ? technicalSaveHint(form) : null;
  const submit = () => {
    if (!form || !canSubmit) return;
    startOnce(saveInFlight, (done) => save.mutate({
      projectId, ...(form.id ? { id: form.id } : {}), area: form.area, topic: form.topic, choice: form.choice, rationale: form.rationale,
      alternativesConsidered: form.alternatives, status: form.status,
      ...(form.area === "nfr" ? { nfrCategory: form.nfrCategory, target: form.target } : {}),
      ...(form.area === "integration" ? { integrationSystem: form.system } : {}),
      consultedUserIds: form.consulted,
      ...(form.expectedUpdatedAt ? { expectedUpdatedAt: form.expectedUpdatedAt } : {}),
    }, { onSuccess: () => setForm(null), onSettled: done }));
  };
  const decide = (r: TechRow, status: "accepted" | "rejected") =>
    startOnce(saveInFlight, (done) => save.mutate({
      projectId, id: r.ItemId, area: r.Area, topic: r.Title, status,
      ...(r.Area === "nfr" ? { nfrCategory: r.NfrCategory ?? "", target: r.NfrTarget ?? "" } : {}),
      ...(r.Area === "integration" ? { integrationSystem: r.IntegrationSystem ?? "" } : {}),
      ...(r.LastUpdatedDate ? { expectedUpdatedAt: r.LastUpdatedDate } : {}),
    }, { onSettled: done }));
  const toggle = (id: string) => form && setForm({ ...form, consulted: form.consulted.includes(id) ? form.consulted.filter((x) => x !== id) : form.consulted.length >= MAX_CONSULTED ? form.consulted : [...form.consulted, id] });
  const confirm = confirmId ? rows.find((r) => r.ItemId === confirmId) : undefined;
  const lbl = "mb-1.5 block text-[12px] font-medium uppercase tracking-wider text-ink3";

  return (
    <Card title={title ?? (existing ? t("settings.sanitization.technical.titleExisting", "What we found in your product") : t("settings.sanitization.technical.title", "Technical notes"))} icon={<Cpu size={18} strokeWidth={1.75} />} action={headerAction}>
      <div className="flex flex-col gap-5">
        {!access.canEdit && <ReadOnlyNote access={access} />}
        <WriteNote state={save.isPending || del.isPending ? "saving" : save.isError || del.isError ? "error" : save.isSuccess || del.isSuccess ? "saved" : "idle"}
          error={save.isError ? save.error : del.isError ? del.error : undefined}
          onRetry={save.isError ? submit : undefined} />

        {access.canEdit && (
          <div className="flex flex-wrap items-center gap-3">
            {!form && <Button variant="secondary" size="sm" icon={<Cpu size={14} strokeWidth={1.75} aria-hidden />} onClick={() => setForm({ ...EMPTY })}>{t("settings.sanitization.technical.add", "Add a technical decision")}</Button>}
            <Button variant="ghost" size="sm" icon={<Lightbulb size={14} strokeWidth={1.75} aria-hidden />} disabled={ask.isPending}
              onClick={() => ask.mutate({ projectId, focus: "technical" })}>{existing ? t("settings.sanitization.technical.readCodeAgain", "Read the code again") : t("settings.sanitization.technical.suggestMore", "Suggest more options")}</Button>
            <EngineJobStatus job={assistJob ?? null} variant="compact" requestError={ask.isError ? sanitizationErrorText(ask.error) : null} />
          </div>
        )}
        {!access.canEdit && assistJob && <EngineJobStatus job={assistJob} variant="compact" />}

        {access.canEdit && form && (
          <form ref={formRef} className="flex flex-col gap-3 rounded-block bg-surface2 p-4" aria-label={editing ? t("settings.sanitization.technical.editNumber", "Edit {number}", { number: editing }) : t("settings.sanitization.technical.formAria", "Technical decision")} onSubmit={(e) => { e.preventDefault(); submit(); }}>
            <h3 className="text-[15px] font-medium">{editing ? t("settings.sanitization.technical.editNumber", "Edit {number}", { number: editing }) : t("settings.sanitization.technical.add", "Add a technical decision")}</h3>
            <Select label={t("settings.sanitization.technical.area", "Area")} value={form.area} onChange={(v) => setForm({ ...form, area: v })}
              options={(TECH_AREAS as readonly string[]).map((a) => ({ value: a, label: nameOr(areaName, TECH_AREAS, a) }))} />
            <div><label htmlFor="tech-topic" className={lbl}>{t("settings.sanitization.technical.topic", "Topic")}</label>
              <Input id="tech-topic" value={form.topic} maxLength={caps.techTopic ?? 200} onChange={(e) => setForm({ ...form, topic: e.target.value })} /></div>
            <div><label htmlFor="tech-choice" className={lbl}>{t("settings.sanitization.technical.choice", "Choice")}</label>
              <Input id="tech-choice" value={form.choice} maxLength={caps.techChoice ?? 500} onChange={(e) => setForm({ ...form, choice: e.target.value })} /></div>
            <div><label htmlFor="tech-why" className={lbl}>{t("settings.sanitization.technical.rationale", "Rationale")}</label>
              <Textarea id="tech-why" value={form.rationale} maxLength={caps.techRationale ?? 5000} onChange={(e) => setForm({ ...form, rationale: e.target.value })} /></div>
            <div><label htmlFor="tech-alt" className={lbl}>{t("settings.sanitization.technical.alternatives", "Alternatives considered")}</label>
              <Textarea id="tech-alt" value={form.alternatives} maxLength={caps.techAlternatives ?? 5000} onChange={(e) => setForm({ ...form, alternatives: e.target.value })} /></div>
            <Select label={t("settings.sanitization.technical.status", "Status")} value={form.status} onChange={(v) => setForm({ ...form, status: v })}
              options={(TECH_STATUSES as readonly string[]).map((s) => ({ value: s, label: nameOr(techStatusName, TECH_STATUSES, s) }))} />
            {form.area === "nfr" && (<>
              <Select label={t("settings.sanitization.technical.nfrCategory", "NFR category")} value={form.nfrCategory} onChange={(v) => setForm({ ...form, nfrCategory: v })}
                options={(NFR_CATEGORIES as readonly string[]).map((c) => ({ value: c, label: nameOr(nfrCategoryName, NFR_CATEGORIES, c) }))} />
              <div><label htmlFor="tech-target" className={lbl}>{t("settings.sanitization.technical.target", "Target (measurable)")}</label>
                <Input id="tech-target" value={form.target} onChange={(e) => setForm({ ...form, target: e.target.value })} /></div>
            </>)}
            {form.area === "integration" && (
              <div><label htmlFor="tech-system" className={lbl}>{t("settings.sanitization.technical.system", "Integration system")}</label>
                <Input id="tech-system" value={form.system} onChange={(e) => setForm({ ...form, system: e.target.value })} /></div>
            )}
            <fieldset>
              <legend className={lbl}>{t("settings.sanitization.technical.consultedLegend", "Consulted people (up to {max})", { max: MAX_CONSULTED })}</legend>
              <div className="flex flex-col gap-1.5">
                {members.list.map((m) => {
                  const on = form.consulted.includes(m.userId);
                  return (
                    <label key={m.userId} className="flex items-center gap-2 text-[14px]">
                      <input type="checkbox" checked={on} disabled={!on && form.consulted.length >= MAX_CONSULTED} onChange={() => toggle(m.userId)} className="h-4 w-4 accent-[rgb(var(--c-accent))]" />
                      {m.name}
                    </label>
                  );
                })}
              </div>
            </fieldset>
            <div className="flex flex-wrap gap-2">
              <Button type="submit" variant="secondary" size="sm" disabled={!canSubmit} aria-describedby={saveHint ? "tech-save-hint" : undefined}>{save.isPending ? t("settings.sanitization.technical.saving", "Saving…") : t("settings.sanitization.technical.save", "Save technical decision")}</Button>
              <Button variant="ghost" size="sm" onClick={() => setForm(null)}>{t("settings.sanitization.technical.cancel", "Cancel")}</Button>
            </div>
            <TechnicalSaveHint id="tech-save-hint" hint={saveHint} />
          </form>
        )}

        {rows.length === 0 ? (
          <EmptyState icon={<Cpu size={20} strokeWidth={1.75} />} title={t("settings.sanitization.technical.empty", "No technical decisions yet. Record the tech stack, architecture, integrations and non-functional requirements with your tech lead.")} />
        ) : all.map((g) => (
          <section key={g.label} aria-label={g.label}>
            <h3 className="mb-2 flex items-center gap-2 text-[15px] font-medium">{g.label}<span className="num text-[13px] text-ink3">{g.rows.length}</span></h3>
            {g.rows.length === 0 ? <p className="text-[14px] text-ink3">{t("settings.sanitization.technical.groupEmpty", "Nothing recorded for {area} yet.", { area: g.label })}</p> : (
              <ul className="flex flex-col gap-3">
                {g.rows.map((r) => {
                  const Icon = ICON[r.Status] ?? CircleDot;
                  const people = (r.ExpertUserIds ?? []).map((id) => members.nameOf(id));
                  return (
                    <li key={r.ItemId} className="rounded-block bg-surface2 p-4">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="num text-[13px] font-medium text-ink2">{formatNumber("T", r.Number)}</span>
                        <h4 className="min-w-0 break-words text-[15px] font-medium">{r.Title}</h4>
                        <Chip tone={TONE[r.Status] ?? "neutral"} icon={<Icon size={12} strokeWidth={1.75} aria-hidden />}>{nameOr(techStatusName, TECH_STATUSES, r.Status)}</Chip>
                        {suggested.has(r.ItemId) && <FromMadpChip label={t("settings.sanitization.technical.suggestedByMadp", "Suggested by MADP")} />}
                      </div>
                      {r.Choice && <p className="mt-2 whitespace-pre-wrap break-words text-[14px]">{r.Choice}</p>}
                      {r.Area === "nfr" && (r.NfrCategory || r.NfrTarget) && (
                        <p className="mt-1 text-[14px] text-ink2">{r.NfrCategory && r.NfrTarget
                          ? t("settings.sanitization.technical.nfrLine", "{category} · Target: {target}", { category: nameOr(nfrCategoryName, NFR_CATEGORIES, r.NfrCategory), target: r.NfrTarget })
                          : r.NfrTarget ? t("settings.sanitization.technical.nfrTarget", "Target: {target}", { target: r.NfrTarget }) : nameOr(nfrCategoryName, NFR_CATEGORIES, r.NfrCategory ?? "")}</p>
                      )}
                      {r.Area === "integration" && r.IntegrationSystem && <p className="mt-1 text-[14px] text-ink2">{t("settings.sanitization.technical.systemLine", "System: {system}", { system: r.IntegrationSystem })}</p>}
                      {r.Rationale && <p className="mt-2 whitespace-pre-wrap break-words text-[14px] text-ink2">{t("settings.sanitization.technical.why", "Why: {rationale}", { rationale: r.Rationale })}</p>}
                      {altText(r.Alternatives) && <p className="mt-2 whitespace-pre-wrap break-words text-[14px] text-ink2">{t("settings.sanitization.technical.alternativesLine", "Alternatives considered: {alternatives}", { alternatives: altText(r.Alternatives) })}</p>}
                      {people.length > 0 && <p className="mt-2 text-[13px] text-ink3">{t("settings.sanitization.technical.consultedLine", "Consulted: {people}", { people: people.join(", ") })}</p>}
                      {access.canEdit && (
                        <div className="mt-3 flex flex-wrap items-center gap-2">
                          {r.Status === "proposed" && (<>
                            <Button variant="ghost" size="sm" icon={<Check size={14} strokeWidth={1.75} aria-hidden />} disabled={save.isPending} onClick={() => decide(r, "accepted")} aria-label={t("settings.sanitization.technical.agreeAria", "Agree {number}", { number: formatNumber("T", r.Number) })}>{t("settings.sanitization.technical.agree", "Agree")}</Button>
                            <Button variant="ghost" size="sm" icon={<X size={14} strokeWidth={1.75} aria-hidden />} disabled={save.isPending} onClick={() => decide(r, "rejected")} aria-label={t("settings.sanitization.technical.rejectAria", "Reject {number}", { number: formatNumber("T", r.Number) })}>{t("settings.sanitization.technical.reject", "Reject")}</Button>
                          </>)}
                          <Button variant="ghost" size="sm" icon={<Pencil size={14} strokeWidth={1.75} aria-hidden />} aria-label={t("settings.sanitization.technical.editNumber", "Edit {number}", { number: formatNumber("T", r.Number) })}
                            onClick={() => setForm({ id: r.ItemId, area: r.Area, topic: r.Title, choice: r.Choice ?? "", rationale: r.Rationale ?? "", alternatives: altText(r.Alternatives), status: r.Status,
                              nfrCategory: r.NfrCategory || "performance", target: r.NfrTarget ?? "", system: r.IntegrationSystem ?? "", consulted: r.ExpertUserIds ?? [], expectedUpdatedAt: r.LastUpdatedDate ?? undefined })}>{t("settings.sanitization.technical.edit", "Edit")}</Button>
                          <Button variant="danger" size="sm" icon={<Trash2 size={14} strokeWidth={1.75} aria-hidden />} aria-label={t("settings.sanitization.technical.deleteAria", "Delete {number}", { number: formatNumber("T", r.Number) })} onClick={() => setConfirmId(r.ItemId)}>{t("settings.sanitization.technical.delete", "Delete")}</Button>
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        ))}
      </div>

      <Modal open={confirm !== undefined} onClose={() => setConfirmId(null)} title={t("settings.sanitization.technical.confirmTitle", "Delete this technical decision?")} width={460}
        footer={<>
          <Button variant="ghost" onClick={() => setConfirmId(null)}>{t("settings.sanitization.technical.keep", "Keep it")}</Button>
          <Button variant="danger" disabled={del.isPending} aria-busy={del.isPending} onClick={() => confirm && deleteOnce(delInFlight, (settled) => del.mutate({ projectId, id: confirm.ItemId }, { onSettled: settled }), () => setConfirmId(null))}>{t("settings.sanitization.technical.delete", "Delete")}</Button>
        </>}>
        <p className="text-[14px] text-ink2">{confirm ? t("settings.sanitization.technical.confirmText", "{number} {title} will be removed.", { number: formatNumber("T", confirm.Number), title: confirm.Title }) : ""}</p>
      </Modal>
    </Card>
  );
}
