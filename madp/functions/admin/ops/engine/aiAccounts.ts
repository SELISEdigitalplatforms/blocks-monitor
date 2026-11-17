// platform.ai.accounts.list (platform.engine.view or platform.ai.manage): the AI accounts the engine hosts have, with
// what the engine measured, and the rotation threshold (PlatformSetting engine.rotateAtPercent, default 99).
// platform.ai.accounts.save (platform.ai.manage): people's settings of the accounts (Status active|standby|disabled,
// Priority, Note) and the rotation threshold. Never a credential: accounts are added on the engine host itself
// (frontend/README.md "AI account pool"); the rows hold labels and numbers only, and a note that looks like a key or
// token is refused.
import { OpError, defineOp, f, v, type Row } from "../../../_lib";
import type { ScopedGateway } from "../../../_lib/types";
import {
  AI_ACCOUNT_SETTABLE, AI_MANAGE_PERMISSION, AI_NOTE_MAX, DEFAULT_ROTATE_AT_PERCENT, ENGINE_VIEW_PERMISSION, MIN_ROTATE_AT_PERCENT,
  ROTATE_SETTING_KEY, isAiProvider, isAiStatus, parseRotateAt, percentOrNull,
  type AiAccountStatus, type AiAccountView, type AiAccountsAnswer,
} from "../../../../src/domain/platformEngine";

export const AI_ACCOUNT_FIELDS = [
  "ItemId", "Label", "Provider", "Status", "Usage5hPercent", "Usage7dPercent", "ResetsAt", "LastUsedAt", "Priority", "Note", "HostId", "OnHost",
] as const;
const SETTING_FIELDS = ["ItemId", "Key", "Values", "ValueJson"] as const;
const MAX_ACCOUNTS = 200;
/** What a note must never hold: provider keys and tokens (the engine's privacy guard knows the same shapes). */
const SECRET_LIKE = /\bsk-ant-|\bsk-(?:proj-)?[A-Za-z0-9_-]{20,}|\beyJ[A-Za-z0-9_-]{10,}\.|\bgh[pousr]_[A-Za-z0-9]{20,}|\bBearer\s+\S{16,}/i;

const str = (x: unknown): string => (typeof x === "string" ? x : "");

export function accountView(r: Row): AiAccountView {
  const provider = isAiProvider(r.Provider) ? r.Provider : "claude-subscription";
  return {
    itemId: str(r.ItemId),
    label: str(r.Label),
    provider,
    status: isAiStatus(r.Status) ? r.Status : "active",
    usage5hPercent: percentOrNull(r.Usage5hPercent),
    usage7dPercent: percentOrNull(r.Usage7dPercent),
    resetsAt: str(r.ResetsAt),
    lastUsedAt: str(r.LastUsedAt),
    priority: typeof r.Priority === "number" && Number.isFinite(r.Priority) ? r.Priority : 100,
    note: str(r.Note),
    hostId: str(r.HostId),
  };
}

const missingSchema = (e: unknown): boolean => /schema|unknown type|cannot query|not found|Unknown/i.test(e instanceof Error ? e.message : String(e));

async function readAccounts(svc: ScopedGateway): Promise<Row[]> {
  try {
    return await svc.findAll("AiAccount", {
      where: f.range("RequestKey", { gte: "ai-account:", lte: "ai-account:~" }),
      fields: [...AI_ACCOUNT_FIELDS],
      max: MAX_ACCOUNTS,
    });
  } catch (e) {
    if (missingSchema(e)) return [];
    throw e;
  }
}

async function readSetting(svc: ScopedGateway): Promise<Row | null> {
  const res = await svc.find("PlatformSetting", { where: f.eq("Key", ROTATE_SETTING_KEY), fields: [...SETTING_FIELDS], page: 1, pageSize: 1 });
  return res.items[0] ?? null;
}

const settingValue = (row: Row | null): number => (row ? parseRotateAt(str(row.ValueJson) || row.Values) : DEFAULT_ROTATE_AT_PERCENT);

function answer(rows: Row[], setting: Row | null): AiAccountsAnswer {
  const accounts = rows.map(accountView).filter((a) => a.label !== "");
  // subscriptions first, then the API key; lower priority number first; then by label
  accounts.sort((a, b) => (a.provider === b.provider ? 0 : a.provider === "anthropic-api" ? 1 : -1) || a.priority - b.priority || (a.label < b.label ? -1 : a.label > b.label ? 1 : 0));
  return { accounts, rotateAtPercent: settingValue(setting), rotateIsDefault: setting === null };
}

export const platformAiAccountsList = defineOp({
  op: "platform.ai.accounts.list",
  kind: "view",
  scope: "platform",
  permission: [ENGINE_VIEW_PERMISSION, AI_MANAGE_PERMISSION],
  args: v.object({}),
  async handler(_ctx, _args, deps): Promise<AiAccountsAnswer> {
    const svc = deps.svc;
    if (!svc) throw new OpError("internal");
    const [rows, setting] = await Promise.all([readAccounts(svc), readSetting(svc)]);
    return answer(rows, setting);
  },
});

