// signup.settings.get / signup.settings.save: PlatformSetting auth.signup, "open" (anyone may create an account at
// /sign-up) or "invite-only" (people are invited; the sign-up page explains how to get access). Default "open".
// get: platform.settings.manage or platform.users.view; save: platform.settings.manage, audited with before and after.
import { DEFAULT_SIGNUP_MODE, isSignupMode, signupModeOf, SIGNUP_SETTING_KEY, type SignupMode } from "../../../../src/domain/signup";
import { audit, fail, ok, openOp, readArgs } from "../../../workspace/ops/_shared/core";
import type { OpAnswer, OpCtx, OpDeps } from "../../../workspace/ops/_shared/ports";
import { SCHEMA, type PlatformSettingRow } from "../../../workspace/ops/_shared/records";

const FIELDS = ["ItemId", "Key", "ValueJson"] as const;

export interface SignupSettings {
  mode: SignupMode;
  isDefault: boolean;
}

const readRow = (deps: OpDeps) => () =>
  deps.gateway.listAll<PlatformSettingRow & { ValueJson?: string }>(SCHEMA.platformSetting, { filter: { Key: SIGNUP_SETTING_KEY }, fields: FIELDS });

export async function signupSettingsGet(ctx: OpCtx, args: unknown, deps: OpDeps): Promise<OpAnswer<SignupSettings>> {
  const a = readArgs(args, {});
  if (!a.ok) return { ok: false, error: a.error };
  const open = await openOp(ctx, deps, {
    scope: "platform",
    platformPermission: ["platform.settings.manage", "platform.users.view"],
    extra: { rows: readRow(deps) },
  });
  if (!open.ok) return { ok: false, error: open.error };
  const row = (open.caller.extra.rows as { ValueJson?: string }[])[0];
  return ok({ mode: signupModeOf(row?.ValueJson), isDefault: !row });
}

export async function signupSettingsSave(ctx: OpCtx, args: unknown, deps: OpDeps): Promise<OpAnswer<SignupSettings>> {
  const a = readArgs(args, { mode: "string" });
  if (!a.ok) return { ok: false, error: a.error };
  if (!isSignupMode(a.value.mode)) return fail("invalid_input", "tenancy.invalidArgs", { keys: ["mode"] });
  const mode = a.value.mode;
  const open = await openOp(ctx, deps, { scope: "platform", platformPermission: "platform.settings.manage", extra: { rows: readRow(deps) } });
  if (!open.ok) return { ok: false, error: open.error };
  const { caller } = open;
  const row = (caller.extra.rows as (PlatformSettingRow & { ValueJson?: string })[])[0] ?? null;
  const before = row ? signupModeOf(row.ValueJson) : DEFAULT_SIGNUP_MODE;
  const valueJson = JSON.stringify(mode);
  if (row) {
    await deps.gateway.update(SCHEMA.platformSetting, row.ItemId, { ValueJson: valueJson, UpdatedByUserId: caller.userId });
  } else {
    const res = await deps.gateway.insertOnce<PlatformSettingRow>(
      SCHEMA.platformSetting,
      {
        Key: SIGNUP_SETTING_KEY, Values: [], ValueJson: valueJson, ReaderIds: [],
        Description: "Who may create an account: open (public sign-up) or invite-only.",
        CreatedByUserId: caller.userId, UpdatedByUserId: caller.userId,
      },
      `setting:${SIGNUP_SETTING_KEY}`,
    );
    if (!res.created) await deps.gateway.update(SCHEMA.platformSetting, res.item.ItemId, { ValueJson: valueJson, UpdatedByUserId: caller.userId });
  }
  await audit(deps, ctx, caller, { targetType: "platform-setting", targetId: SIGNUP_SETTING_KEY, details: { before, after: mode } });
  return ok({ mode, isDefault: false });
}
