// Session-driven sync: on sign-in it starts the browser's own reads at once (TanStack observers: my memberships, my workspaces,
// the active workspace's team and custom roles, my notifications) and runs me.bootstrap alongside, after any session refresh
// has settled. `ready` waits for the reads, and for bootstrap only when the person has no workspace yet (bootstrap may accept
// an invitation); `bootstrapPending` says whether the server-only facts (platform permissions, account status) have arrived.
// While the session runs it follows the session profile (a new name, the super admin flag granted or removed) and reads the
// platform permissions again with refreshAccess (me.access, read-only), so neither waits for the next sign-in.
// It reads the session and never writes it; the session clears the query cache on sign-out. Reads are one wave
// (memberships, bell, and the remembered workspace's team / roles) plus the dependent workspace-name wave;
// without a remembered workspace: memberships (+ all workspaces for the super admin), then workspaces / team / roles / bell.
import { QueryObserver, type QueryObserverOptions, type QueryObserverResult } from "@tanstack/react-query";
import { claimCacheFor, queryClient } from "../queryClient";
import { useSession, whenRefreshSettled, type BlocksProfile } from "../session";
import { forgetOtherWorkspaces } from "../data/hooks";
import { FUNCTION_ERROR_MESSAGES } from "../fn";
import { WORKSPACE_PERMISSIONS, WORKSPACE_ROLE_LABEL, PLATFORM_PERMISSIONS, isPlatformPermission, isWorkspaceRole, type WorkspaceRole } from "@/domain/rbac";
import { workspacePermissionsFor, type RoleDef } from "@/domain/roles";
import { isSafeInternalLink } from "@/domain/notifications";
import { bootstrapMe, readMyAccess } from "./ops";
import { notificationText, parseNotificationParams } from "./notificationText";
import { allWorkspacesOptions, bellOptions, myMembershipsOptions, myWorkspacesOptions, meKeys, rolesOptions, teamOptions } from "./queries";
import {
  looksLikeEmail, memberFromRow, resetWorkspaceStore, useWorkspaces,
  type Member, type MemberNotification, type MyWorkspace, type NotificationKind, type WorkspaceStatus,
} from "./store";
import type { BootstrapResult, MembershipRow, MyAccessResult, NotificationRow, OpOutcome, WorkspaceRoleRow, WorkspaceRow } from "./types";

/** The workspace the person last chose themselves (v3: only explicit choices are kept, never an automatic pick). */
export const ACTIVE_WORKSPACE_KEY_PREFIX = "madp-factory-active-workspace-v3:";
/** v2 also kept automatic picks (for a super admin often a platform-access workspace), so it is dropped. */
const OLD_ACTIVE_WORKSPACE_KEY_PREFIX = "madp-factory-active-workspace-v2:";
export const LEGACY_SESSION_KEY = "madp-factory-workspace-session-v1";
const MSG_LOAD = "We couldn't load your workspaces. Try again in a moment.";
const MSG_NOT_IN_LIST = "This workspace isn't in your list.";

type AnyObserver = QueryObserver<any, any, any, any, any>;
type AnyResult = QueryObserverResult<any, any>;

let started = false;
let unsubscribeSession: (() => void) | null = null;
let generation = 0;
let sessionUid: string | null = null;
let profile: BlocksProfile | null = null;
let bootstrapDone = false;
let chosen: string | null = null;
/** True while the active workspace is a placeholder (the first membership) until the workspace names arrive. */
let tentative = false;
let readsStarted = false;
/** True while the active workspace is the remembered one and the list that confirms it has not arrived yet. */
let remembered = false;
/** The platform access read in flight (refreshAccess): one at a time. */
let accessInflight: Promise<boolean> | null = null;
const observers = new Map<string, AnyObserver>();
const unsubs = new Map<string, () => void>();
const keys = new Map<string, string>();

/* ---------- guarded storage ---------- */

function readStored(uid: string): string | null {
  try {
    return globalThis.localStorage?.getItem(ACTIVE_WORKSPACE_KEY_PREFIX + uid) ?? null;
  } catch {
    return null;
  }
}

function writeStored(uid: string, id: string): void {
  try {
    globalThis.localStorage?.setItem(ACTIVE_WORKSPACE_KEY_PREFIX + uid, id);
  } catch {
    /* a per-viewer convenience only */
  }
}

function removeLegacy(uid?: string): void {
  try {
    globalThis.localStorage?.removeItem(LEGACY_SESSION_KEY);
    if (uid) globalThis.localStorage?.removeItem(OLD_ACTIVE_WORKSPACE_KEY_PREFIX + uid);
  } catch {
    /* ignore */
  }
}

