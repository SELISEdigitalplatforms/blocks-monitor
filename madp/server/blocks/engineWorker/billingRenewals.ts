// The monthly renewal of paid plans, run by the engine worker (as mf-service) once an hour: the same rules as
// billing.renewals.run (functions/billing/ops/renewal.ts): a period a code still pays is renewed with the month's
// credit and a receipt; any other is marked past due with a plain notice; a cancelled plan ends on its renewal day.
// Idempotent per period (RequestKey renewal:<workspace>:<period start>), so two hosts or a restart never grant twice.
// Off with MF_BILLING_RENEWALS=off; skipped while the tenant has no Subscription or Payment schema.
import { f, type Filter as LibFilter } from "../../../functions/_lib/filter";
import type { RawGateway, Row } from "../../../functions/_lib/gateway";
import type { Filter, Gateway } from "../../../functions/workspace/ops/_shared/ports";
import { DuplicateError } from "../../../functions/workspace/ops/_shared/ports";
import { readPaymentSettings } from "../../../functions/billing/ops/checkout";
import { providerOf } from "../../../functions/billing/ops/providers";
import { renewDue, type RenewalReport } from "../../../functions/billing/ops/renewal";
import { readPlans } from "../../../functions/billing/ops/shared";

/** How often the renewal pass runs. */
export const RENEWAL_CHECK_MS = 60 * 60_000;

export function renewalsEnabled(env: Record<string, string | undefined>): boolean {
  return String(env.MF_BILLING_RENEWALS ?? "").trim().toLowerCase() !== "off";
}

/** The ways an empty filter is read per schema (the gateway has no "every row" filter). */
const EVERY_ROW: Readonly<Record<string, LibFilter[]>> = {
  Plan: [f.eq("Active", true), f.eq("Active", false)],
};

/** The port filter as one or more gateway filters whose rows are merged. */
function libFilters(schema: string, filter: Filter): LibFilter[] {
  const entries = Object.entries(filter);
  if (!entries.length) {
    const every = EVERY_ROW[schema];
    if (!every) throw new TypeError(`no empty filter for ${schema}`);
    return every;
  }
  const parts: LibFilter[] = [];
  let alternatives: LibFilter[] | null = null;
  for (const [field, value] of entries) {
    if (typeof value === "object" && value !== null) {
      if ("in" in value) {
        const list = [...value.in];
        if (!list.length) return [];
        if (list.every((x) => typeof x !== "boolean")) parts.push(f.in(field, list as (string | number)[]));
        else alternatives = list.map((x) => f.eq(field, x));
      } else if ("gte" in value || "lte" in value) {
        parts.push(f.range(field, value as { gte?: string; lte?: string }));
      } else throw new TypeError(`unsupported filter on ${field}`);
    } else parts.push(f.eq(field, value));
  }
  const base = parts.length === 1 ? parts[0]! : parts.length ? f.and(...parts) : null;
  if (!alternatives) return base ? [base] : [];
  return alternatives.map((a) => (base ? f.and(base, a) : a));
}

/** The handlers' gateway port over the worker's raw gateway (the reads and writes the renewal needs). */
export function portGateway(raw: RawGateway): Pick<Gateway, "listAll" | "insertOnce" | "update"> {
  return {
    async listAll<T>(schema: string, q: { filter: Filter; fields: readonly string[]; maxItems?: number }) {
      const filters = libFilters(schema, q.filter);
      const batches = await Promise.all(filters.map((where) => raw.findAll(schema, { where, fields: [...q.fields], max: q.maxItems ?? 1000 })));
      return batches.flat() as T[];
    },
    async insertOnce<T>(schema: string, row: Record<string, unknown>, onceKey: string) {
      const res = await raw.insert(schema, { ...row, RequestKey: onceKey });
      if (res.created && res.itemId) return { item: { ...row, ItemId: res.itemId } as T & { ItemId: string }, created: true };
      if (!res.itemId) throw new DuplicateError();
      const back = await raw.get(schema, res.itemId, [...new Set(["ItemId", ...Object.keys(row)])]);
      return { item: { ...(back ?? row), ItemId: res.itemId } as T & { ItemId: string }, created: res.created };
    },
    async update(schema: string, itemId: string, set: Record<string, unknown>) {
      await raw.update(schema, itemId, set as Row);
    },
  };
}

/** One renewal pass. */
export async function runBillingRenewals(raw: RawGateway, o: { now(): Date; by?: string; env?: Record<string, string | undefined> }): Promise<RenewalReport> {
  const gateway = portGateway(raw);
  const [{ plans }, settings] = await Promise.all([readPlans(gateway), readPaymentSettings(gateway)]);
  const provider = providerOf(settings.provider, undefined, o.env ?? process.env).status();
  return renewDue({ gateway, nowIso: o.now().toISOString(), plans, providerConnected: settings.provider === "blocks" && provider.connected, by: o.by ?? "mf-service" });
}