interface SaveArgs {
  changes?: { itemId: string; status?: string; priority?: number; note?: string }[];
  rotateAtPercent?: number;
}

const SAVE_ARGS = v.object({
  changes: v.optional(
    v.array(
      v.object({
        itemId: v.id(),
        status: v.optional(v.string({ max: 20 })),
        priority: v.optional(v.int({ min: 0, max: 1000 })),
        note: v.optional(v.string({ max: AI_NOTE_MAX })),
      }),
      { max: 50 },
    ),
  ),
  rotateAtPercent: v.optional(v.int({ min: MIN_ROTATE_AT_PERCENT, max: 100 })),
});

function parseSave(raw: unknown): SaveArgs {
  const a = SAVE_ARGS.parse(raw, "") as SaveArgs;
  for (const c of a.changes ?? []) {
    if (c.status !== undefined && !(AI_ACCOUNT_SETTABLE as readonly string[]).includes(c.status)) {
      throw new OpError("invalid_input", undefined, { field: "status", rule: "enum" });
    }
    if (c.note !== undefined && SECRET_LIKE.test(c.note)) {
      throw new OpError("invalid_input", undefined, { field: "note", rule: "noCredentials" });
    }
  }
  if ((a.changes ?? []).length === 0 && a.rotateAtPercent === undefined) {
    throw new OpError("invalid_input", undefined, { field: "changes", rule: "required" });
  }
  return a;
}

/** Control characters out, spaces collapsed: a note is one plain line. */
const cleanNote = (s: string): string => s.replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim();

export const platformAiAccountsSave = defineOp({
  op: "platform.ai.accounts.save",
  kind: "command",
  scope: "platform",
  permission: AI_MANAGE_PERMISSION,
  args: parseSave,
  async handler(ctx, args, deps): Promise<AiAccountsAnswer> {
    const svc = deps.svc;
    if (!svc) throw new OpError("internal");
    const [rows, setting] = await Promise.all([readAccounts(svc), readSetting(svc)]);
    const byId = new Map(rows.map((r) => [str(r.ItemId), r]));
    for (const c of args.changes ?? []) if (!byId.has(c.itemId)) throw new OpError("not_found");

    const writes: Promise<unknown>[] = [];
    for (const c of args.changes ?? []) {
      const row = byId.get(c.itemId)!;
      const patch: Row = {};
      if (c.status !== undefined && c.status !== row.Status) patch.Status = c.status as AiAccountStatus;
      if (c.priority !== undefined && c.priority !== row.Priority) patch.Priority = c.priority;
      const note = c.note !== undefined ? cleanNote(c.note) : undefined;
      if (note !== undefined && note !== str(row.Note)) patch.Note = note;
      if (Object.keys(patch).length === 0) continue;
      writes.push(svc.update("AiAccount", c.itemId, patch));
      Object.assign(row, patch);
      deps.audit({
        targetType: "ai-account",
        targetId: c.itemId,
        details: {
          label: str(row.Label),
          ...(patch.Status !== undefined ? { status: patch.Status } : {}),
          ...(patch.Priority !== undefined ? { priority: patch.Priority } : {}),
          ...(patch.Note !== undefined ? { noteChanged: true } : {}),
        },
      });
    }

    let nextSetting = setting;
    if (args.rotateAtPercent !== undefined) {
      const before = settingValue(setting);
      const value = String(args.rotateAtPercent);
      if (setting) {
        if (str(setting.ValueJson) !== value) {
          writes.push(svc.update("PlatformSetting", str(setting.ItemId), { Values: [value], ValueJson: value, UpdatedByUserId: ctx.caller.userId }));
        }
        nextSetting = { ...setting, Values: [value], ValueJson: value };
      } else {
        writes.push(
          svc.insert(
            "PlatformSetting",
            {
              Key: ROTATE_SETTING_KEY,
              Values: [value],
              ValueJson: value,
              Description: "The engine rests an AI account at this share of its limit and moves its work to the account with the most headroom.",
              ReaderIds: [],
              CreatedByUserId: ctx.caller.userId,
              UpdatedByUserId: ctx.caller.userId,
            },
            { requestKey: `setting:${ROTATE_SETTING_KEY}` },
          ),
        );
        nextSetting = { ItemId: "", Key: ROTATE_SETTING_KEY, Values: [value], ValueJson: value };
      }
      if (before !== args.rotateAtPercent || !setting) {
        deps.audit({ targetType: "platform-setting", targetId: ROTATE_SETTING_KEY, details: { before, after: args.rotateAtPercent } });
      }
    }
    await Promise.all(writes);
    return answer(rows, nextSetting);
  },
});