/* ---------- observers ---------- */

function watch(name: string, options: QueryObserverOptions<any, any, any, any, any>): void {
  const key = JSON.stringify(options.queryKey) + String(options.enabled);
  const existing = observers.get(name);
  if (existing) {
    if (keys.get(name) === key) return;
    keys.set(name, key);
    existing.setOptions(options);
    return;
  }
  const o: AnyObserver = new QueryObserver(queryClient, options);
  keys.set(name, key);
  observers.set(name, o);
  unsubs.set(name, o.subscribe(() => recompute()));
}

/** Stops one observer (the workspace list of the role the person no longer has). */
function unwatch(name: string): void {
  unsubs.get(name)?.();
  unsubs.delete(name);
  observers.delete(name);
  keys.delete(name);
}

function teardown(): void {
  for (const u of unsubs.values()) u();
  unsubs.clear();
  observers.clear();
  keys.clear();
  readsStarted = false;
  remembered = false;
}

const result = (name: string): AnyResult | null => observers.get(name)?.getCurrentResult() ?? null;
const settled = (r: AnyResult | null): boolean => !!r && r.status !== "pending";

/* ---------- snapshot ---------- */

const byName = (a: MyWorkspace, b: MyWorkspace) => a.name.localeCompare(b.name);

function roleDefs(rows: WorkspaceRoleRow[]): RoleDef[] {
  return rows.map((r) => ({
    key: r.Key, name: r.Name, description: r.Description || undefined, permissions: r.Permissions ?? [], isBuiltIn: !!r.IsBuiltIn,
  }));
}

function compatRole(roleKey: string, permissions: readonly string[]): WorkspaceRole {
  if (isWorkspaceRole(roleKey)) return roleKey;
  return permissions.includes("project.edit") ? "member" : "viewer";
}

function buildWorkspaces(
  superAdmin: boolean,
  rows: WorkspaceRow[],
  memberships: MembershipRow[],
  customRoles: RoleDef[],
): MyWorkspace[] {
  const mine = new Map(memberships.map((m) => [m.WorkspaceId, m]));
  const out: MyWorkspace[] = [];
  for (const w of rows) {
    const id = w.ItemId;
    const m = mine.get(id);
    if (!m && !superAdmin) continue;
    const status: WorkspaceStatus = w.Status === "suspended" || w.Status === "archived" ? w.Status : "active";
    if (superAdmin) {
      out.push({
        id, name: w.Name, createdAt: w.CreatedDate || "", role: "owner", roleKey: m?.RoleKey || "owner",
        roleName: WORKSPACE_ROLE_LABEL.owner, status, membershipId: m?.ItemId ?? null, viaPlatform: !m,
      });
      continue;
    }
    const perms = workspacePermissionsFor({ roleKey: m!.RoleKey, customRoles });
    const custom = isWorkspaceRole(m!.RoleKey) ? undefined : customRoles.find((r) => r.key === m!.RoleKey);
    out.push({
      id, name: w.Name, createdAt: w.CreatedDate || "", role: compatRole(m!.RoleKey, perms), roleKey: m!.RoleKey,
      roleName: isWorkspaceRole(m!.RoleKey) ? WORKSPACE_ROLE_LABEL[m!.RoleKey] : (custom?.name ?? "Custom role"),
      status, membershipId: m!.ItemId, viaPlatform: false,
    });
  }
  return out.sort(byName);
}

/** Without a remembered choice: the person's own workspace (a real membership) first, a platform-access one only when they have none. */
export function defaultWorkspace(list: readonly MyWorkspace[]): MyWorkspace | null {
  return list.find((w) => !w.viaPlatform && w.status === "active") ?? list.find((w) => !w.viaPlatform) ?? list[0] ?? null;
}

export function pickActive(uid: string, ids: readonly string[], list: MyWorkspace[] | null): string | null {
  const known = (id: string | null): id is string => !!id && ids.includes(id);
  if (known(chosen) && !(tentative && list)) return chosen;
  const stored = readStored(uid);
  if (known(stored)) {
    tentative = false;
    return stored;
  }
  if (list) {
    tentative = false;
    return defaultWorkspace(list)?.id ?? null;
  }
  tentative = true;
  return ids[0] ?? null;
}

