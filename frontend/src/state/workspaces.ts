/** Workspaces, members and roles: a compatibility facade over the SELISE Blocks workspace store (src/blocks/workspaces).
 *  Workspaces, memberships, roles and notifications live in Blocks and are read from the store snapshot;
 *  every write is a Logic Function op. Nothing here touches a browser database. */
import { useMemo } from "react";
import { can, deniedTip } from "@/data/rbac";
import type { RbacAction, WorkspaceRole } from "@/data/rbac";
import * as ops from "@/blocks/workspaces/ops";
import { useBell } from "@/blocks/workspaces/bell";
import { rebootstrap, switchWorkspace as syncSwitchWorkspace } from "@/blocks/workspaces/sync";
import { useWorkspaces } from "@/blocks/workspaces/store";
import type { Member, MemberNotification, MyWorkspace, ShareItemType, Workspace } from "@/blocks/workspaces/store";
import { getCulture } from "@/i18n";

export { useWorkspaces };
export type {
  ActivityEntry, AssignmentEvent, Member, MemberNotification, MemberStatus, MyWorkspace, NotificationKind, Share, ShareItemType,
  ShareTarget, Workspace,
} from "@/blocks/workspaces/store";

type DbResult<T = void> = { ok: true; value: T } | { ok: false; error: string };

export const MSG_NO_WORKSPACE = "Sign in to a workspace first.";
const MSG_SIGN_IN = "Sign in first.";
const MSG_NOT_MEMBER = "This member is not in this workspace.";
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/* ---------- plain helpers ---------- */

export function initialsOf(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "?";
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[1][0]).toUpperCase();
}

