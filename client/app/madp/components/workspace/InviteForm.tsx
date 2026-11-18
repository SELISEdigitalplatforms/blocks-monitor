import { useMemo, useState, type FormEvent } from "react";
import { Button, Input, Label, Select } from "@/madp/ui/kit";
import { useWorkspaces } from "@/madp/blocks/workspaces/store";
import { inviteMember } from "@/madp/blocks/workspaces/ops";
import { builtInWorkspaceRoles, checkAssignRole, workspaceGranterPermissions, type RoleDef } from "@/madp/domain/roles";
import { emailDomainOf } from "@/madp/domain/emailDomains";
import type { Member } from "@/madp/state/workspaces";
import { t, useT } from "@/madp/i18n";

const MSG_INVITED = () => t("shell.workspace.invite.invited", "Invited. They'll join when they next sign in.");
const MSG_PENDING = () => t("shell.workspace.invite.pending", "They have no account yet: a platform admin has been asked to create one. They join on their first sign-in.");
const MSG_NOT_HELD = () => t("shell.workspace.invite.notHeld", "You can only give a role whose rights you have yourself");

/** Client-side mirror of the server's domain rule; null while nothing can be said yet. */
export function inviteDomainProblem(email: string, domains: readonly string[]): string | null {
  if (!domains.length) return null;
  const domain = emailDomainOf(email);
  if (!domain) return null;
  if (domains.some((d) => d.trim().toLowerCase().replace(/^@/, "") === domain)) return null;
  return t("shell.workspace.invite.domainNotAllowed", "Email addresses at {domain} aren't allowed on this platform. Use an address at {allowed}.", { domain, allowed: domains.join(", ") });
}

export function InviteForm({ onDone, onCancel, submitLabel, autoFocus = true }: {
  onDone: (m: Member) => void; onCancel?: () => void; submitLabel?: string; autoFocus?: boolean;
}) {
  useT();
  const me = useWorkspaces((s) => s.me);
  const workspaceId = useWorkspaces((s) => s.workspaceId);
  const workspaces = useWorkspaces((s) => s.workspaces);
  const customRoles = useWorkspaces((s) => s.customRoles);
  const domains = useWorkspaces((s) => s.allowedEmailDomains);
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [roleKey, setRoleKey] = useState("member");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);

  const granter = useMemo(() => workspaceGranterPermissions({
    isSuperAdmin: !!workspaces.find((w) => w.id === workspaceId)?.viaPlatform,
    platformPermissions: [],
    memberPermissions: me?.permissions ?? [],
    crossWorkspace: false,
  }), [workspaces, workspaceId, me]);
  const roles = useMemo<RoleDef[]>(() => [
    ...builtInWorkspaceRoles(),
    ...(customRoles as unknown as { key: string; name: string; description?: string; permissions: readonly string[] }[])
      .map((r) => ({ key: r.key, name: r.name, description: r.description, permissions: r.permissions, isBuiltIn: false })),
  ], [customRoles]);
  const options = roles.map((r) => {
    const ok = checkAssignRole(r, granter).ok;
    return { value: r.key, label: ok ? r.name : `${r.name} (${MSG_NOT_HELD()})`, disabled: !ok };
  });
  const chosen = roles.find((r) => r.key === roleKey);
  const problem = inviteDomainProblem(email, domains);
  const hint = domains.length ? t("shell.workspace.invite.allowedDomains", "Allowed email domains: {domains}", { domains: domains.join(", ") }) : "";

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (saving || !workspaceId || problem) return;
    setSaving(true);
    setError(null);
    setResult(null);
    const r = await inviteMember({ workspaceId, email: email.trim(), roleKey, displayName: name.trim() || undefined });
    setSaving(false);
    if (!r.ok) { setError(r.error); return; }
    const pending = r.value.path === "pending-account" || r.value.path === "reinvite-pending";
    setResult(pending ? MSG_PENDING() : MSG_INVITED());
    const m = r.value.membership as unknown as Record<string, string | null | undefined>;
    setEmail("");
    setName("");
    onDone({
      id: m.UserId || m.ItemId || "", membershipId: m.ItemId, userId: m.UserId ?? "", workspaceId,
      name: m.DisplayName || name.trim() || (m.Email ?? email.trim()), email: m.Email ?? email.trim(),
      role: "viewer", roleKey: m.RoleKey ?? roleKey, roleName: chosen?.name ?? roleKey,
      status: pending ? "pending-account" : "invited", invitedAt: m.InvitedAt ?? null, joinedAt: null,
    } as unknown as Member);
  };

  return (
    <form noValidate onSubmit={submit} className="flex flex-col gap-4">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="min-w-0">
          <Label>{t("shell.workspace.invite.email", "Email")}</Label>
          <Input type="email" required autoFocus={autoFocus} autoComplete="off" value={email} placeholder="name@company.com"
            onChange={(e) => setEmail(e.target.value)} aria-label={t("shell.workspace.invite.email", "Email")}
            aria-invalid={problem ? true : undefined} aria-describedby={problem ? "invite-email-problem" : hint ? "invite-email-hint" : undefined} />
          {problem
            ? <p id="invite-email-problem" role="alert" className="mt-2 text-[13px] text-[rgb(var(--c-danger-text))]">{problem}</p>
            : hint && <p id="invite-email-hint" className="mt-2 text-[12px] text-ink3">{hint}</p>}
        </div>
        <div className="min-w-0">
          <Label>{t("shell.workspace.invite.nameOptional", "Name (optional)")}</Label>
          <Input value={name} autoComplete="off" onChange={(e) => setName(e.target.value)} aria-label={t("shell.workspace.invite.nameOptional", "Name (optional)")} />
        </div>
      </div>
      <div>
        <Label>{t("shell.workspace.invite.role", "Role")}</Label>
        <Select label={t("shell.workspace.invite.role", "Role")} value={roleKey} onChange={setRoleKey} options={options} />
        {chosen?.description && <p className="mt-2 text-[12px] text-ink3">{chosen.description}</p>}
      </div>
      {error && <p role="alert" className="text-[13px] text-danger">{error}</p>}
      {result && <p role="status" className="text-[13px] text-ink2">{result}</p>}
      <div className="flex flex-wrap items-center gap-3 sm:justify-end">
        {onCancel && <Button variant="ghost" onClick={onCancel}>{t("common.actions.cancel", "Cancel")}</Button>}
        <Button type="submit" variant="primary" disabled={saving || !!problem}>{submitLabel ?? t("shell.workspace.invite.send", "Send invitation")}</Button>
      </div>
    </form>
  );
}
