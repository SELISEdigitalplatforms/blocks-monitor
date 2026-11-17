// Shared seed resolution: SeedKey lookups, users, the insert-with-outcome helper and the time budget.
// SeedKey is NOT unique on Blocks (a unique index would break ordinary rows that leave it empty): a row is always looked up by
// SeedKey before it is inserted, a found row is reused ("existing") and never updated, and RequestKey (unique) catches a racing
// duplicate. A seed must never run twice concurrently.
import { f, v, type Row } from "../../../_lib";
import type { Filter } from "../../../_lib/filter";
import { invalidInput } from "../../../_lib/errors";
import { capKey } from "../../../_lib/ids";
import type { Validator } from "../../../_lib/validate";
import type { OpDeps } from "../../../_lib";
import { emailAllowed, parseAllowedEmailDomains, S1_SETTING_KEYS } from "../../../../src/domain/emailDomains";
import { SEED_KEY_PATTERN, SEED_LIMITS, seedRequestKey, seedSchema, type ResolvedUser } from "../../../../src/domain/seed";

/** The read method deps.gw and deps.svc share. */
export interface SeedReader {
  findAll(schema: string, q: { where: Filter; fields: readonly string[]; max?: number }): Promise<Row[]>;
}

export type SeedOutcome = "created" | "existing" | "skipped";

export interface SeedInsert {
  outcome: SeedOutcome;
  itemId: string | null;
  messageKey?: string;
  params?: Record<string, unknown>;
}

const str = (x: unknown): string => (typeof x === "string" ? x : "");

/** True while the call may still start a write (ctx.remainingMs() >= the 5 000 ms margin). */
export function budgetLeft(ctx: { remainingMs(): number }): boolean {
  return ctx.remainingMs() >= SEED_LIMITS.budgetMarginMs;
}

/** Runs `fn` over `items`, at most `size` at a time, keeping the order of the results. */
export async function inBatches<T, R>(items: readonly T[], size: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = [];
  for (let i = 0; i < items.length; i += size) out.push(...(await Promise.all(items.slice(i, i + size).map(fn))));
  return out;
}

/** SeedKey -> row (ItemId and SeedKey always included). At most 500 keys per read, every chunk in parallel. */
export async function rowsBySeedKey(
  reader: SeedReader,
  schema: string,
  seedKeys: readonly string[],
  fields: readonly string[] = [],
): Promise<Map<string, Row>> {
  const unique = [...new Set(seedKeys)];
  const chunks: string[][] = [];
  for (let i = 0; i < unique.length; i += SEED_LIMITS.keysPerRead) chunks.push(unique.slice(i, i + SEED_LIMITS.keysPerRead));
  const want = [...new Set(["ItemId", "SeedKey", ...fields])];
  const pages = await Promise.all(chunks.map((chunk) => reader.findAll(schema, { where: f.in("SeedKey", chunk), fields: want, max: 1000 })));
  const out = new Map<string, Row>();
  for (const rows of pages) for (const row of rows) if (!out.has(str(row.SeedKey))) out.set(str(row.SeedKey), row);
  return out;
}

