// The paywall of the engine queue (src/domain/payments.ts paywallVerdict): with PlatformSetting billing.enforce on,
// a build, analysis or fix round (PAYWALLED_JOB_KINDS) starts only for an organization with credit left; organizations
// listed in billing.internalWorkspaceIds are never stopped. Off by default: then this is one settings read.
import { billingTotals } from "../../src/domain/billing";
import { PAYWALLED_JOB_KINDS, SETTING_ENFORCE, SETTING_INTERNAL_WORKSPACES, paywallVerdict, settingBool, settingList } from "../../src/domain/payments";
import { OpError } from "./errors";
import { f } from "./filter";
import type { RawGateway } from "./gateway";

export function isPaywalledKind(kind: string): boolean {
  return PAYWALLED_JOB_KINDS.includes(kind);
}

/** Throws OpError("limit_reached", "billing.paywall", { reason }) when the organization may not start paid work now. */
export async function assertPaywall(raw: Pick<RawGateway, "findAll">, workspaceId: string): Promise<void> {
  const settings = await raw.findAll("PlatformSetting", {
    where: f.in("Key", [SETTING_ENFORCE, SETTING_INTERNAL_WORKSPACES]),
    fields: ["Key", "ValueJson"],
    max: 5,
  });
  const value = (key: string) => settings.find((r) => r.Key === key)?.ValueJson;
  if (!settingBool(value(SETTING_ENFORCE), false)) return;
  const internal = settingList(value(SETTING_INTERNAL_WORKSPACES)).includes(workspaceId);
  if (internal) return;
  const entries = await raw.findAll("CreditEntry", {
    where: f.eq("WorkspaceId", workspaceId),
    fields: ["Kind", "AmountUsd", "AmountCents", "Tokens"],
    max: 5000,
  });
  const verdict = paywallVerdict({ enforce: true, internal: false, balanceCents: billingTotals(entries).balanceCents });
  if (!verdict.ok) throw new OpError("limit_reached", "billing.paywall", { reason: verdict.reason, workspaceId });
}
