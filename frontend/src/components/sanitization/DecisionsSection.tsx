/** Decisions log: what was decided, why and by whom. Newest first; a superseded entry says so in text. */
import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { CircleCheck, CircleDot, CircleX, History, Pencil, Replace, Scale, Trash2 } from "lucide-react";
import { Button, Card, Chip, EmptyState, Modal, Select, Textarea, Input } from "@/ui/kit";
import { useClarifications, useDecisions } from "@/blocks/sanitization/hooks";
import { useDeleteDecision, useSaveDecision } from "@/blocks/sanitization/ops";
import { DECISION_STATUS_LABEL, SANITIZATION_CAPS, type DecisionStatus } from "@/domain/sanitization";
import { decisionStatusName, nameOr } from "@/components/requirements/domainLabels";
import { formatNumber } from "@/domain/numbering";
import { LoadError, ReadOnlyNote, WriteNote, formatAt, sectionHref, type SectionProps } from "./shared";
import { startOnce } from "./CompleteSanitizationModal";
import { deleteOnce } from "./DiscussionSection";
import { useT } from "@/i18n";

interface DecisionRowLike {
  ItemId: string; Number: number; Title: string; Statement?: string | null; Rationale?: string | null; Status: string;
  ClarificationId?: string | null; SupersededById?: string | null; DecidedByUserId?: string | null; DecidedAt?: string | null;
  LastUpdatedDate?: string | null;
}
interface ClarificationLike { ItemId: string; Number: number; Question?: string | null }

/** The hooks may answer a bare list or a query result; both are read the same way here. */
function readRows<T>(r: unknown): { rows: T[]; isError: boolean; refetch: () => void } {
  if (Array.isArray(r)) return { rows: r as T[], isError: false, refetch: () => undefined };
  const q = (r ?? {}) as { data?: unknown; isError?: boolean; refetch?: () => void };
  return { rows: Array.isArray(q.data) ? (q.data as T[]) : [], isError: q.isError === true, refetch: q.refetch ?? (() => undefined) };
}

type ChipTone = "neutral" | "success" | "warning" | "danger";
const TONE: Record<string, ChipTone> = { accepted: "success", proposed: "warning", rejected: "danger", superseded: "neutral" };
const ICON: Record<string, typeof CircleCheck> = { accepted: CircleCheck, proposed: CircleDot, rejected: CircleX, superseded: History };
const statusLabel = (s: string) => nameOr(decisionStatusName, Object.keys(DECISION_STATUS_LABEL) as DecisionStatus[], s);
const clip = (s: string) => s.replace(/\s+$/g, "");

interface Form { id: string | null; title: string; text: string; rationale: string; clarificationId: string; supersedesId: string; expectedUpdatedAt: string | undefined }
const EMPTY: Form = { id: null, title: "", text: "", rationale: "", clarificationId: "", supersedesId: "", expectedUpdatedAt: undefined };

