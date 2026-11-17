import { createHash } from "node:crypto";

// The Operation and Account rows have no chosen ItemId (the hosted gateway rejects a
// client-supplied ItemId), so the brief's ids.operation / ids.account are dropped:
// Operation is found by RequestId and Account by UserId (both unique in blocks/data/indexes.json).

/** Namespace for every MF uuid5. It must NEVER change: stored ids derive from it. */
export const MF_NAMESPACE = "28fb5daf-3ef9-41bc-86cf-eb50107bbb19";
export const DNS_NAMESPACE = "6ba7b810-9dad-11d1-80b4-00c04fd430c8";

export const REQUEST_KEY_MAX = 200;

/** RFC 4122 version 5 (SHA-1) UUID. */
export function uuid5(name: string, namespace: string = MF_NAMESPACE): string {
  const ns = Buffer.from(namespace.replace(/-/g, ""), "hex");
  const h = createHash("sha1").update(ns).update(Buffer.from(name, "utf8")).digest();
  const b = Buffer.from(h.subarray(0, 16));
  b[6] = (b[6] & 0x0f) | 0x50;
  b[8] = (b[8] & 0x3f) | 0x80;
  const x = b.toString("hex");
  return `${x.slice(0, 8)}-${x.slice(8, 12)}-${x.slice(12, 16)}-${x.slice(16, 20)}-${x.slice(20)}`;
}

function of(...parts: unknown[]): string {
  return uuid5(parts.map(String).join(":"));
}

export const ids = { of, uuid5 };

/** The key when it fits RequestKey, else a stable shortened form. */
export function capKey(key: string): string {
  return key.length <= REQUEST_KEY_MAX ? key : `${key.slice(0, 150)}~${uuid5(key)}`;
}

/** `<function>.<op>:<requestId>[:<suffix>...]` */
export function requestKey(fn: string, op: string, requestId: string, ...suffix: Array<string | number>): string {
  return capKey([`${fn}.${op}`, requestId, ...suffix].join(":"));
}

export interface BoundIds {
  base: string;
  of: (...parts: unknown[]) => string;
  uuid5: (name: string, namespace?: string) => string;
  local: (key: string) => string;
  audit: (n: number) => string;
  notification: (eventKey: string, recipientUserId: string) => string;
  job: (eventKey?: string) => string;
}

export function bindIds(p: { fn: string; op: string; requestId: string }): BoundIds {
  const { fn, op, requestId } = p;
  return {
    base: requestKey(fn, op, requestId),
    of,
    uuid5,
    local: (key) => requestKey(fn, op, requestId, key),
    audit: (n) => requestKey(fn, op, requestId, "audit", n),
    notification: (eventKey, recipientUserId) => capKey(`notify:${eventKey}:${recipientUserId}`),
    job: (eventKey) => (eventKey ? capKey(`job:${eventKey}`) : requestKey(fn, op, requestId, "job")),
  };
}
