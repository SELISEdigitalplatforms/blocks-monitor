/** Shown to a signed-in person who is in no workspace yet: ask a Workspace admin for an invitation, or create their own. */
import { useRef, useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { Building2 } from "lucide-react";
import { useWorkspaces } from "@/blocks/workspaces/store";
import { NOT_CONFIGURED_MESSAGE } from "@/blocks/workspaces/ops";
import { AFTER_CREATE_PATH, createAndOpenWorkspace, type CreatedWorkspace } from "./createAndOpen";
import { checkWorkspaceName } from "@/domain/tenancy";
import { Button, EmptyState, Input, Label } from "@/ui/kit";
import { t, useT } from "@/i18n";

const MSG_BLOCKED = () => t("shell.workspace.none.blocked", "Your email domain isn't allowed on this platform. Ask a platform admin.");

export function NoWorkspace() {
  useT();
  const navigate = useNavigate();
  const ready = useWorkspaces((s) => s.ready);
  const suspended = useWorkspaces((s) => s.suspended);
  const blocked = useWorkspaces((s) => s.blocked);
  const bootstrapError = useWorkspaces((s) => s.bootstrapError);
  const loadError = useWorkspaces((s) => s.loadError);
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const created = useRef<CreatedWorkspace>(null);

  if (!ready) {
    return (
      <div className="w-full space-y-4" aria-busy="true" aria-label={t("shell.workspace.none.loading", "Loading your workspaces")}>
        <div className="h-24 animate-pulse rounded-card bg-surface2" />
        <div className="h-10 max-w-md animate-pulse rounded-block bg-surface2" />
      </div>
    );
  }

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (saving) return;
    const check = checkWorkspaceName(name.trim()) as unknown as { ok: boolean; error?: string; message?: string };
    if (!check.ok) { setError(check.error ?? check.message ?? t("shell.workspace.nameProblem", "Give the workspace a name of up to 60 characters.")); return; }
    setSaving(true);
    setError(null);
    try {
      const r = await createAndOpenWorkspace(name.trim(), created);
      if (!r.ok) { setError(r.error); return; }
      navigate(AFTER_CREATE_PATH);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="w-full space-y-6">
      <EmptyState
        icon={<Building2 size={28} strokeWidth={1.75} aria-hidden />}
        title={t("shell.workspace.none.title", "You are not in a workspace yet")}
        text={t("shell.workspace.none.text", "Ask a Workspace admin to invite you, or create your own workspace.")}
      />
      {suspended.map((w) => (
        <p key={w.workspaceId} role="status" className="text-[13px] text-ink2">{t("shell.workspace.none.suspended", "{name} is suspended by a platform admin.", { name: w.name })}</p>
      ))}
      {blocked.length > 0 && <p role="status" className="text-[13px] text-ink2">{MSG_BLOCKED()}</p>}
      {bootstrapError === NOT_CONFIGURED_MESSAGE.workspace && <p role="alert" className="text-[13px] text-danger">{bootstrapError}</p>}
      {loadError && <p role="alert" className="text-[13px] text-danger">{loadError}</p>}
      <form onSubmit={submit} className="max-w-md space-y-3" noValidate>
        <div>
          <Label>{t("shell.workspace.none.nameLabel", "Workspace name")}</Label>
          <Input
            value={name} onChange={(e) => setName(e.target.value)} maxLength={60} autoComplete="off"
            aria-label={t("shell.workspace.none.nameLabel", "Workspace name")} aria-invalid={error ? true : undefined} disabled={saving}
          />
        </div>
        {error && <p role="alert" className="text-[13px] text-danger">{error}</p>}
        <div className="flex items-center gap-2">
          <Button type="submit" variant="primary" disabled={saving}>{t("shell.workspace.none.create", "Create a workspace")}</Button>
        </div>
      </form>
    </div>
  );
}
