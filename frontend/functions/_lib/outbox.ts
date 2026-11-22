// Notification writer (design 7.1): resolves audiences, enriches and validates params, and writes one inbox row per recipient.
import { OpError } from "./errors";
import { f } from "./filter";
import type { Caller } from "./caller";
import type { RawGateway, Row } from "./gateway";
import type { BoundIds } from "./ids";
import {
  isSafeInternalLink,
  NOTIFICATION_KIND_LIST,
  NOTIFICATION_KINDS as KIND_SHAPES,
  validateNotification,
  type NotificationKind,
} from "../../src/domain/notifications";
import { followersOf, type NotificationAudience } from "../../src/domain/factoryNotes";
import { emailTemplateFor, normaliseEmailAddress } from "../../src/domain/notificationEmail";

/** The one catalogue (src/domain/notifications.ts). */
export const NOTIFICATION_KINDS: readonly NotificationKind[] = NOTIFICATION_KIND_LIST;
export type { NotificationKind };

export const MAX_RECIPIENTS = 200;
export const MAX_PARAMS_CHARS = 2000;
export const MAX_EVENT_KEY_CHARS = 160;

export type NotifyInput = {
  kind: NotificationKind;
  projectId?: string;
  /** Message keys and params only, never free text from other people's records. */
  params?: Record<string, unknown>;
  link?: string;
  eventKey?: string;
  /** Email addresses the handler already knows, by recipient user id; the outbox never reads them back. */
  emails?: Readonly<Record<string, string>>;
} & (
  | { recipients: readonly string[]; audience?: undefined }
  | { audience: NotificationAudience; recipients?: undefined }
);

export interface Outbox {
  push(n: NotifyInput): void;
  prepare(raw?: RawGateway): Promise<Row[]>;
  rows(): Row[];
  flush(raw: RawGateway, concurrency?: number): Promise<void>;
}

export interface OutboxOptions {
  ids: BoundIds;
  op: string;
  requestId: string;
  caller: Pick<Caller, "userId" | "email" | "isEngine" | "identitySource">;
  workspaceId: string | null;
  projectId: string | null;
  /** Getters: early self-scope ops know the account only after round 1. */
  account: () => Row | null;
  project: () => Row | null;
  /** Receives names only, never values. */
  warn?: (data: Record<string, string>) => void;
}

interface Queued {
  n: NotifyInput;
  eventKey: string;
  recipients: string[] | null;
}

const str = (v: unknown): string => (typeof v === "string" ? v : "");

