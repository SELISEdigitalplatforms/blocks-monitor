import { useRef, useState, type ReactNode } from "react";
import { UserPlus } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { InviteForm } from "@/components/workspace/InviteForm";
import { useWorkspaces } from "@/blocks/workspaces/store";
import { useMemberName, useMemberOptions } from "@/blocks/projects/context";
import { NOT_CONFIGURED_MESSAGE, isNotConfigured, messageFor } from "@/blocks/projects/messages";
import { useAssignProject } from "@/blocks/projects/mutations";
import { useProjectAssignee } from "@/blocks/projects/reads";
import { deniedTip } from "@/data/rbac";
import { isBlocksProjectId } from "@/domain/projects";
import { initialsOf, useCan, useMe, whenLabel } from "@/state/workspaces";
import { Avatar, Button, Chip, Modal } from "@/ui/kit";
import { useT } from "@/i18n";

type Option = { id: string | null; name: string; email?: string; role?: string; invited?: boolean };
type Props = { projectId: string; projectName: string; className?: string; compact?: boolean };
interface ViewProps extends Props {
  /** The current assignee's id, or null. */
  current: string | null;
  /** The people to choose from (without the "Unassigned" row). */
  people: Option[];
  activity: ReactNode[];
  /** Local projects can invite someone from the dialog. */
  invitable: boolean;
  save: (memberId: string | null) => Promise<{ ok: true } | { ok: false; error: string }>;
}

/** The Assign control of the project header: pick a workspace member (or invite one), or unassign. */
export function AssignControl(props: Props) {
  return isBlocksProjectId(props.projectId) ? <BlocksAssignControl {...props} /> : null;
}

function AssignedBy({ userId, at, assigned }: { userId: string; at: string; assigned: boolean }) {
  const t = useT();
  const name = useMemberName(userId);
  const by = assigned ? t("shell.workspace.assign.assignedBy", "Assigned by {name}", { name }) : t("shell.workspace.assign.unassignedBy", "Unassigned by {name}", { name });
  return <>{`${by} · ${whenLabel(at)}`}</>;
}

function BlocksAssignControl(props: Props) {
  const { projectId } = props;
  const { assigneeUserId, history } = useProjectAssignee(projectId);
  const people = useMemberOptions({ includeSelf: true });
  const assign = useAssignProject();
  return (
    <AssignView {...props} current={assigneeUserId || null} invitable={false}
      people={people.map((m) => ({ id: m.userId as string | null, name: m.name, email: m.email, invited: m.status === "invited" }))}
      activity={history.slice(0, 3).map((h) => <AssignedBy key={`${h.at}-${h.assigneeUserId}`} userId={h.assignedByUserId} at={h.at} assigned={Boolean(h.assigneeUserId)} />)}
      save={async (memberId) => {
        try { await assign.run({ projectId, assigneeUserId: memberId ?? "" }); return { ok: true }; }
        catch (e) { return { ok: false, error: isNotConfigured(e) ? NOT_CONFIGURED_MESSAGE : messageFor(e) }; }
      }} />
  );
}

