// What the agents' work cost: every official lane prints one usage line when it ends ("tokens: N (in … / out … /
// cache-read … / cache-write …), cost $X, model(s) …", MADP/orchestrator/primitives/quick_ops.py usage_line). runLane
// hands the lane's output here; the job's EngineJob.UsageJson gets the lane added, and the job's one usage CreditEntry
// (RequestKey usage:<job id>) is written or brought up to the new total: measured cost x billing.priceFactor, in cents.
// The same writer serves the backfill (scripts/backfill-usage.mjs) for jobs that ran before this was recorded.
import type { RawGateway, Row } from "../../../functions/_lib/gateway";
import { f } from "../../../functions/_lib/filter";
import {
  DEFAULT_PRICE_FACTOR,
  EMPTY_USAGE,
  MAX_PRICE_FACTOR,
  SETTING_PRICE_FACTOR,
  addUsage,
  centsToUsd,
  parseJobUsage,
  parseLaneUsage,
  settingNumber,
  usageChargeCents,
  type JobUsage,
} from "../../../src/domain/billing";

const s = (v: unknown): string => (typeof v === "string" ? v : "");

export const usageEntryKey = (jobId: string): string => `usage:${jobId}`;

export async function priceFactorOf(gateway: Pick<RawGateway, "findAll">): Promise<number> {
  try {
    const rows = await gateway.findAll("PlatformSetting", { where: f.eq("Key", SETTING_PRICE_FACTOR), fields: ["Key", "ValueJson"], max: 5 });
    return settingNumber(rows[0]?.ValueJson, DEFAULT_PRICE_FACTOR, { min: 0.000001, max: MAX_PRICE_FACTOR });
  } catch {
    return DEFAULT_PRICE_FACTOR;
  }
}

/** The CreditEntry row of a job's usage (negative amount; no row when nothing was spent). */
export function usageEntryRow(job: Row, usage: JobUsage, priceFactor: number, at: string): Row | null {
  const cents = usageChargeCents(usage.costUsd, priceFactor);
  const jobId = s(job.ItemId);
  const workspaceId = s(job.WorkspaceId);
  if (!jobId || !workspaceId || (cents === 0 && usage.tokens.total === 0)) return null;
  const by = s(job.RequestedByUserId) || s(job.CreatedByUserId);
  return {
    WorkspaceId: workspaceId,
    UserId: by,
    ProjectId: s(job.ProjectId),
    JobId: jobId,
    Kind: "usage",
    AmountUsd: centsToUsd(-cents),
    AmountCents: -cents,
    Tokens: usage.tokens.total,
    Note: s(job.Kind),
    At: at,
    CouponCode: "",
    PlanKey: "",
    DetailJson: JSON.stringify({ ...usage, priceFactor }),
    RequestKey: usageEntryKey(jobId),
    CreatedByUserId: by,
    UpdatedByUserId: by,
  };
}

/** Writes the job's one usage entry, or brings the existing one up to `usage` (idempotent on the job id). */
export async function chargeJobUsage(
  gateway: Pick<RawGateway, "insert" | "update" | "findAll">,
  job: Row,
  usage: JobUsage,
  at: string,
  priceFactor?: number,
): Promise<{ written: "created" | "updated" | "none"; cents: number }> {
  const factor = priceFactor ?? (await priceFactorOf(gateway));
  const row = usageEntryRow(job, usage, factor, at);
  if (!row) return { written: "none", cents: 0 };
  const res = await gateway.insert("CreditEntry", row);
  if (res.created) return { written: "created", cents: -Number(row.AmountCents) };
  if (!res.itemId) throw new Error(`the usage entry of job ${s(job.ItemId)} was not stored`);
  await gateway.update("CreditEntry", res.itemId, {
    AmountUsd: row.AmountUsd, AmountCents: row.AmountCents, Tokens: row.Tokens, DetailJson: row.DetailJson, At: at,
  });
  return { written: "updated", cents: -Number(row.AmountCents) };
}

export const USAGE_JOB_FIELDS = ["ItemId", "Kind", "WorkspaceId", "ProjectId", "RequestedByUserId", "CreatedByUserId", "UsageJson"] as const;

/**
 * Adds one lane run's usage (parsed from its output) to the job: EngineJob.UsageJson and the job's usage entry.
 * Null when the text has no usage line (the lane stopped before its summary).
 */
export async function recordLaneUsage(
  gateway: Pick<RawGateway, "get" | "insert" | "update" | "findAll">,
  jobId: string,
  text: string,
  now: string,
): Promise<JobUsage | null> {
  const lane = parseLaneUsage(text);
  if (!lane) return null;
  const job = await gateway.get("EngineJob", jobId, USAGE_JOB_FIELDS);
  if (!job) return null;
  const next = addUsage(parseJobUsage(job.UsageJson) ?? EMPTY_USAGE, lane);
  await gateway.update("EngineJob", jobId, { UsageJson: JSON.stringify(next) });
  await chargeJobUsage(gateway, { ...job, ItemId: jobId }, next, now);
  return next;
}
