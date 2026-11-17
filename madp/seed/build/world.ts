// Shared state of one seed run: the writer, the people's IAM ids, the workspaces, and the activity helpers (audit log
// and in-app notifications) every builder uses.
import { capKey } from "../../functions/_lib/ids";
import type { When } from "../core/clock";
import type { Seeder, WsScope } from "../core/writer";
import { person } from "../data/people";
import type { P, WorkspaceDef } from "../model";

export interface World {
  s: Seeder;
  users: Map<P, string>;
  ws: Map<string, WsScope>;
  wsDefs: Map<string, WorkspaceDef>;
  superAdmin: P;
  /** Running numbers of the run (audit entries, …). */
  seq: Map<string, number>;
}

export function next(w: World, name: string): number {
  const n = (w.seq.get(name) ?? 0) + 1;
  w.seq.set(name, n);
  return n;
}

export function uid(w: World, p: P): string {
  const id = w.users.get(p);
  if (!id) throw new Error(`seed: ${p} has no account`);
  return id;
}

export const nameOf = (p: P): string => person(p).name;

/** One audit log entry. DetailsJson carries the readable names the admin log shows (src/blocks/admin.ts auditEntryFromRow). */
export async function audit(
  w: World,
  e: {
    actor: P;
    action: string;
    targetType: string;
    targetId: string;
    targetLabel: string;
    at: string;
    ws?: WsScope | null;
    projectId?: string;
    details?: Record<string, unknown>;
  },
): Promise<void> {
  const actor = person(e.actor);
  const wsName = e.ws ? w.wsDefs.get(e.ws.key)?.name ?? "" : "";
  const details = {
    ...(e.details ?? {}),
    actorEmail: actor.email,
    actorName: actor.name,
    targetLabel: e.targetLabel,
    ...(wsName ? { workspaceName: wsName } : {}),
    ...(actor.superAdmin && e.ws ? { viaPlatform: true } : {}),
  };
  const seq = next(w, "audit");
  await w.s.insert(
    "AuditEvent",
    {
      WorkspaceId: e.ws?.id ?? "",
      ProjectId: e.projectId ?? "",
      ActorUserId: uid(w, e.actor),
      ActorIsSuperAdmin: actor.superAdmin === true,
      Impersonated: false,
      Action: e.action,
      TargetType: e.targetType,
      TargetId: e.targetId,
      DetailsJson: JSON.stringify(details).slice(0, 4000),
      At: e.at,
    },
    { key: `audit-${seq}`, ws: null, by: uid(w, e.actor), at: e.at, requestKey: `seed:audit:${seq}` },
  );
}

/** One in-app notification per recipient (the bell). The actor gets none. */
export async function notify(
  w: World,
  n: {
    kind: string;
    to: P[];
    params: Record<string, string | number>;
    link: string;
    at: string;
    eventKey: string;
    actor?: P;
    ws?: WsScope | null;
    projectId?: string;
    /** Recipients who have not opened it yet. */
    unread?: P[];
    email?: boolean;
  },
): Promise<void> {
  const seen = new Set<string>();
  for (const p of n.to) {
    if (seen.has(p) || p === n.actor) continue;
    seen.add(p);
    const recipient = uid(w, p);
    // Notes of the last two working days are still unread; older ones were opened soon after they came in.
    const recent = Date.parse(n.at) >= w.s.clock.ms("-2d@08:00");
    const read = !recent && !(n.unread ?? []).includes(p);
    const eventKey = n.eventKey.slice(0, 160);
    await w.s.insert(
      "Notification",
      {
        RecipientUserId: recipient,
        WorkspaceId: n.ws?.id ?? "",
        ProjectId: n.projectId ?? "",
        EventKey: eventKey,
        Kind: n.kind,
        ParamsJson: JSON.stringify(n.params),
        Link: n.link,
        IsRead: read,
        ...(read ? { ReadAt: w.s.clock.plus(n.at, 47) } : {}),
        EmailStatus: n.email ? "sent" : "none",
      },
      {
        key: `notify-${eventKey}-${recipient}`,
        ws: null,
        by: n.actor ? uid(w, n.actor) : recipient,
        at: n.at,
        requestKey: capKey(`notify:${eventKey}:${recipient}`),
      },
    );
  }
}

export function at(w: World, when: When): string {
  return w.s.clock.at(when);
}