/** Account by lower-cased email (active), checked against the platform's allowed domains; ids are never taken from the args. */
export async function resolveUsers(
  reader: SeedReader,
  users: Readonly<Record<string, string>>,
  fail: OpDeps["fail"],
): Promise<Record<string, ResolvedUser>> {
  const keys = Object.keys(users);
  if (keys.length === 0) return {};
  const emails = [...new Set(keys.map((k) => users[k].trim().toLowerCase()))];
  const [accounts, settings] = await Promise.all([
    reader.findAll("Account", { where: f.and(f.in("Email", emails), f.eq("Status", "active")), fields: ["ItemId", "UserId", "Email", "DisplayName"], max: 1000 }),
    reader.findAll("PlatformSetting", {
      where: f.in("Key", [S1_SETTING_KEYS.domains, S1_SETTING_KEYS.exceptions]),
      fields: ["ItemId", "Key", "Values"],
      max: 10,
    }),
  ]);
  const byEmail = new Map<string, Row>();
  for (const a of accounts) if (!byEmail.has(str(a.Email).toLowerCase())) byEmail.set(str(a.Email).toLowerCase(), a);
  const allowed = parseAllowedEmailDomains({
    domains: settings.find((s) => s.Key === S1_SETTING_KEYS.domains)?.Values,
    exceptions: settings.find((s) => s.Key === S1_SETTING_KEYS.exceptions)?.Values,
  });
  const out: Record<string, ResolvedUser> = {};
  for (const key of keys) {
    const email = users[key].trim().toLowerCase();
    const account = byEmail.get(email);
    if (!account || !str(account.UserId)) return fail("invalid_input", "seed.userUnknown", { user: key });
    if (!emailAllowed(email, allowed)) return fail("invalid_input", "seed.userDomain", { user: key });
    out[key] = { userId: str(account.UserId), email, displayName: str(account.DisplayName) || email };
  }
  return out;
}

/** The first unique tuple whose fields the row sets (the stamped WorkspaceId counts); the fields of the unique-index hit. */
function uniqueTuple(schema: string, row: Row): string[] {
  const set = (field: string): boolean => field === "WorkspaceId" || (row[field] !== undefined && row[field] !== null && row[field] !== "");
  return (seedSchema(schema)?.uniques ?? []).find((t) => t.every(set)) ?? [];
}

/**
 * Inserts one seeded row (SeedKey, IsExample where the schema has it, and the RequestKey `seed:<SeedKey>` are added here).
 * `{created: false}` (unique index hit) is resolved by re-reading the SeedKey: found -> existing; not found -> a person-made row
 * holds another unique tuple, so the row is skipped and never claimed.
 */
export async function insertSeeded(o: {
  schema: string;
  seedKey: string;
  row: Row;
  insert(row: Row, requestKey: string): Promise<{ created: boolean; itemId: string | null }>;
  reader: SeedReader;
}): Promise<SeedInsert> {
  const def = seedSchema(o.schema);
  const row: Row = { ...o.row, SeedKey: o.seedKey, ...(def?.hasIsExample ? { IsExample: true } : {}) };
  const res = await o.insert(row, capKey(seedRequestKey(o.seedKey)));
  if (res.created && res.itemId) return { outcome: "created", itemId: res.itemId };
  const back = (await rowsBySeedKey(o.reader, o.schema, [o.seedKey])).get(o.seedKey);
  if (back) return { outcome: "existing", itemId: str(back.ItemId) };
  return { outcome: "skipped", itemId: null, messageKey: "seed.uniqueConflict", params: { fields: uniqueTuple(o.schema, row) } };
}

/** Arg validators shared by the seed ops. */
const validator = <T>(parse: (raw: unknown, field: string) => T): Validator<T> => ({ kind: "mf.validator", parse });

/** `{<key>: <email>}`, at most 20; the keys follow the SeedKey pattern. */
export const usersArg: Validator<Record<string, string>> = validator((raw, field) => {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) throw invalidInput(field, "type");
  const keys = Object.keys(raw);
  if (keys.length > SEED_LIMITS.users) throw invalidInput(field, "max");
  const email = v.email();
  const out: Record<string, string> = {};
  for (const key of keys) {
    if (!SEED_KEY_PATTERN.test(key)) throw invalidInput(`${field}.${key}`, "pattern");
    out[key] = email.parse((raw as Record<string, unknown>)[key], `${field}.${key}`);
  }
  return out;
});

/** A plain object; its fields are checked by parseSeedRecord(s). */
export const recordArg: Validator<Record<string, unknown>> = validator((raw, field) => {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) throw invalidInput(field, "type");
  return raw as Record<string, unknown>;
});
