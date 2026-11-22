// setting.save: AllowedEmailDomains (platform.settings.manage). Both rows and the reader restamp are written in one round.
import { checkSettingChange, parseAllowedEmailDomains, S1_SETTING_KEYS } from "../../../../src/domain/emailDomains";
import { MAX_AUDIT_DETAILS, audit, fail, failCheck, ok, openOp, readArgs } from "../../../workspace/ops/_shared/core";
import type { OpAnswer, OpCtx, OpDeps } from "../../../workspace/ops/_shared/ports";
import { activeAssignmentsRead, allRolesRead, allSettingsRead, platformReaders, stampPlatformReaders } from "../platformRole/assign";
import { SCHEMA, type PlatformRoleAssignmentRow, type PlatformRoleRow, type PlatformSettingRow } from "../../../workspace/ops/_shared/records";

type SettingLists = { domains: string[]; exceptions: string[] };

const ARRAY_DETAIL_KEYS = ["domainsBefore", "domainsAfter", "domainsAdded", "domainsRemoved", "exceptionDomainsAdded", "exceptionDomainsRemoved"] as const;

const diff = (from: string[], to: string[]): string[] => {
  const f = new Set(from);
  return to.filter((x) => !f.has(x));
};
const exceptionDomains = (list: string[]): string[] =>
  [...new Set(list.map((e) => e.slice(e.lastIndexOf("@") + 1).toLowerCase()).filter((_, i) => list[i].includes("@")))].sort();

// C10: the audit keeps counts and domains, never an exception address; it is fitted so core.audit never replaces it with {truncated:true}.
export function settingAuditDetails(before: SettingLists, next: SettingLists): Record<string, unknown> {
  const exBefore = new Set(before.exceptions);
  const exAfter = new Set(next.exceptions);
  const dBefore = exceptionDomains(before.exceptions);
  const dAfter = exceptionDomains(next.exceptions);
  const out: Record<string, unknown> = {
    domainsBefore: [...before.domains],
    domainsAfter: [...next.domains],
    domainsAdded: diff(before.domains, next.domains),
    domainsRemoved: diff(next.domains, before.domains),
    exceptionsBefore: before.exceptions.length,
    exceptionsAfter: next.exceptions.length,
    exceptionsAdded: [...exAfter].filter((x) => !exBefore.has(x)).length,
    exceptionsRemoved: [...exBefore].filter((x) => !exAfter.has(x)).length,
    exceptionDomainsAdded: diff(dBefore, dAfter),
    exceptionDomainsRemoved: diff(dAfter, dBefore),
  };
  const budget = MAX_AUDIT_DETAILS - 300;
  const omitted: Record<string, number> = {};
  const size = () => JSON.stringify({ ...out, ...omitted }).length;
  while (size() > budget) {
    let longest: (typeof ARRAY_DETAIL_KEYS)[number] | null = null;
    for (const f of ARRAY_DETAIL_KEYS) {
      const len = (out[f] as string[]).length;
      if (len > 0 && (longest === null || JSON.stringify(out[f]).length > JSON.stringify(out[longest]).length)) longest = f;
    }
    if (!longest) break;
    (out[longest] as string[]).pop();
    omitted[`${longest}Omitted`] = (omitted[`${longest}Omitted`] ?? 0) + 1;
  }
  return { ...out, ...omitted };
}

export async function settingSave(
  ctx: OpCtx,
  args: unknown,
  deps: OpDeps,
): Promise<OpAnswer<{ domains: string[]; exceptions: string[]; isDefault: boolean }>> {
  const a = readArgs(args, { key: "string", value: "object?" });
  if (!a.ok) return { ok: false, error: a.error };
  const raw = a.value.value;
  const list = (v: unknown): string[] | null =>
    Array.isArray(v) && v.every((x) => typeof x === "string") ? (v as string[]) : null;
  const domains = list(raw?.domains);
  const exceptions = list(raw?.exceptions);
  if (a.value.key !== "AllowedEmailDomains" || !domains || !exceptions) {
    return fail("invalid_input", "tenancy.invalidArgs", { keys: ["key", "value"] });
  }
  const open = await openOp(ctx, deps, {
    scope: "platform",
    platformPermission: "platform.settings.manage",
    extra: {
      settings: allSettingsRead(deps),
      // The platform restamp's reads share the first round; the settings do not change who holds a platform permission.
      active: activeAssignmentsRead(deps),
      roles: allRolesRead(deps),
    },
  });
  if (!open.ok) return { ok: false, error: open.error };
  const { caller } = open;
  const checked = checkSettingChange({ next: { domains, exceptions }, callerEmail: caller.email });
  if (!checked.ok) return failCheck(checked);
  const next = checked.value;

  const rows = caller.extra.settings as PlatformSettingRow[];
  const find = (key: string) => rows.find((r) => r.Key === key) ?? null;
  const before = parseAllowedEmailDomains({
    domains: find(S1_SETTING_KEYS.domains)?.Values ?? null,
    exceptions: find(S1_SETTING_KEYS.exceptions)?.Values ?? null,
  });
  const readerIds = platformReaders(caller.extra.active as PlatformRoleAssignmentRow[], caller.extra.roles as PlatformRoleRow[]);
  const write = async (s1Key: string, values: string[]) => {
    const existing = find(s1Key);
    if (existing) {
      await deps.gateway.update(SCHEMA.platformSetting, existing.ItemId, { Values: values, UpdatedByUserId: caller.userId });
    } else {
      await deps.gateway.insertOnce(
        SCHEMA.platformSetting,
        { Key: s1Key, Values: values, ValueJson: "", Description: "", ReaderIds: readerIds, CreatedByUserId: caller.userId, UpdatedByUserId: caller.userId },
        `setting:${s1Key}`,
      );
    }
  };
  await Promise.all([
    write(S1_SETTING_KEYS.exceptions, next.exceptions),
    write(S1_SETTING_KEYS.domains, next.domains),
    stampPlatformReaders(deps, readerIds, caller.extra),
  ]);
  await audit(deps, ctx, caller, {
    targetType: "platform-setting",
    targetId: S1_SETTING_KEYS.domains,
    details: settingAuditDetails(before, next),
  });
  return ok({ domains: next.domains, exceptions: next.exceptions, isDefault: false });
}
