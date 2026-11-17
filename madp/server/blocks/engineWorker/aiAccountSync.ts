// The AI account pool (server/local/engine/ai/accountPool.ts) and its AiAccount rows, once a minute:
//
//   in    people's settings from the rows of this host (Status active|standby|disabled, Priority) and the rotation
//         threshold (PlatformSetting engine.rotateAtPercent, default 99) go into the pool
//   out   one row per account the host has (Label, Provider, HostId; never a credential, a folder or a token), with
//         what the engine measured: Status "cooling" while it rests an account, Usage5hPercent, Usage7dPercent,
//         ResetsAt, LastUsedAt, OnHost; written only when something changed
//
// A row whose account is gone from the host stays (OnHost false), so its history and note are kept. Failures are only
// logged; the pool works on what it last knew. A tenant without the AiAccount schema is left alone.
import { f } from "../../../functions/_lib/filter";
import type { RawGateway, Row } from "../../../functions/_lib/gateway";
import { ROTATE_SETTING_KEY, isAiStatus, parseRotateAt } from "../../../src/domain/platformEngine";
import { effectiveStatus, type AccountPool, type PoolAccount } from "../../local/engine/ai/accountPool.ts";

export const AI_SYNC_MS = 60_000;
export const AI_ACCOUNT_FIELDS = [
  "ItemId", "Label", "Provider", "Status", "Usage5hPercent", "Usage7dPercent", "ResetsAt", "LastUsedAt", "Priority", "Note", "HostId", "OnHost",
] as const;

const str = (v: unknown): string => (typeof v === "string" ? v : "");
const iso = (ms: number | null): string => (ms && Number.isFinite(ms) ? new Date(ms).toISOString() : "");
const num = (v: number | null): number => (v === null ? -1 : v);

/** People's settings from the rows: the row's Status unless the engine set it (cooling counts as active). */
export function settingsFromRows(rows: readonly Row[]): Map<string, { setting: PoolAccount["setting"]; priority: number }> {
  const out = new Map<string, { setting: PoolAccount["setting"]; priority: number }>();
  for (const r of rows) {
    const status = str(r.Status);
    const setting: PoolAccount["setting"] = status === "standby" || status === "disabled" ? status : "active";
    const priority = typeof r.Priority === "number" && Number.isFinite(r.Priority) ? r.Priority : 100;
    out.set(str(r.Label), { setting, priority });
  }
  return out;
}

/** The fields of an account's row that differ from what the pool knows now (empty: nothing to write). */
export function rowPatch(row: Row | null, a: PoolAccount, now: number, rotateAtPercent: number): Row {
  const want: Row = {
    Provider: a.provider,
    Status: effectiveStatus(a, now, rotateAtPercent),
    // -1: not measured yet (the gateway ignores null)
    Usage5hPercent: num(a.usage5h),
    Usage7dPercent: num(a.usage7d),
    ResetsAt: iso(a.coolingUntil && a.coolingUntil > now ? a.coolingUntil : a.resetsAt),
    LastUsedAt: iso(a.lastUsedAt),
    OnHost: true,
  };
  if (!row) return want;
  const patch: Row = {};
  for (const [k, v] of Object.entries(want)) {
    // a measurement the pool lost (a restart) never wipes the row's last one
    if ((k === "Usage5hPercent" || k === "Usage7dPercent") && v === -1) continue;
    if ((k === "ResetsAt" || k === "LastUsedAt") && v === "") continue;
    if (k === "Status" && isAiStatus(row.Status) && row.Status !== "cooling" && row.Status !== "active" && v !== "disabled") continue;
    if (row[k] !== v) patch[k] = v;
  }
  return patch;
}

export interface AiAccountSync {
  tick(): Promise<void>;
  start(): void;
  stop(): void;
}

export function createAiAccountSync(o: {
  raw: RawGateway;
  pool: AccountPool;
  hostId: string;
  has(schema: string): boolean;
  log(line: string): void;
  now?: () => number;
}): AiAccountSync {
  const now = o.now ?? Date.now;
  let timer: ReturnType<typeof setInterval> | null = null;
  let running = false;
  let failing = false;

  async function tick(): Promise<void> {
    if (running) return;
    running = true;
    try {
      o.pool.rediscover();
      if (!o.has("AiAccount")) return;
      const [rows, setting] = await Promise.all([
        o.raw.findAll("AiAccount", { where: f.eq("HostId", o.hostId), fields: [...AI_ACCOUNT_FIELDS], max: 200 }),
        o.has("PlatformSetting")
          ? o.raw.find("PlatformSetting", { where: f.eq("Key", ROTATE_SETTING_KEY), fields: ["ItemId", "Values", "ValueJson"], page: 1, pageSize: 1 }).catch(() => null)
          : Promise.resolve(null),
      ]);
      const s = setting?.items[0];
      const rotateAtPercent = parseRotateAt(s ? (str(s.ValueJson) || (Array.isArray(s.Values) ? s.Values : "")) : "");
      o.pool.configure({ settings: settingsFromRows(rows), rotateAtPercent });
      await o.pool.probe();
      const t = now();
      const byLabel = new Map(rows.map((r) => [str(r.Label), r]));
      const accounts = o.pool.accounts();
      for (const a of accounts) {
        const row = byLabel.get(a.label) ?? null;
        const patch = rowPatch(row, a, t, rotateAtPercent);
        if (Object.keys(patch).length === 0) continue;
        if (row) await o.raw.update("AiAccount", str(row.ItemId), patch);
        else {
          await o.raw.insert("AiAccount", {
            Label: a.label, HostId: o.hostId, Priority: 100, Note: "", ...patch,
            RequestKey: `ai-account:${o.hostId}:${a.label}`,
          });
        }
      }
      const present = new Set(accounts.map((a) => a.label));
      for (const r of rows) if (!present.has(str(r.Label)) && r.OnHost !== false) await o.raw.update("AiAccount", str(r.ItemId), { OnHost: false });
      if (failing) o.log("[engine] AI accounts: rows written again");
      failing = false;
    } catch (e) {
      if (!failing) o.log(`[engine] AI accounts: the rows could not be read or written (${e instanceof Error ? e.message.slice(0, 160) : "error"}); the pool goes on with what it knows`);
      failing = true;
    } finally {
      running = false;
    }
  }

  return {
    tick,
    start() {
      if (timer) return;
      void tick();
      timer = setInterval(() => void tick(), AI_SYNC_MS);
      timer.unref?.();
    },
    stop() {
      if (timer) clearInterval(timer);
      timer = null;
    },
  };
}