export function whenLabel(iso: string): string {
  const d = new Date(iso);
  if (!iso || Number.isNaN(d.getTime())) return "";
  return d.toLocaleString(getCulture() === "de-CH" ? "de-CH" : "en-GB", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}

export function nameFromEmail(email: string): string {
  const local = email.trim().split("@")[0] ?? "";
  const words = local.split(/[._+\-\s]+/).filter(Boolean).map((w) => w[0].toUpperCase() + w.slice(1));
  return words.join(" ") || email.trim();
}

export const projectLink = (id: string) => `/p/${encodeURIComponent(id)}`;

export function shareLink(s: { projectId: string; itemType: ShareItemType; itemRef: string }): string {
  const base = projectLink(s.projectId);
  if (s.itemType === "scope") return `${base}/scope`;
  if (s.itemType === "screens") return `${base}/scope#screens`;
  return `${base}/scope?screen=${encodeURIComponent(s.itemRef)}`;
}

/* ---------- plain reads ---------- */

const normEmail = (email: string) => email.trim().toLowerCase();

/** The workspace of the signed-in person, only while it is in their list; null without one. Never falls back. */
export function activeWorkspaceId(): string | null {
  const s = useWorkspaces.getState();
  return s.workspaceId && s.workspaces.some((w) => w.id === s.workspaceId) ? s.workspaceId : null;
}

/** The active workspace id, or "" (matches no row) without one: never another workspace's id. */
export const currentWorkspaceId = (): string => activeWorkspaceId() ?? "";

const MSG_SUSPENDED = "This workspace is suspended by a platform admin.";

type Snapshot = ReturnType<typeof useWorkspaces.getState>;

/** True while the active workspace accepts writes (active); true when nothing says otherwise. The workspace row's own
 *  status (read again on focus and after admin changes) decides when it is known; the list of suspended workspaces from
 *  the sign-in (me.bootstrap) only when it is not: otherwise a workspace resumed during the session stayed read-only. */
function writable(s: Snapshot): boolean {
  const w = s.workspaces.find((x) => x.id === s.workspaceId) as (MyWorkspace & { status?: string }) | undefined;
  if (w?.status) return w.status === "active";
  return !s.suspended?.some((x) => x.workspaceId === s.workspaceId);
}

function allowed(s: Snapshot, action: RbacAction): boolean {
  if (!s.ready || !s.me) return false;
  if (action !== "view" && !writable(s)) return false;
  return can(s.me.permissions ?? s.me.role, action);
}

export function canNow(action: RbacAction): boolean {
  return allowed(useWorkspaces.getState(), action);
}

/** By IAM user id or membership id, among everyone on the team of the active workspace. */
export function memberById(id: string): Member | null {
  if (!id) return null;
  const s = useWorkspaces.getState();
  const all = s.team?.length ? s.team : s.members;
  return all.find((m) => m.id === id || m.membershipId === id) ?? null;
}

export function memberByEmail(email: string): Member | null {
  const e = normEmail(email);
  if (!e) return null;
  const s = useWorkspaces.getState();
  const all = (s.team?.length ? s.team : s.members).filter((m) => normEmail(m.email) === e);
  return all.find((m) => m.status === "active") ?? all[0] ?? null;
}

/* ---------- writes ---------- */

function refuse<T = never>(error: string): DbResult<T> { return { ok: false, error }; }

/** The refusal for an action the signed-in member's role does not allow, or null. */
export function denial(action: RbacAction): string | null {
  const s = useWorkspaces.getState();
  const me = s.me;
  if (allowed(s, action)) return null;
  if (s.ready && me && action !== "view" && !writable(s) && can(me.permissions ?? me.role, action)) return MSG_SUSPENDED;
  return (deniedTip(me?.role ?? null, action as never) ?? (me ? "You can't do that" : "Sign in first")) + ".";
}

type Raw = Record<string, unknown>;
const str = (v: unknown): string => (typeof v === "string" ? v : "");

/** Reflect a membership row an op returned: the store's own copy when it has caught up, else a plain mapping. */
function memberFromRow(row: Raw, workspaceId: string): Member {
  const membershipId = str(row.ItemId) || str(row.id);
  const email = normEmail(str(row.Email));
  const known = memberById(membershipId) ?? memberByEmail(email);
  if (known) return known;
  const roleKey = str(row.RoleKey);
  const status = str(row.Status) === "pending-account" ? "pending-account" : str(row.Status) === "active" ? "active" : "invited";
  return {
    id: str(row.UserId) || membershipId, userId: str(row.UserId), membershipId, workspaceId,
    name: str(row.DisplayName) || nameFromEmail(email), email, role: (can(roleKey as WorkspaceRole, "project.edit") ? "member" : "viewer"),
    roleKey, roleName: roleKey, permissions: [], isCustomRole: !["owner", "member", "viewer"].includes(roleKey),
    status, invitedAt: str(row.InvitedAt) || null, joinedAt: str(row.JoinedAt) || null,
  } as Member;
}

/** Runs the bootstrap again: it accepts an invitation addressed to the signed-in email and reloads the lists. */
export async function activateMember(memberId: string): Promise<DbResult<Member>> {
  const m = memberById(memberId);
  try { await rebootstrap(); } catch { return refuse("This could not be refreshed. Try again."); }
  return m ? { ok: true, value: memberById(memberId) ?? m } : refuse("This member no longer exists.");
}

export async function createWorkspace(name: string): Promise<DbResult<Workspace>> {
  const clean = name.trim();
  if (!clean) return refuse("Name the workspace.");
  if (clean.length > 60) return refuse("Use at most 60 characters.");
  const r = await ops.createWorkspace(clean);
  if (!r.ok) return r;
  const row = r.value.workspace as unknown as Raw;
  const id = str(row.ItemId) || str(row.WorkspaceId);
  const sw = await switchWorkspace(id);
  if (!sw.ok) return sw;
  return { ok: true, value: { id, name: str(row.Name) || clean, createdAt: str(row.CreatedAt) } };
}

export async function switchWorkspace(id: string): Promise<DbResult> {
  const r = await syncSwitchWorkspace(id);
  if (!r.ok) return r;
  return { ok: true, value: undefined };
}

export async function inviteMember(input: { email: string; name?: string; role: WorkspaceRole | string }): Promise<DbResult<Member>> {
  const denied = denial("members.manage");
  if (denied) return refuse(denied);
  const workspaceId = activeWorkspaceId();
  if (!workspaceId) return refuse(MSG_NO_WORKSPACE);
  const email = normEmail(input.email);
  if (!EMAIL_RE.test(email)) return refuse("Enter a valid work email.");
  const r = await ops.inviteMember({ workspaceId, email, roleKey: input.role, displayName: input.name?.trim() || undefined });
  if (!r.ok) return r;
  return { ok: true, value: memberFromRow(r.value.membership as unknown as Raw, workspaceId) };
}

export async function changeRole(memberId: string, role: WorkspaceRole | string): Promise<DbResult> {
  const workspaceId = activeWorkspaceId();
  if (!workspaceId) return refuse(MSG_NO_WORKSPACE);
  const denied = denial("members.manage");
  if (denied) return refuse(denied);
  const target = memberById(memberId);
  if (!target || target.workspaceId !== workspaceId) return refuse(MSG_NOT_MEMBER);
  if (!role) return refuse("Choose a role.");
  const r = await ops.setMemberRole({ workspaceId, membershipId: target.membershipId, roleKey: role });
  return r.ok ? { ok: true, value: undefined } : r;
}

export async function removeMember(memberId: string): Promise<DbResult> {
  const workspaceId = activeWorkspaceId();
  if (!workspaceId) return refuse(MSG_NO_WORKSPACE);
  const target = memberById(memberId);
  if (!target || target.workspaceId !== workspaceId) return refuse(MSG_NOT_MEMBER);
  const { me } = useWorkspaces.getState();
  if (me && target.membershipId === me.membershipId) {
    const r = await ops.leaveWorkspace(workspaceId);
    return r.ok ? { ok: true, value: undefined } : r;
  }
  const denied = denial("members.manage");
  if (denied) return refuse(denied);
  const r = await ops.removeMember({ workspaceId, membershipId: target.membershipId });
  return r.ok ? { ok: true, value: undefined } : r;
}

export async function markNotificationRead(id: string): Promise<DbResult> {
  if (!useWorkspaces.getState().me && !useWorkspaces.getState().userId) return refuse(MSG_SIGN_IN);
  const r = await ops.markNotificationsRead([id]);
  return r.ok ? { ok: true, value: undefined } : r;
}

export async function markAllNotificationsRead(): Promise<DbResult> {
  if (!useWorkspaces.getState().me && !useWorkspaces.getState().userId) return refuse(MSG_SIGN_IN);
  const r = await ops.markAllNotificationsRead();
  return r.ok ? { ok: true, value: undefined } : r;
}

/* ---------- hooks ---------- */

export function useCurrentWorkspace(): MyWorkspace | null {
  const workspaces = useWorkspaces((s) => s.workspaces);
  const id = useWorkspaces((s) => s.workspaceId);
  return useMemo(() => workspaces.find((w) => w.id === id) ?? null, [workspaces, id]);
}
export const useMe = (): Member | null => useWorkspaces((s) => s.me);
export type AssignableMember = Member & { status: "active" | "invited" };
const isAssignable = (m: Member): m is AssignableMember => m.status !== "pending-account";
/** The assignable people: active and invited (pending-account rows appear only in the team list). */
export const useMembers = (): AssignableMember[] => {
  const members = useWorkspaces((s) => s.members);
  return useMemo(() => members.filter(isAssignable), [members]);
};

export function useCan(action: RbacAction): boolean {
  return useWorkspaces((s) => allowed(s, action));
}

export const useNotifications = (): MemberNotification[] => {
  const { items } = useBell();
  const memberId = useWorkspaces((s) => s.userId ?? s.me?.id ?? "");
  return useMemo(
    () => items.map((n) => ({ id: n.id, memberId, kind: n.kind as MemberNotification["kind"], text: n.text, link: n.link ?? "", read: n.read, createdAt: n.createdAt })),
    [items, memberId]);
};

export function useUnreadCount(): number {
  return useBell().unreadCount;
}
