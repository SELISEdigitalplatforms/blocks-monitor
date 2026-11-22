// Queued AuditEvent rows: written by the router (or flushed by it) after the handler, never by a handler's own gateway.
import { OpError } from "./errors";
import { f } from "./filter";
import type { RawGateway, Row } from "./gateway";
import type { BoundIds } from "./ids";

/** What a handler (or the router) records. */
export interface AuditInput {
  action?: string;
  targetType: string;
  targetId: string;
  details?: Record<string, unknown>;
}

/** Copies of blocks/data/validations.json AuditEvent.Action / TargetType. */
export const AUDIT_ACTION_PATTERN = /^[a-z][a-zA-Z]*([.][a-z][a-zA-Z-]*)+$/;
export const AUDIT_TARGET_TYPE_PATTERN = /^(|[a-z][a-z0-9-]{0,39})$/;
export const MAX_AUDIT_DETAILS_CHARS = 4000;

// ProxySecretRedactor.IsSensitiveKey (f0/functions-deploy.mjs)
const SENSITIVE_KEY = /(key|token|secret|passw|pwd|signature|^sig$|auth|session|credential|cookie|bearer|jwt)/i;

function strip(value: unknown, depth: number): unknown {
  if (Array.isArray(value)) return depth > 8 ? [] : value.map((x) => strip(x, depth + 1));
  if (value !== null && typeof value === "object") {
    if (depth > 8) return {};
    const out: Record<string, unknown> = {};
    for (const [k, x] of Object.entries(value as Record<string, unknown>)) {
      if (SENSITIVE_KEY.test(k)) continue;
      out[k] = strip(x, depth + 1);
    }
    return out;
  }
  return value;
}

/** DetailsJson: credential-shaped keys removed at any depth, at most 4000 characters. */
export function sanitizeDetails(details?: Record<string, unknown>): string {
  if (details === undefined) return "{}";
  const json = JSON.stringify(strip(details, 0)) ?? "{}";
  return json.length > MAX_AUDIT_DETAILS_CHARS ? '{"truncated":true}' : json;
}

export interface AuditQueue {
  push(e: AuditInput): void;
  pushViaPlatform(workspaceId: string): void;
  rows(): Row[];
  /** Inserts this request's AuditEvent now under a caller-chosen unique RequestKey: created:false (with the existing row) when another request holds the key. */
  guard(e: AuditInput, key: string, raw: RawGateway): Promise<{ created: boolean; row: Row }>;
  flush(raw: RawGateway): Promise<void>;
}

export interface AuditQueueOptions {
  ids: BoundIds;
  op: string;
  caller: { userId: string; isSuperAdmin: boolean; impersonated: boolean };
  workspaceId: string | null;
  projectId: string | null;
  now: () => Date;
}

export function createAuditQueue(o: AuditQueueOptions): AuditQueue {
  const queued: Row[] = [];
  const written = new Set<Row>();
  let chain: Promise<void> = Promise.resolve();

  // Exactly one AuditEvent per request: the platform-access row is a placeholder that the
  // op's own audit replaces (the op's row then carries the viaPlatform flag).
  let platformRow: Row | null = null;

  function build(e: AuditInput, requestKey: string): Row {
    const action = e.action ?? o.op;
    if (!AUDIT_ACTION_PATTERN.test(action)) throw new TypeError("Invalid audit action.");
    if (!AUDIT_TARGET_TYPE_PATTERN.test(e.targetType)) throw new TypeError("Invalid audit target type.");
    const row: Row = {
      RequestKey: requestKey,
      ActorUserId: o.caller.userId,
      ActorIsSuperAdmin: o.caller.isSuperAdmin,
      Impersonated: o.caller.impersonated,
      Action: action,
      TargetType: e.targetType,
      TargetId: e.targetId,
      DetailsJson: sanitizeDetails(e.details),
      At: o.now().toISOString(),
      CreatedByUserId: o.caller.userId,
      UpdatedByUserId: o.caller.userId,
    };
    if (o.workspaceId !== null) row.WorkspaceId = o.workspaceId;
    if (o.projectId !== null) row.ProjectId = o.projectId;
    return row;
  }

  // The unwritten platform placeholder is replaced by the op's own audit (which then carries the viaPlatform flag).
  function takePlatform(e: AuditInput): AuditInput {
    if (platformRow === null) return e;
    const i = queued.indexOf(platformRow);
    if (i >= 0 && !written.has(platformRow)) queued.splice(i, 1);
    platformRow = null;
    return { ...e, details: { ...(e.details ?? {}), viaPlatform: true } };
  }

  function push(e: AuditInput, placeholder = false): void {
    if (!placeholder) e = takePlatform(e);
    const row = build(e, o.ids.audit(queued.length + 1));
    queued.push(row);
    if (placeholder) platformRow = row;
  }

  return {
    push,
    pushViaPlatform(workspaceId) {
      push({ targetType: "workspace", targetId: workspaceId, details: { viaPlatform: true } }, true);
    },
    rows: () => queued.map((r) => ({ ...r })),
    async guard(e, key, raw) {
      if (typeof key !== "string" || key.length < 1 || key.length > 200) throw new TypeError("Invalid audit guard key.");
      for (let n = 1; n <= queued.length + 1; n++) if (o.ids.audit(n) === key) throw new TypeError("Invalid audit guard key.");
      const row = build(takePlatform(e), key);
      let res: { created: boolean; itemId: string | null };
      try {
        res = await raw.insert("AuditEvent", row);
      } catch {
        throw new OpError("unavailable");
      }
      if (res.created) {
        queued.push(row);
        written.add(row);
        return { created: true, row: { ...row, ...(res.itemId ? { ItemId: res.itemId } : {}) } };
      }
      let found: Row | undefined;
      try {
        found = (await raw.find("AuditEvent", { where: f.eq("RequestKey", key), fields: ["ItemId", "ActorUserId", "DetailsJson"], pageSize: 1 })).items[0];
      } catch {
        throw new OpError("unavailable");
      }
      if (!found) throw new OpError("unavailable");
      return { created: false, row: found };
    },
    async flush(raw) {
      // Re-entrant: rows already written are skipped, and calls run one after another so none is written twice.
      const run = chain.then(async () => {
        const pending = queued.filter((row) => !written.has(row));
        if (pending.length === 0) return;
        let failed = false;
        // One round: every row starts together. A duplicate (created: false) means a retry already wrote it.
        await Promise.all(
          pending.map((row) =>
            raw.insert("AuditEvent", row).then(
              () => void written.add(row),
              () => {
                failed = true;
              },
            ),
          ),
        );
        if (failed) throw new OpError("unavailable");
      });
      chain = run.catch(() => undefined);
      return run;
    },
  };
}