function notificationsFrom(uid: string, rows: NotificationRow[]): MemberNotification[] {
  return rows.map((r) => ({
    id: r.ItemId,
    memberId: uid,
    kind: r.Kind as NotificationKind,
    text: notificationText(r.Kind, parseNotificationParams(r.ParamsJson)),
    link: isSafeInternalLink(r.Link) ? r.Link : "",
    read: !!r.IsRead,
    createdAt: r.CreatedDate || "",
  }));
}

/** The profile name for Account.DisplayName, or undefined when it is only an email (never written as a name). */
const realName = (n: string | undefined | null): string | undefined => (n && !looksLikeEmail(n) ? n : undefined);

function recompute(): void {
  if (!profile || !sessionUid) return;
  const uid = sessionUid;
  const superAdmin = useWorkspaces.getState().isSuperAdmin;
  const memR = result("memberships");
  const teamR = result("team");
  const rolesR = result("roles");
  const bellR = result("bell");

  const memberships: MembershipRow[] = memR?.data ?? [];
  const ids = [...new Set(memberships.map((m) => m.WorkspaceId))];
  // The workspace list of the person's role: every workspace for the super admin, the ones behind my memberships otherwise.
  // When the role changes during the session the old list stays on screen until the new one has come, then it goes.
  const listName = superAdmin ? "allWorkspaces" : "workspaces";
  const otherName = superAdmin ? "workspaces" : "allWorkspaces";
  let wsR = result(listName);
  const otherR = result(otherName);
  if (otherR) {
    const listDone = settled(wsR) || (!superAdmin && Boolean(memR?.data) && ids.length === 0);
    if (listDone) unwatch(otherName);
    else if (otherR.data) wsR = otherR;
  }
  const wsRows: WorkspaceRow[] | null = wsR?.data ?? null;
  const customRows: WorkspaceRoleRow[] = rolesR?.data ?? [];
  const customRoles = roleDefs(customRows).filter((r) => !r.isBuiltIn);

  const workspaces = wsRows ? buildWorkspaces(superAdmin, wsRows, memberships, customRoles) : [];
  const listIds = wsRows ? workspaces.map((w) => w.id) : superAdmin ? [] : ids;
  if (remembered && settled(superAdmin ? wsR : memR)) remembered = false;
  const active = remembered ? chosen : pickActive(uid, listIds, wsRows ? workspaces : null);
  if (active && active !== chosen) {
    // Only switchWorkspace remembers a choice: an automatic pick is worked out again on every sign-in.
    chosen = active;
    forgetOtherWorkspaces(active);
  } else if (!active) {
    chosen = null;
  }

  if (readsStarted) {
    if (memR?.data) {
      if (superAdmin) watch("allWorkspaces", allWorkspacesOptions(uid));
      else watch("workspaces", myWorkspacesOptions(uid, ids));
    }
    watch("team", teamOptions(chosen));
    watch("roles", rolesOptions(chosen));
  }
  const selfName = profile.displayName && !looksLikeEmail(profile.displayName) ? profile.displayName : null;
  const nameCtx = (r: MembershipRow) => ({
    selfName: r.UserId === uid ? selfName : null,
  });

  // The active workspace's people and my own row.
  const cur = workspaces.find((w) => w.id === chosen) ?? null;
  const teamRows: MembershipRow[] = chosen ? ((teamR?.data as MembershipRow[] | undefined) ?? []) : [];
  const team: Member[] = teamRows
    .filter((r) => r.WorkspaceId === chosen)
    .map((r) => memberFromRow(r, { customRoles, ...nameCtx(r) }));
  const myRow =
    teamRows.find((r) => r.UserId === uid && r.WorkspaceId === chosen) ??
    memberships.find((m) => m.WorkspaceId === chosen);
  let me: Member | null = null;
  if (chosen && myRow) {
    me = memberFromRow(myRow, { customRoles, ...nameCtx(myRow) });
    if (superAdmin) me = { ...me, role: "owner", permissions: [...WORKSPACE_PERMISSIONS], viaPlatform: !cur || cur.viaPlatform };
  } else if (chosen && superAdmin) {
    me = {
      id: uid, workspaceId: chosen, name: profile.displayName || profile.email, email: profile.email.toLowerCase(), role: "owner",
      status: "active", invitedAt: null, joinedAt: null, userId: uid, membershipId: "", roleKey: "owner",
      roleName: WORKSPACE_ROLE_LABEL.owner, permissions: [...WORKSPACE_PERMISSIONS], isCustomRole: false, viaPlatform: true,
    };
  }

  const errored = [memR, wsR, teamR, rolesR].find((r) => r?.status === "error");
  const loadError = errored ? MSG_LOAD : null;
  const memSettled = settled(memR);
  const wsSettled = memSettled && (superAdmin ? settled(wsR) : ids.length === 0 || settled(wsR));
  const teamSettled = !chosen || (settled(teamR) && settled(rolesR));
  const nowReady = memSettled && wsSettled && teamSettled && (bootstrapDone || workspaces.length > 0);

  useWorkspaces.setState((s) => ({
    ready: s.ready || nowReady,
    workspaceId: chosen,
    workspaces,
    team,
    members: team.filter((m) => m.status !== "pending-account"),
    me,
    customRoles,
    loadError,
    notifications: bellR?.data ? notificationsFrom(uid, (bellR.data as { items: NotificationRow[] }).items) : s.notifications,
  }));
}

