// POST /api/data: every browser data READ, answered from the local store in the format the web client expects
// ({ ok, results: [{ ok, items, totalCount, pageNo, pageSize, hasNextPage }] }). The same request rules as the hosted
// route (same origin, the session cookie, the forced-password-change gate, 1-40 reads, the filter compile of
// src/domain/gatewayFilter.ts), but any schema and field name is accepted, so a new field needs no catalogue change.
// Rows are filtered by the read policy of blocks/data/policies.json for the signed-in person, the way the hosted gateway
// applies row policies with the person's own token: "acl" (ReaderIds holds the person), "own:<Field>", "super-admin".
import fs from "node:fs";
import path from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";
import { HOST_NOT_CONFIGURED, MAX_INPUT_BYTES, defaultMessageKey, statusOf } from "../../src/domain/fnContract.ts";
import { validateDataRequest, type S1Catalog } from "../fnHost/dataRead.ts";
import { BODY_TIMEOUT_MS, SECURITY_HEADERS, readBody, type PasswordGateLike, type SessionLookup } from "../fnHost/middleware.ts";
import type { DatabaseSync } from "node:sqlite";
import { getUser } from "./iam/store.ts";
import { pageOf, projectRow, selectRows, sortKeysOf, sortRows } from "./query.ts";
import type { Row, RowStore } from "./rowStore.ts";

const FIELD = /^(ItemId|[A-Z][A-Za-z0-9]{0,63})$/;
const SCHEMA = /^[A-Z][A-Za-z0-9]{0,63}$/;
const SUPER_ADMIN = "mf-super-admin";
const DEFAULT_READ = ["acl", "super-admin"];

/** Accepts every well-formed schema and field name. */
export const PERMISSIVE_CATALOG = {
  get: (schema: string) => (SCHEMA.test(schema) ? { has: (f: string) => FIELD.test(f) } : undefined),
} as unknown as S1Catalog;

/** schema -> read rules (the browser's own rights; "service" never applies to a person). */
export function loadReadPolicies(root: string): Map<string, string[]> {
  const doc = JSON.parse(fs.readFileSync(path.join(root, "blocks", "data", "policies.json"), "utf8")) as { schemas?: { schemaName: string; read?: string[] }[] };
  return new Map((doc.schemas ?? []).map((s) => [s.schemaName, (s.read ?? []).filter((r) => r !== "service")]));
}

export function visibleTo(rules: readonly string[], person: { userId: string; roles: readonly string[] }): ((row: Row) => boolean) | "all" {
  if (rules.includes("super-admin") && person.roles.includes(SUPER_ADMIN)) return "all";
  const acl = rules.includes("acl");
  const own = rules.filter((r) => r.startsWith("own:")).map((r) => r.slice(4));
  return (row) => {
    if (acl && Array.isArray(row.ReaderIds) && row.ReaderIds.includes(person.userId)) return true;
    for (const f of own) if (row[f] === person.userId) return true;
    return false;
  };
}

function header(req: IncomingMessage, name: string): string {
  const v = req.headers[name];
  return (Array.isArray(v) ? v[0] : v) ?? "";
}

export function createLocalDataRoute(deps: {
  origin: string;
  expectedHost: string;
  session(req: IncomingMessage, res: ServerResponse): Promise<SessionLookup>;
  passwordGate?: PasswordGateLike;
  db: DatabaseSync;
  store: RowStore;
  policies: () => Map<string, string[]>;
  log?(line: string): void;
}) {
  return async function dataRoute(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const started = Date.now();
    let reads = 0;
    const send = (status: number, body: unknown, extra?: Record<string, string>) => {
      res.statusCode = status;
      for (const [k, v] of Object.entries(SECURITY_HEADERS)) res.setHeader(k, v);
      for (const [k, v] of Object.entries(extra ?? {})) res.setHeader(k, v);
      res.end(JSON.stringify(body));
      try {
        deps.log?.(`[data] ${status} reads=${reads} ${Date.now() - started}ms`);
      } catch {
        /* logging never breaks a request */
      }
    };
    const refuse = (code: string, o: { status?: number; index?: number | null } = {}) =>
      send(o.status ?? (code === HOST_NOT_CONFIGURED ? 503 : statusOf(code as never)), {
        ok: false,
        error: { code, messageKey: defaultMessageKey(code as never) },
        ...(o.index !== undefined ? { index: o.index } : {}),
        serverNow: new Date().toISOString(),
      });
    try {
      if (req.method !== "POST") return refuse("invalid_input", { status: 405 });
      if ((req.url ?? "").split("?")[0].replace(/^\/+|\/+$/g, "") !== "") return refuse("not_found");
      if ((header(req, "host") || header(req, ":authority")) !== deps.expectedHost) return refuse("forbidden");
      const site = header(req, "sec-fetch-site");
      if (site && site !== "same-origin") return refuse("forbidden");
      let origin = header(req, "origin");
      if (!origin) {
        try {
          origin = new URL(header(req, "referer")).origin;
        } catch {
          origin = "";
        }
      }
      if (origin !== deps.origin) return refuse("forbidden");
      if (!/^application\/json\s*(;|$)/i.test(header(req, "content-type"))) return refuse("invalid_input");
      const body = await readBody(req, MAX_INPUT_BYTES, BODY_TIMEOUT_MS);
      if (body === "too_large") return refuse("too_large");
      if (body === "timeout") return refuse("timeout", { status: 408 });
      let parsed: unknown;
      try {
        parsed = JSON.parse(body.toString("utf8"));
      } catch {
        return refuse("invalid_input", { index: null });
      }

      const lookup = await deps.session(req, res);
      if (lookup.state === "unavailable") return refuse("unavailable", { status: 503 });
      if (lookup.state !== "ok") return refuse("unauthenticated");
      if (deps.passwordGate && (await deps.passwordGate.check(lookup.userId, lookup.accessToken)) === "blocked") {
        return send(403, { ok: false, error: { code: "must_change_password", messageKey: "auth.mustChangePassword" }, serverNow: new Date().toISOString() });
      }
      const person = getUser(deps.db, lookup.userId);
      if (!person || !person.active) return refuse("unauthenticated");

      const checked = validateDataRequest(parsed, PERMISSIVE_CATALOG);
      if (!checked.ok) return refuse("invalid_input", { index: checked.index });
      reads = checked.reads.length;
      const policies = deps.policies();
      const results = checked.reads.map((read) => {
        const { pageNo, pageSize } = read;
        if (read.matchesNothing) return { ok: true, items: [], totalCount: 0, pageNo, pageSize, hasNextPage: false };
        const input = read.member.input as { filter?: string; sort?: string };
        const can = visibleTo(policies.get(read.schema) ?? DEFAULT_READ, person);
        const all = deps.store.rows(read.schema);
        const visible = can === "all" ? all : all.filter(can);
        const hits = sortRows(selectRows(visible, input.filter ? (JSON.parse(input.filter) as Record<string, unknown>) : undefined), sortKeysOf(input.sort));
        const items = pageOf(hits, pageNo, pageSize).map((r) => projectRow(r, read.fields));
        return { ok: true, items, totalCount: hits.length, pageNo, pageSize, hasNextPage: pageNo * pageSize < hits.length };
      });
      send(200, { ok: true, results });
    } catch {
      if (!res.writableEnded && !res.headersSent) refuse("internal");
    }
  };
}
