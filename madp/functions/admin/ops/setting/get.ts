// setting.get: AllowedEmailDomains (platform.settings.manage or platform.users.view). Not audited.
import { parseAllowedEmailDomains, S1_SETTING_KEYS } from "../../../../src/domain/emailDomains";
import { fail, ok, openOp, readArgs } from "../../../workspace/ops/_shared/core";
import type { OpAnswer, OpCtx, OpDeps } from "../../../workspace/ops/_shared/ports";
import { PLATFORM_SETTING_FIELDS, SCHEMA, type PlatformSettingRow } from "../../../workspace/ops/_shared/records";

export async function settingGet(
  ctx: OpCtx,
  args: unknown,
  deps: OpDeps,
): Promise<OpAnswer<{ domains: string[]; exceptions: string[]; isDefault: boolean }>> {
  const a = readArgs(args, { key: "string" });
  if (!a.ok) return { ok: false, error: a.error };
  const open = await openOp(ctx, deps, {
    scope: "platform",
    platformPermission: ["platform.settings.manage", "platform.users.view"],
    extra: {
      rows: () => deps.gateway.listAll<PlatformSettingRow>(SCHEMA.platformSetting, { filter: {}, fields: PLATFORM_SETTING_FIELDS }),
    },
  });
  if (!open.ok) return { ok: false, error: open.error };
  if (a.value.key !== "AllowedEmailDomains") return fail("invalid_input", "tenancy.invalidArgs", { keys: ["key"] });
  const rows = open.caller.extra.rows as PlatformSettingRow[];
  const values = (key: string) => rows.find((r) => r.Key === key)?.Values ?? null;
  const hasRows = rows.some((r) => r.Key === S1_SETTING_KEYS.domains || r.Key === S1_SETTING_KEYS.exceptions);
  const parsed = parseAllowedEmailDomains({
    domains: values(S1_SETTING_KEYS.domains),
    exceptions: values(S1_SETTING_KEYS.exceptions),
  });
  return ok({ domains: parsed.domains, exceptions: parsed.exceptions, isDefault: !hasRows });
}