/* ---------- bootstrap ---------- */

function applyBootstrap(r: OpOutcome<BootstrapResult>): void {
  const superAdmin = useWorkspaces.getState().isSuperAdmin;
  if (!r.ok) {
    useWorkspaces.setState({
      bootstrapPending: false,
      bootstrapError: r.error,
      platformPermissions: superAdmin ? [...PLATFORM_PERMISSIONS] : [],
    });
    return;
  }
  const v = r.value;
  const deactivated = v.account?.status === "deactivated";
  useWorkspaces.setState({
    bootstrapPending: false,
    bootstrapError: deactivated ? FUNCTION_ERROR_MESSAGES.account_inactive : null,
    platformPermissions: superAdmin ? [...PLATFORM_PERMISSIONS] : (v.platformPermissions ?? []).filter(isPlatformPermission),
    allowedEmailDomains: v.allowedEmailDomains ?? [],
    suspended: v.suspended ?? [],
    blocked: v.blocked ?? [],
  });
}

function startReads(uid: string, superAdmin: boolean): void {
  readsStarted = true;
  watch("memberships", myMembershipsOptions(uid));
  if (superAdmin) watch("allWorkspaces", allWorkspacesOptions(uid));
  watch("bell", bellOptions(uid));
  watch("team", teamOptions(chosen));
  watch("roles", rolesOptions(chosen));
  recompute();
}

async function begin(p: BlocksProfile): Promise<void> {
  const gen = ++generation;
  teardown();
  profile = p;
  sessionUid = p.userId;
  bootstrapDone = false;
  chosen = null;
  tentative = false;
  resetWorkspaceStore(false);
  useWorkspaces.setState({ userId: p.userId, email: p.email.toLowerCase(), isSuperAdmin: !!p.isSuperAdmin, bootstrapPending: true });
  claimCacheFor(p.userId);
  removeLegacy(p.userId);
  const stored = readStored(p.userId);
  if (stored) {
    chosen = stored;
    tentative = false;
    remembered = true;
  }
  // The browser's own reads (row policies) start at once; me.bootstrap only adds what needs the server.
  startReads(p.userId, !!p.isSuperAdmin);
  let outcome: OpOutcome<BootstrapResult>;
  try {
    await whenRefreshSettled();
    if (gen !== generation) return;
    outcome = await bootstrapMe({ displayName: realName(p.displayName) });
  } catch {
    outcome = { ok: false, error: MSG_LOAD };
  }
  if (gen !== generation) return;
  applyBootstrap(outcome);
  if (outcome.ok && outcome.value.accepted?.length) {
    // Refetch first so an empty person never flashes "not in a workspace" once an invitation was accepted.
    try {
      await queryClient.invalidateQueries({ queryKey: meKeys.memberships(p.userId) });
      await queryClient.invalidateQueries({ queryKey: meKeys.workspaces(p.userId) });
    } catch {
      /* the observers report their own errors */
    }
    if (gen !== generation) return;
  }
  bootstrapDone = true;
  recompute();
}

function onSession(): void {
  const s = useSession.getState();
  if (s.status === "restoring") {
    generation++;
    teardown();
    sessionUid = null;
    remembered = false;
    resetWorkspaceStore(false);
  } else if (s.status === "signed-out" || !s.profile) {
    generation++;
    teardown();
    sessionUid = null;
    profile = null;
    remembered = false;
    resetWorkspaceStore(true);
  } else if (s.profile.mustChangePassword) {
    // Gated until the person sets their own password: the server refuses every read, so start nothing.
    generation++;
    teardown();
    sessionUid = null;
    remembered = false;
  } else if (s.profile.userId !== sessionUid) {
    void begin(s.profile);
  } else if (s.profile !== profile) {
    followProfile(s.profile);
  }
}