function AssignView({ projectId, projectName, className, compact, current, people, activity, invitable, save }: ViewProps) {
  void projectId;
  const t = useT();
  const me = useMe();
  const canAssign = useCan("project.assign");
  const ready = useWorkspaces((s) => s.ready);
  const canManage = useCan("members.manage");
  const navigate = useNavigate();
  const canInvite = useCan("members.manage") && invitable;
  const [open, setOpen] = useState(false);
  const [inviting, setInviting] = useState(false);
  const [choice, setChoice] = useState<string | null>(null);
  const [error, setError] = useState("");

  const show = () => { setChoice(current); setInviting(false); setError(""); setOpen(true); };
  const close = () => { setOpen(false); setInviting(false); };
  const saving = useRef(false);
  const [busy, setBusy] = useState(false);
  const assign = async (memberId: string | null) => {
    if (saving.current) return;
    saving.current = true;
    setBusy(true);
    setError("");
    try {
      const r = await save(memberId);
      if (r.ok) close();
      else setError(r.error || t("shell.workspace.assign.saveFailed", "The assignment could not be saved."));
    } finally {
      saving.current = false;
      setBusy(false);
    }
  };

  const options: Option[] = [
    ...(current ? [{ id: null, name: t("shell.workspace.assign.unassigned", "Unassigned") }] : []),
    ...people,
  ];

  return (
    <>
      <Button variant="ghost" size="sm" className={className} icon={<UserPlus size={15} strokeWidth={1.75} />} onClick={show} disabled={!canAssign || !ready} aria-busy={!ready || undefined}
        title={!ready || canAssign || !me ? undefined : (deniedTip(me.role, "project.assign") ?? undefined)}>
        <span className={compact ? "max-xl:sr-only" : undefined}>{current ? t("shell.workspace.assign.change", "Change") : t("shell.workspace.assign.assign", "Assign")}</span>
      </Button>
      <Modal open={open} onClose={close} title={t("shell.workspace.assign.title", "Assign {name}", { name: projectName })} width={520}
        footer={inviting ? <Button variant="ghost" onClick={close}>{t("common.actions.cancel", "Cancel")}</Button> : (
          <>
            <Button variant="ghost" disabled={busy} onClick={close}>{t("common.actions.cancel", "Cancel")}</Button>
            <Button variant="primary" disabled={choice === current || busy} onClick={() => void assign(choice)}>{busy ? t("shell.workspace.assign.assigning", "Assigning…") : t("shell.workspace.assign.assign", "Assign")}</Button>
          </>
        )}>
        {inviting ? (
          <InviteForm submitLabel={t("shell.workspace.assign.inviteAndAssign", "Invite and assign")} onCancel={() => setInviting(false)} onDone={(m) => void assign(m.id)} />
        ) : (
          <div className="flex flex-col gap-4">
            {options.length === 0 && (
              <div className="flex flex-col items-start gap-2">
                <p className="text-[14px] text-ink2">{t("shell.workspace.assign.noOne", "No one can be assigned yet. Workspace admins invite people in Settings > Team.")}</p>
                {canManage && <Button variant="ghost" size="sm" onClick={() => { close(); navigate("/settings#team"); }}>{t("shell.workspace.assign.openSettings", "Open Settings")}</Button>}
              </div>
            )}
            <div role="radiogroup" aria-label={t("shell.workspace.assign.assignee", "Assignee")} className="flex flex-col">
              {options.map((o) => (
                <label key={o.id ?? "none"} className="flex cursor-pointer items-center gap-3 rounded-block px-3 py-2.5 hover:bg-surface2 has-[:checked]:bg-surface2 has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-accent">
                  <input type="radio" name="assignee" className="sr-only" checked={choice === o.id} onChange={() => setChoice(o.id)} />
                  <Avatar initials={o.email ? initialsOf(o.name) : "–"} size={32} tone="soft" />
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="truncate text-[14px] font-medium">{o.name}</span>
                    {o.email && <span className="truncate text-[13px] text-ink3">{o.email}</span>}
                  </span>
                  {o.role && <Chip>{o.role}</Chip>}
                  {o.invited && <Chip tone="warning">{t("shell.workspace.invited", "Invited")}</Chip>}
                </label>
              ))}
            </div>
            {canInvite && (
              <div><Button variant="ghost" size="sm" icon={<UserPlus size={15} strokeWidth={1.75} />} onClick={() => setInviting(true)}>{t("shell.workspace.assign.inviteSomeone", "Invite someone")}</Button></div>
            )}
            {activity.length > 0 && (
              <section aria-label={t("shell.workspace.assign.activity", "Activity")} className="flex flex-col gap-1.5">
                <h4 className="text-[12px] font-medium uppercase tracking-wide text-ink3">{t("shell.workspace.assign.activity", "Activity")}</h4>
                {activity.map((e, i) => <p key={i} className="text-[13px] text-ink2">{e}</p>)}
              </section>
            )}
          </div>
        )}
        {error && <p role="alert" className="mt-3 text-[13px] text-danger">{error}</p>}
      </Modal>
    </>
  );
}