export function DecisionsSection({ workspaceId, projectId, access, members }: SectionProps) {
  const t = useT();
  const ctx = { workspaceId, projectId };
  const dq = readRows<DecisionRowLike>(useDecisions(ctx));
  const cq = readRows<ClarificationLike>(useClarifications(ctx));
  const save = useSaveDecision(ctx);
  const del = useDeleteDecision(ctx);
  const [form, setForm] = useState<Form | null>(null);
  const formRef = useRef<HTMLFormElement>(null);
  // opening the form (new, edit or supersede) brings it into view and focuses the first field
  const formKey = form ? `${form.id ?? ""}|${form.supersedesId}` : null;
  useEffect(() => {
    if (formKey === null) return;
    formRef.current?.scrollIntoView?.({ block: "center", behavior: "smooth" });
    formRef.current?.querySelector<HTMLElement>("#dec-title")?.focus({ preventScroll: true });
  }, [formKey]);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const delInFlight = useRef(false);
  const saveInFlight = useRef(false);

  const rows = [...dq.rows].sort((a, b) => b.Number - a.Number || a.ItemId.localeCompare(b.ItemId));
  const byId = new Map(dq.rows.map((r) => [r.ItemId, r]));
  const clarById = new Map(cq.rows.map((c) => [c.ItemId, c]));
  const caps = SANITIZATION_CAPS as Record<string, number>;
  const titleMax = caps.decisionTitle ?? 200;
  const textMax = caps.decisionText ?? 5000;
  const rationaleMax = caps.decisionRationale ?? 5000;

  if (dq.isError) return <LoadError onRetry={dq.refetch} />;

  const canSubmit = form !== null && form.title.trim() !== "" && form.text.trim() !== "" && !save.isPending;
  const submit = () => {
    if (!form || !canSubmit) return;
    startOnce(saveInFlight, (done) => save.mutate({
      projectId, ...(form.id ? { id: form.id } : {}), title: form.title, decisionText: form.text, rationale: form.rationale,
      clarificationId: form.clarificationId, ...(form.supersedesId ? { supersedesId: form.supersedesId } : {}),
      ...(form.expectedUpdatedAt ? { expectedUpdatedAt: form.expectedUpdatedAt } : {}),
    }, { onSuccess: () => setForm(null), onSettled: done }));
  };
  const confirm = confirmId ? byId.get(confirmId) : undefined;
  const editing = form?.id ? formatNumber("D", byId.get(form.id)?.Number ?? 0) : null;
  const supersedes = form?.supersedesId ? byId.get(form.supersedesId) : undefined;

  return (
    <Card title={t("settings.sanitization.decisions.title", "Decisions so far")} icon={<Scale size={18} strokeWidth={1.75} />}>
      <div className="flex flex-col gap-4">
        {!access.canEdit && <ReadOnlyNote access={access} />}
        <WriteNote state={save.isPending || del.isPending ? "saving" : save.isError || del.isError ? "error" : save.isSuccess || del.isSuccess ? "saved" : "idle"}
          error={save.isError ? save.error : del.isError ? del.error : undefined}
          onRetry={save.isError ? submit : undefined} />

        {access.canEdit && !form && (
          <div><Button variant="secondary" size="sm" icon={<Scale size={14} strokeWidth={1.75} aria-hidden />} onClick={() => setForm({ ...EMPTY })}>{t("settings.sanitization.decisions.record", "Record a decision")}</Button></div>
        )}

        {access.canEdit && form && (
          <form ref={formRef} className="flex flex-col gap-3 rounded-block bg-surface2 p-4" aria-label={editing ? t("settings.sanitization.decisions.editNumber", "Edit {number}", { number: editing }) : t("settings.sanitization.decisions.record", "Record a decision")}
            onSubmit={(e) => { e.preventDefault(); submit(); }}>
            {editing && <h3 className="text-[15px] font-medium">{t("settings.sanitization.decisions.editNumber", "Edit {number}", { number: editing })}</h3>}
            {supersedes && <p className="text-[13px] font-medium text-ink2">{t("settings.sanitization.decisions.supersedes", "Supersedes {number}", { number: formatNumber("D", supersedes.Number) })}</p>}
            <div>
              <label htmlFor="dec-title" className="mb-1.5 block text-[12px] font-medium uppercase tracking-wider text-ink3">{t("settings.sanitization.decisions.titleLabel", "Title")}</label>
              <Input id="dec-title" value={form.title} maxLength={titleMax} onChange={(e) => setForm({ ...form, title: e.target.value })} />
            </div>
            <div>
              <label htmlFor="dec-text" className="mb-1.5 block text-[12px] font-medium uppercase tracking-wider text-ink3">{t("settings.sanitization.decisions.decisionLabel", "Decision")}</label>
              <Textarea id="dec-text" value={form.text} maxLength={textMax} onChange={(e) => setForm({ ...form, text: e.target.value })} />
            </div>
            <div>
              <label htmlFor="dec-why" className="mb-1.5 block text-[12px] font-medium uppercase tracking-wider text-ink3">{t("settings.sanitization.decisions.rationaleLabel", "Rationale")}</label>
              <Textarea id="dec-why" value={form.rationale} maxLength={rationaleMax} onChange={(e) => setForm({ ...form, rationale: e.target.value })} />
            </div>
            <Select label={t("settings.sanitization.decisions.linkedClarification", "Linked clarification")} value={form.clarificationId} onChange={(v) => setForm({ ...form, clarificationId: v })}
              options={[{ value: "", label: t("settings.sanitization.decisions.noLinkedClarification", "No linked clarification") },
                ...[...cq.rows].sort((a, b) => a.Number - b.Number).map((c) => ({ value: c.ItemId, label: `${formatNumber("C", c.Number)} ${(c.Question ?? "").slice(0, 60)}`.trim() }))]} />
            <div className="flex flex-wrap gap-2">
              <Button type="submit" variant="secondary" size="sm" disabled={!canSubmit}>{save.isPending ? t("settings.sanitization.decisions.saving", "Saving…") : t("settings.sanitization.decisions.save", "Save decision")}</Button>
              <Button variant="ghost" size="sm" onClick={() => setForm(null)}>{t("settings.sanitization.decisions.cancel", "Cancel")}</Button>
            </div>
          </form>
        )}

        {rows.length === 0 ? (
          <EmptyState icon={<Scale size={20} strokeWidth={1.75} />} title={t("settings.sanitization.decisions.empty", "No decisions yet. Record the first decision and why it was made.")} />
        ) : (
          <ul className="flex flex-col gap-3">
            {rows.map((d) => {
              const Icon = ICON[d.Status] ?? CircleDot;
              const by = d.SupersededById ? byId.get(d.SupersededById) : undefined;
              const clar = d.ClarificationId ? clarById.get(d.ClarificationId) : undefined;
              const edit = () => setForm({ id: d.ItemId, title: d.Title, text: d.Statement ?? "", rationale: d.Rationale ?? "", clarificationId: d.ClarificationId ?? "", supersedesId: "", expectedUpdatedAt: d.LastUpdatedDate ?? undefined });
              const supersede = () => setForm({ id: null, title: d.Title, text: d.Statement ?? "", rationale: d.Rationale ?? "", clarificationId: d.ClarificationId ?? "", supersedesId: d.ItemId, expectedUpdatedAt: undefined });
              return (
                <li key={d.ItemId} className="rounded-block bg-surface2 p-4">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="num text-[13px] font-medium text-ink2">{formatNumber("D", d.Number)}</span>
                    <h3 className="min-w-0 break-words text-[15px] font-medium">{d.Title}</h3>
                    <Chip tone={TONE[d.Status] ?? "neutral"} icon={<Icon size={12} strokeWidth={1.75} aria-hidden />}>{statusLabel(d.Status)}</Chip>
                  </div>
                  {d.SupersededById && (
                    <p className="mt-1 text-[13px] font-medium text-ink2">{by ? t("settings.sanitization.decisions.supersededBy", "Superseded by {number}", { number: formatNumber("D", by.Number) }) : t("settings.sanitization.decisions.supersededLater", "Superseded by a later decision")}</p>
                  )}
                  {d.Statement && <p className="mt-2 whitespace-pre-wrap break-words text-[14px]">{d.Statement}</p>}
                  {d.Rationale && <p className="mt-2 whitespace-pre-wrap break-words text-[14px] text-ink2">{t("settings.sanitization.decisions.why", "Why: {rationale}", { rationale: d.Rationale })}</p>}
                  <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[13px] text-ink3">
                    {d.ClarificationId && (
                      <Link to={sectionHref(projectId, "clarifications")} className="font-medium text-[rgb(var(--c-accent-text))] underline-offset-2 hover:underline">
                        {clar ? t("settings.sanitization.decisions.fromNumber", "From {number}", { number: formatNumber("C", clar.Number) }) : t("settings.sanitization.decisions.fromClarification", "From a clarification")}
                      </Link>
                    )}
                    {d.DecidedByUserId && <span>{d.DecidedAt ? t("settings.sanitization.decisions.decidedByOn", "Decided by {name} on {at}", { name: members.nameOf(d.DecidedByUserId), at: formatAt(d.DecidedAt) }) : t("settings.sanitization.decisions.decidedBy", "Decided by {name}", { name: members.nameOf(d.DecidedByUserId) })}</span>}
                  </div>
                  {access.canEdit && (
                    <div className="mt-3 flex flex-wrap items-center gap-2">
                      {/* the server keeps a superseded decision as it was: offering Edit would only end in a refusal */}
                      {d.Status !== "superseded" && (
                        <Button variant="ghost" size="sm" icon={<Pencil size={14} strokeWidth={1.75} aria-hidden />} onClick={edit} aria-label={t("settings.sanitization.decisions.editNumber", "Edit {number}", { number: formatNumber("D", d.Number) })}>{t("settings.sanitization.decisions.edit", "Edit")}</Button>
                      )}
                      {d.Status === "accepted" && (
                        <Button variant="ghost" size="sm" icon={<Replace size={14} strokeWidth={1.75} aria-hidden />} onClick={supersede} aria-label={t("settings.sanitization.decisions.supersedeAria", "Supersede {number}", { number: formatNumber("D", d.Number) })}>{t("settings.sanitization.decisions.supersede", "Supersede")}</Button>
                      )}
                      {d.Status === "superseded" ? (
                        <span className="text-[13px] text-ink3">{t("settings.sanitization.decisions.supersededStays", "A superseded decision stays in the log.")}</span>
                      ) : (
                        <Button variant="danger" size="sm" icon={<Trash2 size={14} strokeWidth={1.75} aria-hidden />} onClick={() => setConfirmId(d.ItemId)} aria-label={t("settings.sanitization.decisions.deleteAria", "Delete {number}", { number: formatNumber("D", d.Number) })}>{t("settings.sanitization.decisions.delete", "Delete")}</Button>
                      )}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <Modal open={confirm !== undefined} onClose={() => setConfirmId(null)} title={t("settings.sanitization.decisions.confirmTitle", "Delete this decision?")} width={460}
        footer={<>
          <Button variant="ghost" onClick={() => setConfirmId(null)}>{t("settings.sanitization.decisions.keep", "Keep it")}</Button>
          <Button variant="danger" disabled={del.isPending} aria-busy={del.isPending} onClick={() => confirm && deleteOnce(delInFlight, (settled) => del.mutate({ projectId, id: confirm.ItemId }, { onSettled: settled }), () => setConfirmId(null))}>{t("settings.sanitization.decisions.confirmDelete", "Delete decision")}</Button>
        </>}>
        <p className="text-[14px] text-ink2">{confirm ? t("settings.sanitization.decisions.confirmText", "{number} {title} will be removed from the log.", { number: formatNumber("D", confirm.Number), title: clip(confirm.Title) }) : ""}</p>
      </Modal>
    </Card>
  );
}