/** Same person, a fresh profile (the session refreshed it): a new name or e-mail shows at once; the super admin flag
 *  granted or removed changes the workspace list, my role in it and the platform permissions without a new sign-in. */
function followProfile(p: BlocksProfile): void {
  const before = profile;
  profile = p;
  const store = useWorkspaces.getState();
  const superAdmin = !!p.isSuperAdmin;
  const email = p.email.toLowerCase();
  const flipped = store.isSuperAdmin !== superAdmin;
  const renamed = !before || before.displayName !== p.displayName || before.email !== p.email;
  if (!flipped && !renamed) return;
  if (flipped) {
    // the super admin holds every platform permission; anyone else what their roles give, read again just below
    useWorkspaces.setState({ isSuperAdmin: superAdmin, email, platformPermissions: superAdmin ? [...PLATFORM_PERMISSIONS] : [] });
    if (readsStarted && superAdmin && sessionUid) watch("allWorkspaces", allWorkspacesOptions(sessionUid));
    if (!superAdmin) void refreshAccess();
  } else if (store.email !== email) {
    useWorkspaces.setState({ email });
  }
  recompute();
}

const sameList = (a: readonly string[], b: readonly string[]): boolean => a.length === b.length && a.every((x, i) => x === b[i]);

/**
 * Reads the person's platform permissions again (me.access: a read, nothing written, no invitation accepted) and keeps
 * the store's with them; one read at a time, and never while me.bootstrap still brings the first ones. A changed answer
 * also reads the platform role list again, so the roles shown and the permissions agree. A failed read keeps what is
 * there. True when an answer was applied.
 */
export function refreshAccess(): Promise<boolean> {
  if (!sessionUid || !bootstrapDone) return Promise.resolve(false);
  if (!accessInflight) {
    const uid = sessionUid;
    const gen = generation;
    accessInflight = (async () => {
      let r: OpOutcome<MyAccessResult>;
      try {
        r = await readMyAccess();
      } catch {
        return false;
      }
      if (gen !== generation || uid !== sessionUid || !r.ok) return false;
      const superAdmin = useWorkspaces.getState().isSuperAdmin;
      const next = superAdmin ? [...PLATFORM_PERMISSIONS] : (r.value.platformPermissions ?? []).filter(isPlatformPermission);
      if (!sameList(useWorkspaces.getState().platformPermissions ?? [], next)) {
        useWorkspaces.setState({ platformPermissions: next });
        try {
          await queryClient.invalidateQueries({ queryKey: meKeys.admin(uid, "platformRole.list") });
        } catch {
          /* the list reports its own errors */
        }
      }
      return true;
    })().finally(() => {
      accessInflight = null;
    });
  }
  return accessInflight;
}

/** Idempotent: removes the legacy session key and follows the session.
 *  When an OIDC session is active, skip workspace sync entirely — no me.bootstrap or data reads.
 *  Those calls target the MADP tenant and fail with an OIDC cross-tenant token. */
