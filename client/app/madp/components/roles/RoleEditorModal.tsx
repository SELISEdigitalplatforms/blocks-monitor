import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { Button, Input, Label, Modal, Textarea } from "@/madp/ui/kit";
import { useT } from "@/madp/i18n";
import type { ChecklistArea, RoleCheck } from "@/madp/domain/roles";
import { PermissionChecklist } from "./PermissionChecklist";

export type RoleDraft = { name: string; description: string; permissions: string[] };

export function RoleEditorModal({ open, onClose, title, idPrefix, initial, checklist, check, onSave, note, saveLabel }: {
  open: boolean; onClose: () => void; title: string; idPrefix: string; initial: RoleDraft;
  checklist: (selected: readonly string[]) => ChecklistArea[];
  check: (draft: RoleDraft) => RoleCheck;
  onSave: (draft: RoleDraft) => Promise<{ ok: true } | { ok: false; error: string }>;
  note?: ReactNode; saveLabel?: string;
}) {
  const t = useT();
  const save = saveLabel ?? t("platform.roleEditor.saveRole", "Save role");
  const [draft, setDraft] = useState<RoleDraft>(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inFlight = useRef(false);

  useEffect(() => {
    if (open) { setDraft({ ...initial, permissions: [...initial.permissions] }); setError(null); setBusy(false); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const toggle = (key: string, checked: boolean) =>
    setDraft((d) => ({ ...d, permissions: checked ? (d.permissions.includes(key) ? d.permissions : [...d.permissions, key]) : d.permissions.filter((p) => p !== key) }));

  const submit = async (e?: FormEvent) => {
    e?.preventDefault();
    if (busy || inFlight.current) return;
    const c = check(draft);
    if (!c.ok) {
      setError(c.permissions && c.permissions.length ? `${c.message} ${c.permissions.join(", ")}` : c.message);
      return;
    }
    setError(null);
    inFlight.current = true;
    setBusy(true);
    let r: { ok: true } | { ok: false; error: string };
    try { r = await onSave(draft); } finally { inFlight.current = false; }
    setBusy(false);
    if (r.ok) onClose(); else setError(r.error);
  };

  return (
    <Modal open={open} onClose={() => { if (!busy) onClose(); }} title={title} width={720}
      footer={<>
        <Button variant="ghost" onClick={onClose} disabled={busy}>{t("platform.roleEditor.cancel", "Cancel")}</Button>
        <Button variant="primary" onClick={() => void submit()} disabled={busy}>{save}</Button>
      </>}>
      <form onSubmit={submit} className="space-y-4">
        {note && <div className="text-[13px] text-ink2">{note}</div>}
        <div>
          <label htmlFor={`${idPrefix}-name`}><Label>{t("platform.roleEditor.name", "Name")}</Label></label>
          <Input id={`${idPrefix}-name`} value={draft.name} maxLength={60} autoFocus onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
        </div>
        <div>
          <label htmlFor={`${idPrefix}-description`}><Label>{t("platform.roleEditor.description", "Description")}</Label></label>
          <Textarea id={`${idPrefix}-description`} value={draft.description} maxLength={200} onChange={(e) => setDraft({ ...draft, description: e.target.value })} />
        </div>
        <div>
          <Label>{t("platform.roleEditor.permissions", "What this role may do")}</Label>
          <PermissionChecklist areas={checklist(draft.permissions)} onToggle={toggle} idPrefix={`${idPrefix}-perm`} />
        </div>
        {error && <p role="alert" className="text-[13px] text-danger [overflow-wrap:anywhere]">{error}</p>}
        <button type="submit" className="sr-only" tabIndex={-1} disabled={busy}>{save}</button>
      </form>
    </Modal>
  );
}