export function createOutbox(o: OutboxOptions): Outbox {
  const queued: Queued[] = [];
  let last: Row[] = [];
  // Re-entrant flush: what was already written is never prepared or written again.
  const flushed = new Set<Queued>();
  let flushedRows: Row[] = [];
  let chain: Promise<void> = Promise.resolve();

  const invalid = (kind: string, reason: string, fields: string): never => {
    o.warn?.({ kind, reason, fields });
    throw new OpError("internal");
  };

  async function prepare(raw?: RawGateway): Promise<Row[]> {
    const rows = await prepareOf(queued, raw);
    last = rows;
    return rows.map((r) => ({ ...r }));
  }

  async function prepareOf(list: readonly Queued[], raw?: RawGateway): Promise<Row[]> {
    const P = o.project();
    const resolved = list.map((q) => {
      let recipients: string[];
      if (q.recipients) recipients = q.recipients;
      else {
        const actor = q.n.audience === "project-followers-and-actor" && !o.caller.isEngine ? o.caller.userId : null;
        const readers = P && Array.isArray(P.ReaderIds) ? (P.ReaderIds as unknown[]).filter((x): x is string => typeof x === "string") : [];
        recipients = followersOf({ assigneeUserId: str(P?.AssigneeUserId), createdByUserId: str(P?.CreatedByUserId), readerIds: readers }, actor);
      }
      return { q, recipients };
    });

    // Validate everything before the first insert or read.
    const checked = resolved.map(({ q, recipients }) => {
      const { kind } = q.n;
      const shape: { required: readonly string[]; optional: readonly string[] } = KIND_SHAPES[kind];
      const params: Record<string, unknown> = { ...(q.n.params ?? {}) };
      const fill = (key: string, value: unknown): void => {
        if (!(key in params) && (shape.required.includes(key) || shape.optional.includes(key)) && value !== undefined && value !== "") params[key] = value;
      };
      fill("projectId", q.n.projectId ?? o.projectId ?? undefined);
      fill("projectName", str(P?.Name));
      fill("workspaceId", o.workspaceId ?? undefined);
      if (!o.caller.isEngine) fill("actorName", str(o.account()?.DisplayName) || o.caller.email);
      const v = validateNotification(kind, params, q.n.link ?? null);
      if (!v.ok) invalid(kind, v.reason, (v.fields ?? []).join(","));
      return { q, recipients, params };
    });

    // Addresses come from what the handler pushed or the router already loaded. Only a template kind (invited,
    // access-requested) with a recipient nobody knows the address of costs one Account read; every other kind reads nothing.
    const known = new Map<string, string>();
    const self = normaliseEmailAddress(o.account()?.Email) ?? normaliseEmailAddress(o.caller.email);
    if (self && !o.caller.isEngine) known.set(o.caller.userId, self);
    for (const c of checked) {
      for (const [id, e] of Object.entries(c.q.n.emails ?? {})) {
        const to = normaliseEmailAddress(e);
        if (to) known.set(id, to);
      }
    }
    const unknown = [
      ...new Set(checked.filter((c) => emailTemplateFor(c.q.n.kind)).flatMap((c) => c.recipients).filter((id) => !known.has(id))),
    ];
    if (raw && unknown.length > 0 && o.caller.identitySource !== "iam") {
      const res = await raw.find("Account", { where: f.in("UserId", unknown), fields: ["UserId", "Email", "Status"], page: 1, pageSize: 100 });
      for (const a of res.items) {
        const to = a.Status === "active" ? normaliseEmailAddress(a.Email) : null;
        if (to && typeof a.UserId === "string") known.set(a.UserId, to);
      }
    }

    const rows: Row[] = [];
    for (const { q, recipients, params } of checked) {
      const tpl = emailTemplateFor(q.n.kind);
      const projectId = q.n.projectId ?? o.projectId;
      for (const recipient of recipients) {
        const to = tpl ? known.get(recipient) : undefined;
        const withEmail = tpl && to ? { ...params, emailTo: to, emailTemplate: tpl.purpose } : params;
        const paramsJson = JSON.stringify(withEmail);
        if (paramsJson.length > MAX_PARAMS_CHARS) invalid(q.n.kind, "params-too-large", "ParamsJson");
        const row: Row = {
          RequestKey: o.ids.notification(q.eventKey, recipient),
          RecipientUserId: recipient,
          Kind: q.n.kind,
          EventKey: q.eventKey,
          ParamsJson: paramsJson,
          IsRead: false,
          EmailStatus: tpl && to ? "pending" : "none",
          CreatedByUserId: o.caller.userId,
          UpdatedByUserId: o.caller.userId,
        };
        if (o.workspaceId !== null) row.WorkspaceId = o.workspaceId;
        if (projectId !== null && projectId !== undefined) row.ProjectId = projectId;
        if (q.n.link !== undefined) row.Link = q.n.link;
        rows.push(row);
      }
    }
    return rows;
  }

  return {
    push(n) {
      if (!(NOTIFICATION_KINDS as readonly string[]).includes(n.kind)) throw new TypeError("Unknown notification kind.");
      const hasRecipients = n.recipients !== undefined;
      const hasAudience = n.audience !== undefined;
      if (hasRecipients === hasAudience) throw new TypeError("Give recipients or an audience, not both or neither.");
      let recipients: string[] | null = null;
      if (hasRecipients) {
        recipients = Array.isArray(n.recipients) ? [...new Set(n.recipients)] : [];
        if (recipients.length < 1 || recipients.length > MAX_RECIPIENTS || recipients.some((r) => typeof r !== "string" || r === "")) {
          throw new TypeError("Invalid notification recipients.");
        }
      } else {
        if (n.audience !== "project-followers" && n.audience !== "project-followers-and-actor") throw new TypeError("Unknown notification audience.");
        if (!o.project()) throw new TypeError("An audience needs a project-scoped op.");
      }
      if (n.link !== undefined && !isSafeInternalLink(n.link)) throw new TypeError("Invalid notification link.");
      const eventKey = n.eventKey ?? `${o.op}:${o.requestId}:${n.kind}`;
      if (eventKey.length > MAX_EVENT_KEY_CHARS) throw new TypeError("Notification event key too long.");
      queued.push({ n, eventKey, recipients });
    },
    prepare,
    rows: () => last.map((r) => ({ ...r })),
    async flush(raw, _concurrency) {
      const run = chain.then(async () => {
        const pending = queued.filter((q) => !flushed.has(q));
        if (pending.length === 0) return;
        const rows = await prepareOf(pending, raw);
        last = [...flushedRows, ...rows];
        let failed = false;
        // One round: every row starts together. created:false = the same RequestKey already wrote it.
        await Promise.all(
          rows.map((row) =>
            raw.insert("Notification", row).catch(() => {
              failed = true;
            }),
          ),
        );
        if (failed) throw new OpError("unavailable");
        for (const q of pending) flushed.add(q);
        flushedRows = last;
      });
      chain = run.catch(() => undefined);
      return run;
    },
  };
}