export function startWorkspaceSync(): void {
  if (started) return;
  started = true;
  removeLegacy();
  // Check if OIDC session is active — skip workspace sync to avoid cross-tenant me.bootstrap calls
  try {
    const raw = globalThis.sessionStorage?.getItem("madp-oidc-session-v1");
    if (raw) {
      const data = JSON.parse(raw) as { expiresAtMs?: number };
      if (data.expiresAtMs && data.expiresAtMs > Date.now()) {
        // OIDC session active — fetch real workspaces from the data endpoint (uses service token on BFF)
        const oidcData = JSON.parse(raw) as { accessToken?: string; profile?: Record<string, unknown>; expiresAtMs?: number };
        const profile = oidcData.profile;
        const userId = String(profile?.userId || "");
        const email = String(profile?.email || "");
        const displayName = String(profile?.displayName || email);
        resetWorkspaceStore(false);
        // Set ready immediately with a placeholder, then update when data arrives
        const setWs = (wsId: string, wsName: string) => {
          useWorkspaces.setState({
            ready: true, isSuperAdmin: true, userId, email, workspaceId: wsId,
            platformPermissions: [...PLATFORM_PERMISSIONS],
            workspaces: [{ id: wsId, name: wsName, createdAt: new Date().toISOString(), role: "admin", roleKey: "admin", roleName: "Admin", status: "active", membershipId: userId, viaPlatform: false }],
            members: [{ id: userId, workspaceId: wsId, name: displayName, email, role: "admin", status: "active", invitedAt: null, joinedAt: new Date().toISOString(), userId, membershipId: userId, roleKey: "admin", roleName: "Admin", permissions: [...WORKSPACE_PERMISSIONS], isCustomRole: false }],
            team: [{ id: userId, workspaceId: wsId, name: displayName, email, role: "admin", status: "active", invitedAt: null, joinedAt: new Date().toISOString(), userId, membershipId: userId, roleKey: "admin", roleName: "Admin", permissions: [...WORKSPACE_PERMISSIONS], isCustomRole: false }],
            me: { id: userId, workspaceId: wsId, name: displayName, email, role: "admin", status: "active", invitedAt: null, joinedAt: new Date().toISOString(), userId, membershipId: userId, roleKey: "admin", roleName: "Admin", permissions: [...WORKSPACE_PERMISSIONS], isCustomRole: false },
          });
        };
        // Auto-resolve a workspace (internal implementation detail — users never see it).
        // Fetch existing, or create one silently if none exists.
        const headers: Record<string, string> = { "content-type": "application/json" };
        if (oidcData.accessToken) headers.authorization = `Bearer ${oidcData.accessToken}`;
        fetch("/api/data", {
          method: "POST", credentials: "same-origin", headers,
          body: JSON.stringify({ reads: [{ schema: "Workspace", fields: ["ItemId", "Name", "Status"], filter: [{ field: "Status", op: "eq", value: "active" }], sort: [{ field: "CreatedDate", dir: "desc" }], pageNo: 1, pageSize: 1 }] }),
        }).then(r => r.json()).then(async (data: { results?: Array<{ ok: boolean; items: Array<{ ItemId: string; Name: string }> }> }) => {
          const ws = data.results?.[0]?.items?.[0];
          if (ws) { setWs(ws.ItemId, ws.Name); return; }
          // No workspace — auto-create one via workspace.create
          try {
            const res = await fetch("/api/fn/workspace", {
              method: "POST", credentials: "same-origin", headers,
              body: JSON.stringify({ op: "workspace.create", requestId: crypto.randomUUID(), args: { name: "Workspace" } }),
            });
            const result = await res.json() as { ok?: boolean; data?: { workspace?: { ItemId?: string; Name?: string } } };
            if (result.ok && result.data?.workspace?.ItemId) {
              setWs(result.data.workspace.ItemId, result.data.workspace.Name || "Workspace");
            } else { setWs("fallback", "Workspace"); }
          } catch { setWs("fallback", "Workspace"); }
        }).catch(() => setWs("fallback", "Workspace"));
        return;
      }
    }
  } catch { /* continue with normal sync */ }
  unsubscribeSession = useSession.subscribe(onSession);
  onSession();
}

/** Tests only: stops following the session and drops the observers. */
export function stopWorkspaceSync(): void {
  unsubscribeSession?.();
  unsubscribeSession = null;
  started = false;
  generation++;
  teardown();
  sessionUid = null;
  profile = null;
  chosen = null;
  remembered = false;
  bootstrapDone = false;
  accessInflight = null;
}

/** Re-runs me.bootstrap (accepts new invitations), then refetches the memberships and workspaces. */
export async function rebootstrap(): Promise<OpOutcome<BootstrapResult>> {
  let outcome: OpOutcome<BootstrapResult>;
  useWorkspaces.setState({ bootstrapPending: true });
  try {
    outcome = await bootstrapMe({ displayName: realName(profile?.displayName) });
  } catch {
    outcome = { ok: false, error: MSG_LOAD };
  }
  applyBootstrap(outcome);
  if (sessionUid) {
    try {
      await queryClient.invalidateQueries({ queryKey: meKeys.memberships(sessionUid) });
      await queryClient.invalidateQueries({ queryKey: meKeys.workspaces(sessionUid) });
    } catch {
      /* the observers report their own errors */
    }
    recompute();
  }
  return outcome;
}

/** Makes another of my workspaces the active one. The choice is a convenience; the row policies still decide access. */
export async function switchWorkspace(id: string): Promise<OpOutcome> {
  const s = useWorkspaces.getState();
  if (!sessionUid || !s.workspaces.some((w) => w.id === id)) return { ok: false, error: MSG_NOT_IN_LIST };
  chosen = id;
  tentative = false;
  writeStored(sessionUid, id);
  forgetOtherWorkspaces(id);
  if (readsStarted) {
    watch("team", teamOptions(id));
    watch("roles", rolesOptions(id));
  }
  recompute();
  return { ok: true, value: undefined };
}
