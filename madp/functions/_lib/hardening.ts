// Router hardening glue (both hosts). The rules live in src/domain/security.ts; this file turns them into OpErrors and
// gateway reads. The router calls these at five hook points only.
import {
  INPUT_SHAPE_MESSAGE_KEY,
  IMPERSONATION_MESSAGE_KEY,
  QUOTA_MESSAGE_KEY,
  checkInputShape,
  impersonationRefused,
  quotaFor,
  quotaVerdict,
  redact,
} from "../../src/domain/security";
import { OpError } from "./errors";
import { f } from "./filter";
import type { RawGateway, Row } from "./gateway";
import type { HostDescriptor, Kind, PlatformCtx, Scope } from "./types";

/** 6.1: the same shape guard as Host A, for Host B. */
export function guardInputShape(parsed: unknown): void {
  if (!checkInputShape(parsed).ok) throw new OpError("invalid_input", INPUT_SHAPE_MESSAGE_KEY);
}

/** 6.2: an impersonated caller never approves, promotes, grants or changes settings. */
export function refuseImpersonated(
  caller: { impersonated: boolean },
  d: { op: string; kind: Kind; scope: Scope; permission?: unknown },
): void {
  if (!caller.impersonated) return;
  if (impersonationRefused({ impersonated: true, op: d.op, kind: d.kind, scope: d.scope, permission: d.permission as never })) {
    throw new OpError("forbidden", IMPERSONATION_MESSAGE_KEY);
  }
}

export interface QuotaRead {
  quota: NonNullable<ReturnType<typeof quotaFor>>;
  /** Null when the read failed. */
  rows: Promise<Row[] | null>;
}

const rowsOf = (res: unknown): Row[] => {
  if (Array.isArray(res)) return res as Row[];
  const items = (res as { items?: unknown } | null)?.items;
  return Array.isArray(items) ? (items as Row[]) : [];
};

/** 6.3: starts the caller's newest `max` rows read (round trip 1). Null when the op has no quota. */
export async function startQuotaRead(
  raw: RawGateway,
  caller: { userId: string },
  d: { op: string; kind: Kind; scope: Scope },
): Promise<QuotaRead | null> {
  if (d.scope === "engine") return null;
  const quota = quotaFor(d.op, d.kind);
  if (!quota) return null;
  const rows =
    quota.source === "audit"
      ? raw.find("AuditEvent", {
          where: f.and(f.eq("ActorUserId", caller.userId), f.eq("Action", d.op)),
          fields: ["ItemId", "At"],
          sort: { field: "At", dir: "desc" },
          page: 1,
          pageSize: quota.max,
        })
      : raw.find("Operation", {
          where: f.and(f.eq("ActorUserId", caller.userId), f.eq("Op", d.op)),
          fields: ["ItemId", "CreatedDate"],
          sort: { field: "CreatedDate", dir: "desc" },
          page: 1,
          pageSize: quota.max,
        });
  return { quota, rows: rows.then(rowsOf, () => null) };
}

/**
 * Refuses when the caller already has `max` rows inside the window. A failed read fails open (the quota is a brake, not
 * the access check). Without atomic counters (MF-B03) a burst may overshoot by the number of parallel requests.
 */
export async function enforceQuota(r: QuotaRead | null | undefined, nowMs: number): Promise<void> {
  if (!r) return;
  const rows = await r.rows;
  if (!rows) return;
  const field = r.quota.source === "audit" ? "At" : "CreatedDate";
  const stamps = rows
    .map((row) => Date.parse(String(row[field] ?? "")))
    .filter((t) => Number.isFinite(t))
    .sort((a, b) => b - a);
  const verdict = quotaVerdict(r.quota, stamps, nowMs);
  if (verdict.limited) {
    throw new OpError("limit_reached", QUOTA_MESSAGE_KEY, {
      op: r.quota.op,
      max: r.quota.max,
      windowMinutes: r.quota.windowMinutes,
      retryAfterSeconds: verdict.retryAfterSeconds,
    });
  }
}

/** 6.4: log values go through redact(); numbers and booleans stay as they are. */
export function logValue<T extends string | number | boolean>(v: T): T | string {
  return typeof v === "string" ? redact(v) : v;
}

const LOCAL_KEYS = ["kind", "tokenVerification", "csp", "maxBodyBytes", "perUserPerMinute", "perUserInFlight", "globalInFlight"];

/** 6.5: only a well-formed local descriptor passes; anything else is a Blocks host. Holds no env value and no id. */
export function hostDescriptor(pctx: PlatformCtx | undefined): Readonly<HostDescriptor> {
  const h = pctx?.host as Record<string, unknown> | undefined;
  const ok =
    h !== undefined &&
    h !== null &&
    typeof h === "object" &&
    h.kind === "local" &&
    Object.keys(h).length === LOCAL_KEYS.length &&
    LOCAL_KEYS.every((k) => k in h) &&
    (h.tokenVerification === "iam" || h.tokenVerification === "iam+signature") &&
    (h.csp === "enforce" || h.csp === "report-only") &&
    ["maxBodyBytes", "perUserPerMinute", "perUserInFlight", "globalInFlight"].every(
      (k) => typeof h[k] === "number" && Number.isFinite(h[k] as number),
    );
  if (!ok) return Object.freeze({ kind: "blocks" } as const);
  return Object.freeze({
    kind: "local",
    tokenVerification: h.tokenVerification,
    csp: h.csp,
    maxBodyBytes: h.maxBodyBytes,
    perUserPerMinute: h.perUserPerMinute,
    perUserInFlight: h.perUserInFlight,
    globalInFlight: h.globalInFlight,
  } as HostDescriptor);
}
