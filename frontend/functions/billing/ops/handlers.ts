// The billing ops (functions/billing): plan catalogue, organization summary, coupons, purchase requests, adjustments
// and the usage report. Organization ops need membership of the workspace; administration needs platform.billing.manage
// (the report also platform.usage.view). Money is integer cents inside, USD in the answers.
import {
  ASSISTED,
  BILLING_MANAGE,
  COUPON_CODE,
  DEFAULT_PLANS,
  MAX_FEATURES,
  MAX_FEATURE_LENGTH,
  MAX_NOTE_LENGTH,
  MAX_PRICE_FACTOR,
  PURCHASE_STATUSES,
  SETTING_PRICE_FACTOR,
  SETTING_SIGNUP_CREDIT,
  USAGE_GROUPS,
  USAGE_VIEW,
  addMonth,
  billingTotals,
  centsToUsd,
  couponRefusal,
  entryCents,
  isUsdAmount,
  modelLabel,
  monthStart,
  newCouponCode,
  normalizeCouponCode,
  parseJobUsage,
  toCents,
  type BalanceRow,
  type BillingSettings,
  type BillingSummary,
  type CouponView,
  type CreditEntryView,
  type JobUsageEntry,
  type PlanView,
  type PurchaseView,
  type UsageGroup,
  type UsageReport,
  type UsageRow,
} from "../../../src/domain/billing";
import { couponTermsOf, couponTermsProblems } from "../../../src/domain/payments";
import { BILLING_SOURCES, SETTING_SOURCE, discountIdOf, type BillingSource } from "../../../src/domain/utilitiesBilling";
import {
  findDiscount,
  readCatalogue,
  readSource,
  saveCouponInUtilities,
  savePlanInUtilities,
  seedPlansInUtilities,
  utilitiesCoupons,
  utilitiesFailure,
  utilitiesOf,
} from "./utilitiesCatalogue";
import { audit, fail, ok, openOp, readArgs } from "../../workspace/ops/_shared/core";
import { balancesCache, noteBillingWrite, summaryCache, usageReportCache, usageReportKey } from "./readCache";
import type { OpAnswer, OpCtx, OpDeps } from "../../workspace/ops/_shared/ports";
import {
  BILLING_SCHEMA,
  COUPON_FIELDS,
  CREDIT_FIELDS,
  PURCHASE_FIELDS,
  couponView,
  entryView,
  holdsPlatform,
  num,
  openMember,
  openPlatform,
  planOf,
  planToRow,
  purchaseView,
  readPlans,
  readSettings,
  setSubscription,
  str,
  subscriptionOf,
  workspaceEntries,
  workspaceNames,
  writeEntry,
  type Row,
} from "./shared";

const bad = (keys: string[]): OpAnswer<never> => fail("invalid_input", "tenancy.invalidArgs", { keys });

/** The catalogue of the source in use (Plan rows, or Blocks Utilities with billing.source "blocks-utilities"). */
export async function catalogueOf(deps: OpDeps): Promise<{ ok: true; plans: PlanView[]; source: BillingSource } | { ok: false; error: OpAnswer<never> }> {
  try {
    const c = await readCatalogue(deps);
    return { ok: true, ...c };
  } catch (e) {
    return { ok: false, error: utilitiesFailure(e, "catalogue") };
  }
}

/** For answers that only name plans (summary, balances): the source's catalogue, or the stored rows when Utilities does
 *  not answer (a name is never worth failing the credit pill for). */
async function planNames(deps: OpDeps): Promise<PlanView[]> {
  const c = await catalogueOf(deps);
  return c.ok ? c.plans : (await readPlans(deps.gateway)).plans;
}

// ---------------------------------------------------------------- plans

export async function plansList(ctx: OpCtx, args: unknown, deps: OpDeps): Promise<OpAnswer<{ plans: PlanView[] }>> {
  const a = readArgs(args, { includeInactive: "boolean?" });
  if (!a.ok) return { ok: false, error: a.error };
  const open = await openOp(ctx, deps, { scope: "self", allowMissingAccount: true });
  if (!open.ok) return { ok: false, error: open.error };
  const c = await catalogueOf(deps);
  if (!c.ok) return c.error;
  const { plans } = c;
  const all = a.value.includeInactive === true && holdsPlatform(open.caller, [BILLING_MANAGE]);
  return ok({ plans: all ? plans : plans.filter((p) => p.active) });
}

/** A plan as the API accepts it; null with the bad keys otherwise. */
export function checkPlan(raw: unknown): { ok: true; plan: PlanView } | { ok: false; keys: string[] } {
  const p = (typeof raw === "object" && raw !== null ? raw : {}) as Record<string, unknown>;
  const keys: string[] = [];
  const key = str(p.key).trim();
  if (!/^[a-z][a-z0-9-]{1,31}$/.test(key)) keys.push("key");
  const name = str(p.name).trim();
  if (!name || name.length > 60) keys.push("name");
  const contactSales = p.contactSales === true || p.priceUsd === null;
  if (!contactSales && !isUsdAmount(p.priceUsd, { allowZero: true })) keys.push("priceUsd");
  if (!isUsdAmount(p.creditUsd, { allowZero: true })) keys.push("creditUsd");
  if (!(ASSISTED as readonly string[]).includes(str(p.assisted))) keys.push("assisted");
  const streams = p.maxParallelStreams;
  if (!(streams === null || (Number.isInteger(streams) && (streams as number) >= 1 && (streams as number) <= 50))) keys.push("maxParallelStreams");
  if (!(Number.isInteger(p.priority) && (p.priority as number) >= 0 && (p.priority as number) <= 100)) keys.push("priority");
  const features = Array.isArray(p.features) ? p.features : null;
  if (!features || features.length > MAX_FEATURES || !features.every((f) => typeof f === "string" && f.trim().length <= MAX_FEATURE_LENGTH)) keys.push("features");
  if (typeof p.active !== "boolean") keys.push("active");
  if (!(Number.isInteger(p.sortOrder) && (p.sortOrder as number) >= 0 && (p.sortOrder as number) <= 1000)) keys.push("sortOrder");
  if (keys.length) return { ok: false, keys };
  return {
    ok: true,
    plan: {
      key,
      name,
      priceUsd: contactSales ? null : (p.priceUsd as number),
      creditUsd: p.creditUsd as number,
      assisted: p.assisted as PlanView["assisted"],
      maxParallelStreams: streams as number | null,
      priority: p.priority as number,
      features: (features as string[]).map((f) => f.trim()).filter(Boolean),
      contactSales,
      active: p.active as boolean,
      sortOrder: p.sortOrder as number,
    },
  };
}

export async function plansSave(ctx: OpCtx, args: unknown, deps: OpDeps): Promise<OpAnswer<{ plan: PlanView }>> {
  const a = readArgs(args, { plan: "object?" });
  if (!a.ok) return { ok: false, error: a.error };
  const checked = checkPlan(a.value.plan);
  if (!checked.ok) return bad(checked.keys.map((k) => `plan.${k}`));
  const open = await openPlatform(ctx, deps);
  if (!open.ok) return { ok: false, error: open.error };
  const { caller } = open;
  const plan = checked.plan;
  if ((await readSource(deps.gateway)) === "blocks-utilities") {
    const u = utilitiesOf(deps);
    if (!u.ok) return u.error;
    const saved = await savePlanInUtilities(u.u, plan);
    if (!saved.ok) return saved.error;
    await audit(deps, ctx, caller, { targetType: "plan", targetId: plan.key, details: { ...plan, features: plan.features.length, source: "blocks-utilities", created: saved.created } });
    return ok({ plan: saved.plan });
  }
  const { rows } = await readPlans(deps.gateway);
  const existing = rows.find((r) => r.Key === plan.key);
  const row = { ...planToRow(plan), UpdatedByUserId: caller.userId };
  if (existing) await deps.gateway.update(BILLING_SCHEMA.plan, str(existing.ItemId), row);
  else {
    const res = await deps.gateway.insertOnce<Row>(BILLING_SCHEMA.plan, { ...row, CreatedByUserId: caller.userId }, `plan:${plan.key}`);
    if (!res.created) await deps.gateway.update(BILLING_SCHEMA.plan, res.item.ItemId, row);
  }
  await audit(deps, ctx, caller, { targetType: "plan", targetId: plan.key, details: { ...plan, features: plan.features.length } });
  return ok({ plan });
}

/** Writes the default plans that are not stored yet (idempotent: RequestKey plan:<key>). */
export async function plansSeed(ctx: OpCtx, args: unknown, deps: OpDeps): Promise<OpAnswer<{ created: string[] }>> {
  const a = readArgs(args, {});
  if (!a.ok) return { ok: false, error: a.error };
  const open = await openPlatform(ctx, deps);
  if (!open.ok) return { ok: false, error: open.error };
  if ((await readSource(deps.gateway)) === "blocks-utilities") {
    const u = utilitiesOf(deps);
    if (!u.ok) return u.error;
    const seeded = await seedPlansInUtilities(u.u);
    if (!seeded.ok) return seeded.error;
    if (seeded.created.length) await audit(deps, ctx, open.caller, { targetType: "plan", targetId: "defaults", details: { created: seeded.created, source: "blocks-utilities" } });
    return ok({ created: seeded.created });
  }
  const { rows } = await readPlans(deps.gateway);
  const have = new Set(rows.map((r) => str(r.Key)));
  const missing = DEFAULT_PLANS.filter((p) => !have.has(p.key));
  const res = await Promise.all(
    missing.map((p) =>
      deps.gateway.insertOnce<Row>(
        BILLING_SCHEMA.plan,
        { ...planToRow(p), CreatedByUserId: open.caller.userId, UpdatedByUserId: open.caller.userId },
        `plan:${p.key}`,
      ),
    ),
  );
  const created = missing.filter((_, i) => res[i]!.created).map((p) => p.key);
  if (created.length) await audit(deps, ctx, open.caller, { targetType: "plan", targetId: "defaults", details: { created } });
  return ok({ created });
}

// ---------------------------------------------------------------- settings

export async function settingsGet(ctx: OpCtx, args: unknown, deps: OpDeps): Promise<OpAnswer<BillingSettings>> {
  const a = readArgs(args, {});
  if (!a.ok) return { ok: false, error: a.error };
  const open = await openPlatform(ctx, deps, [BILLING_MANAGE, USAGE_VIEW]);
  if (!open.ok) return { ok: false, error: open.error };
  const s = await readSettings(deps.gateway);
  return ok({ priceFactor: s.priceFactor, signupCreditUsd: s.signupCreditUsd, source: s.source });
}

export async function settingsSave(ctx: OpCtx, args: unknown, deps: OpDeps): Promise<OpAnswer<BillingSettings>> {
  const a = readArgs(args, { priceFactor: "number?", signupCreditUsd: "number?", source: "string?" });
  if (!a.ok) return { ok: false, error: a.error };
  const { priceFactor, signupCreditUsd } = a.value;
  const source = a.value.source as BillingSource | undefined;
  const keys: string[] = [];
  if (priceFactor !== undefined && !(priceFactor > 0 && priceFactor <= MAX_PRICE_FACTOR)) keys.push("priceFactor");
  if (signupCreditUsd !== undefined && !isUsdAmount(signupCreditUsd, { allowZero: true })) keys.push("signupCreditUsd");
  if (source !== undefined && !(BILLING_SOURCES as readonly string[]).includes(source)) keys.push("source");
  if (keys.length) return bad(keys);
  const open = await openPlatform(ctx, deps);
  if (!open.ok) return { ok: false, error: open.error };
  const { caller } = open;
  const before = await readSettings(deps.gateway);
  // Switching to Blocks Utilities only when it answers on the service identity (the catalogue must be readable).
  if (source === "blocks-utilities" && before.source !== "blocks-utilities") {
    const u = utilitiesOf(deps);
    if (!u.ok) return u.error;
    try {
      await u.u.service.plans.list({ status: "All" });
    } catch (e) {
      return utilitiesFailure(e, "catalogue");
    }
  }
  const write = async (key: string, value: number | string, description: string) => {
    const existing = before.rows.find((r) => r.Key === key);
    const valueJson = JSON.stringify(value);
    if (existing) await deps.gateway.update(BILLING_SCHEMA.platformSetting, str(existing.ItemId), { ValueJson: valueJson, UpdatedByUserId: caller.userId });
    else {
      const res = await deps.gateway.insertOnce<Row>(
        BILLING_SCHEMA.platformSetting,
        { Key: key, Values: [], ValueJson: valueJson, Description: description, ReaderIds: [], CreatedByUserId: caller.userId, UpdatedByUserId: caller.userId },
        `setting:${key}`,
      );
      if (!res.created) await deps.gateway.update(BILLING_SCHEMA.platformSetting, res.item.ItemId, { ValueJson: valueJson, UpdatedByUserId: caller.userId });
    }
  };
  await Promise.all([
    priceFactor !== undefined ? write(SETTING_PRICE_FACTOR, priceFactor, "Credit charged = measured AI cost x this factor.") : null,
    signupCreditUsd !== undefined ? write(SETTING_SIGNUP_CREDIT, signupCreditUsd, "Credit in USD a new organization gets once.") : null,
    source !== undefined ? write(SETTING_SOURCE, source, "Where plans, codes and subscriptions live: factory or blocks-utilities.") : null,
  ]);
  const next = { priceFactor: priceFactor ?? before.priceFactor, signupCreditUsd: signupCreditUsd ?? before.signupCreditUsd, source: source ?? before.source };
  if (source !== undefined && source !== before.source) noteBillingWrite();
  await audit(deps, ctx, caller, {
    targetType: "platform-setting",
    targetId: "billing",
    details: { before: { priceFactor: before.priceFactor, signupCreditUsd: before.signupCreditUsd, source: before.source }, after: next },
  });
  return ok(next);
}

// ---------------------------------------------------------------- organization

const RUNNING = ["claimed", "running"];
const NEWEST_JOBS = 20;

/** Engine jobs running now across the platform (claimed or running; the gateway's count, no rows): the platform's usage
 *  and credit pages read faster while any runs. */
async function runningJobCount(g: OpDeps["gateway"]): Promise<number> {
  const res = await g.list<Row>(BILLING_SCHEMA.engineJob, { filter: { Status: { in: RUNNING } }, fields: ["ItemId"], page: 1, pageSize: 1 });
  return res.totalCount;
}

type SummaryAnswer = OpAnswer<BillingSummary & { jobs: { jobId: string; projectId: string; costUsd: number; tokens: number; at: string }[] }>;

/** The organization's summary. The membership check runs on every call; the answer itself is shared for 5 s per
 *  organization (readCache.ts: every open pill, card and menu asks for it, and each read takes all its entries). */
export async function summary(ctx: OpCtx, args: unknown, deps: OpDeps): Promise<SummaryAnswer> {
  const a = readArgs(args, { workspaceId: "string" });
  if (!a.ok) return { ok: false, error: a.error };
  const workspaceId = a.value.workspaceId;
  const open = await openMember(ctx, deps, workspaceId);
  if (!open.ok) return { ok: false, error: open.error };
  return summaryCache.read(workspaceId, () => readSummary(workspaceId, deps), (r) => (r as SummaryAnswer).ok) as Promise<SummaryAnswer>;
}

async function readSummary(workspaceId: string, deps: OpDeps): Promise<SummaryAnswer> {
  const g = deps.gateway;
  const [entries, sub, { plans }, running, pending] = await Promise.all([
    workspaceEntries(g, workspaceId),
    subscriptionOf(g, workspaceId),
    planNames(deps).then((plans) => ({ plans })),
    g.listAll<Row>(BILLING_SCHEMA.engineJob, { filter: { WorkspaceId: workspaceId, Status: { in: RUNNING } }, fields: ["ItemId", "Kind", "UsageJson"], maxItems: 200 }),
    g.listAll<Row>(BILLING_SCHEMA.purchaseRequest, { filter: { WorkspaceId: workspaceId, Status: "pending" }, fields: PURCHASE_FIELDS, maxItems: 50 }),
  ]);
  const totals = billingTotals(entries);
  const since = monthStart(deps.clock.now());
  const usage = entries.filter((e) => e.Kind === "usage");
  const month = usage.filter((e) => str(e.At) >= since);
  const perProject = new Map<string, { cents: number; tokens: number }>();
  for (const e of usage) {
    const id = str(e.ProjectId);
    const p = perProject.get(id) ?? { cents: 0, tokens: 0 };
    p.cents -= entryCents(e);
    p.tokens += num(e.Tokens);
    perProject.set(id, p);
  }
  const projectIds = [...perProject.keys()].filter(Boolean);
  const projects = projectIds.length
    ? await g.listAll<Row>(BILLING_SCHEMA.project, { filter: { ItemId: { in: projectIds } }, fields: ["ItemId", "Name"] })
    : [];
  const names = new Map(projects.map((p) => [str(p.ItemId), str(p.Name)]));
  const planKey = sub && str(sub.Status) !== "cancelled" ? str(sub.PlanKey) || "free" : "free";
  // the organization's plan as the catalogue lists it; a plan the catalogue does not list is answered as no plan (null),
  // never as another plan or a built-in one
  const plan = planOf(plans, planKey);
  const jobs = [...usage]
    .sort((x, y) => str(y.At).localeCompare(str(x.At)))
    .slice(0, NEWEST_JOBS)
    .map((e) => ({ jobId: str(e.JobId), projectId: str(e.ProjectId), costUsd: centsToUsd(-entryCents(e)), tokens: num(e.Tokens), at: str(e.At) }));
  return ok({
    plan: plan ? { key: plan.key, name: plan.name, assisted: plan.assisted, maxParallelStreams: plan.maxParallelStreams } : null,
    subscription: sub
      ? { status: (str(sub.Status) || "active") as "active", startedAt: str(sub.StartedAt), renewsAt: str(sub.RenewsAt), cancelAtPeriodEnd: sub.CancelAtPeriodEnd === true }
      : null,
    balanceUsd: centsToUsd(totals.balanceCents),
    grantedUsd: centsToUsd(totals.grantedCents),
    consumedUsd: centsToUsd(totals.consumedCents),
    tokens: totals.tokens,
    monthUsedUsd: centsToUsd(-month.reduce((n, e) => n + entryCents(e), 0)),
    monthTokens: month.reduce((n, e) => n + num(e.Tokens), 0),
    perProject: [...perProject.entries()]
      .map(([projectId, p]) => ({ projectId, name: names.get(projectId) ?? "", costUsd: centsToUsd(p.cents), tokens: p.tokens }))
      .sort((x, y) => y.costUsd - x.costUsd),
    activeAgents: running.reduce((n, j) => n + Math.max(1, parseJobUsage(j.UsageJson)?.agents ?? 0), 0),
    runningJobs: running.length,
    pendingRequests: pending.map((r) => purchaseView(r)),
    jobs,
  });
}

/** The most jobs one billing.jobs.usage call answers for. */
export const MAX_USAGE_JOBS = 20;

/** What some jobs of the organization have cost so far: each job's one usage entry (RequestKey usage:<job id>, charged
 *  and tokens, brought up to the new total as each of its lanes ends). A job without an entry has not been charged.
 *  Members only; one read of at most 20 rows by their unique key, never cached (the build in focus follows its job). */
export async function jobsUsage(ctx: OpCtx, args: unknown, deps: OpDeps): Promise<OpAnswer<{ jobs: JobUsageEntry[] }>> {
  const a = readArgs(args, { workspaceId: "string", jobIds: "string[]" });
  if (!a.ok) return { ok: false, error: a.error };
  const ids = [...new Set(a.value.jobIds.map((id) => id.trim()).filter(Boolean))];
  if (ids.length === 0 || ids.length > MAX_USAGE_JOBS || ids.some((id) => id.length > 64)) return bad(["jobIds"]);
  const workspaceId = a.value.workspaceId;
  const open = await openMember(ctx, deps, workspaceId);
  if (!open.ok) return { ok: false, error: open.error };
  const rows = await deps.gateway.listAll<Row>(BILLING_SCHEMA.creditEntry, {
    filter: { WorkspaceId: workspaceId, RequestKey: { in: ids.map((id) => `usage:${id}`) } },
    fields: ["JobId", "Kind", "AmountUsd", "AmountCents", "Tokens", "At"],
    maxItems: MAX_USAGE_JOBS,
  });
  const jobs = rows
    .filter((e) => e.Kind === "usage" && ids.includes(str(e.JobId)))
    .map((e) => ({ jobId: str(e.JobId), costUsd: centsToUsd(-entryCents(e)), tokens: num(e.Tokens), at: str(e.At) }));
  return ok({ jobs });
}

export async function redeemCoupon(
  ctx: OpCtx,
  args: unknown,
  deps: OpDeps,
): Promise<OpAnswer<{ amountUsd: number; planKey: string | null; balanceUsd: number }>> {
  const a = readArgs(args, { workspaceId: "string", code: "string" });
  if (!a.ok) return { ok: false, error: a.error };
  const code = normalizeCouponCode(a.value.code);
  if (!COUPON_CODE.test(code)) return bad(["code"]);
  const open = await openMember(ctx, deps, a.value.workspaceId);
  if (!open.ok) return { ok: false, error: open.error };
  const { caller } = open;
  const workspaceId = a.value.workspaceId;
  const g = deps.gateway;
  // Every redemption of a code is one credit entry carrying its code (redeemed here, or paid at checkout).
  const [coupons, redeemed] = await Promise.all([
    g.listAll<Row>(BILLING_SCHEMA.coupon, { filter: { Code: code }, fields: COUPON_FIELDS, maxItems: 2 }),
    g.listAll<Row>(BILLING_SCHEMA.creditEntry, { filter: { CouponCode: code }, fields: CREDIT_FIELDS, maxItems: 5000 }),
  ]);
  const coupon = coupons[0];
  if (!coupon) {
    // With the codes in Blocks Utilities, a plan or discount code is used at checkout.
    if (deps.utilities && (await readSource(g)) === "blocks-utilities") {
      const d = await findDiscount(deps.utilities, code).catch(() => null);
      if (d) return fail("conflict", "billing.coupon.useAtCheckout", { kind: "discount", planKey: d.applicablePlanCodes[0] ?? null });
    }
    return fail("not_found", "billing.couponUnknown");
  }
  const terms = couponTermsOf(coupon);
  // Plan and discount codes pay a plan: they are used at checkout (the answer names the plan to open it for).
  if (!terms.legacy && terms.kind !== "credit") return fail("conflict", "billing.coupon.useAtCheckout", { kind: terms.kind, planKey: terms.planKeys[0] ?? null });
  if (redeemed.some((e) => e.WorkspaceId === workspaceId)) return fail("conflict", "billing.couponAlreadyRedeemed");
  const refusal = couponRefusal(coupon, deps.clock.now(), redeemed.length);
  if (refusal) return fail(refusal === "used-up" ? "limit_reached" : "forbidden", `billing.coupon.${refusal}`);
  if (terms.perPersonLimit > 0 && redeemed.filter((e) => e.UserId === caller.userId).length >= terms.perPersonLimit) {
    return fail("limit_reached", "billing.coupon.personLimit", { limit: terms.perPersonLimit });
  }
  const plans = await planNames(deps);
  const planKey = str(coupon.PlanKey);
  const plan = planKey ? planOf(plans, planKey) : null;
  if (planKey && !plan) return fail("conflict", "billing.planUnknown");
  const cents = toCents(num(coupon.AmountUsd));
  const max = num(coupon.MaxRedemptions);
  // One redemption slot per RequestKey coupon:<code>:<n>: two organizations racing for the last slot cannot both get it.
  let slot = redeemed.length + 1;
  let won = false;
  for (let tries = 0; tries < 5 && (max === 0 || slot <= max); tries++, slot++) {
    const res = await writeEntry(
      deps,
      { workspaceId, kind: "coupon", cents, userId: caller.userId, couponCode: code, planKey, note: `Coupon ${code}` },
      `coupon:${code}:${slot}`,
      caller.userId,
    );
    if (res.created || str(res.row.WorkspaceId) === workspaceId) {
      won = true;
      break;
    }
  }
  if (!won) return fail("limit_reached", "billing.coupon.used-up");
  const now = deps.clock.now();
  await Promise.all([
    g.update(BILLING_SCHEMA.coupon, str(coupon.ItemId), { Redemptions: Math.max(num(coupon.Redemptions), slot), UpdatedByUserId: caller.userId }),
    plan ? setSubscription(deps, { workspaceId, planKey: plan.key, startedAt: now, renewsAt: plan.priceUsd ? addMonth(now) : "", by: caller.userId }) : null,
  ]);
  const balance = billingTotals(await workspaceEntries(g, workspaceId)).balanceCents;
  await audit(deps, ctx, caller, { workspaceId, targetType: "coupon", targetId: code, details: { amountUsd: centsToUsd(cents), planKey: planKey || null } });
  return ok({ amountUsd: centsToUsd(cents), planKey: planKey || null, balanceUsd: centsToUsd(balance) });
}

export async function requestPurchase(ctx: OpCtx, args: unknown, deps: OpDeps): Promise<OpAnswer<{ request: PurchaseView }>> {
  const a = readArgs(args, { workspaceId: "string", planKey: "string?", amountUsd: "number?", note: "string?" });
  if (!a.ok) return { ok: false, error: a.error };
  const { workspaceId, planKey, amountUsd } = a.value;
  const note = (a.value.note ?? "").trim();
  if (note.length > MAX_NOTE_LENGTH) return bad(["note"]);
  if (Boolean(planKey) === (amountUsd !== undefined)) return bad(["planKey", "amountUsd"]);
  if (amountUsd !== undefined && !isUsdAmount(amountUsd)) return bad(["amountUsd"]);
  const open = await openMember(ctx, deps, workspaceId);
  if (!open.ok) return { ok: false, error: open.error };
  const { caller } = open;
  if (planKey) {
    const c = await catalogueOf(deps);
    if (!c.ok) return c.error;
    const plan = planOf(c.plans, planKey);
    if (!plan || !plan.active) return fail("not_found", "billing.planUnknown");
  }
  const res = await deps.gateway.insertOnce<Row>(
    BILLING_SCHEMA.purchaseRequest,
    {
      WorkspaceId: workspaceId,
      UserId: caller.userId,
      UserEmail: caller.email,
      PlanKey: planKey ?? "",
      AmountUsd: amountUsd !== undefined ? centsToUsd(toCents(amountUsd)) : 0,
      Status: "pending",
      Note: note,
      DecisionNote: "",
      DecidedBy: "",
      DecidedAt: "",
      CreatedByUserId: caller.userId,
      UpdatedByUserId: caller.userId,
    },
    `purchase:${ctx.requestId}`,
  );
  await audit(deps, ctx, caller, { workspaceId, targetType: "purchase-request", targetId: res.item.ItemId, details: { planKey: planKey ?? null, amountUsd: amountUsd ?? null } });
  const names = new Map([[workspaceId, str(caller.workspace?.Name)]]);
  return ok({ request: purchaseView({ ...res.item, CreatedDate: res.item.CreatedDate ?? deps.clock.now() }, names) });
}

// ---------------------------------------------------------------- administration

export async function couponsList(ctx: OpCtx, args: unknown, deps: OpDeps): Promise<OpAnswer<{ coupons: CouponView[] }>> {
  const a = readArgs(args, {});
  if (!a.ok) return { ok: false, error: a.error };
  const open = await openPlatform(ctx, deps);
  if (!open.ok) return { ok: false, error: open.error };
  const [rows, source] = await Promise.all([
    deps.gateway.listAll<Row>(BILLING_SCHEMA.coupon, { filter: {}, fields: COUPON_FIELDS, maxItems: 2000 }),
    readSource(deps.gateway),
  ]);
  const sorted = (list: CouponView[]) => list.sort((x, y) => Number(y.active) - Number(x.active) || x.code.localeCompare(y.code));
  if (source === "factory") return ok({ coupons: sorted(rows.map(couponView)) });
  // Blocks Utilities holds the plan and discount codes; credit codes (no Utilities counterpart) stay rows here.
  const u = utilitiesOf(deps);
  if (!u.ok) return u.error;
  let held: CouponView[];
  try {
    const plans = await planNames(deps);
    held = await utilitiesCoupons(u.u, (k) => planOf(plans, k)?.name ?? k);
  } catch (e) {
    return utilitiesFailure(e, "catalogue");
  }
  const credit = rows.map(couponView).filter((c) => c.kind === "credit").map((c) => ({ ...c, source: "factory" as const }));
  return ok({ coupons: sorted([...held, ...credit]) });
}

export async function couponsSave(ctx: OpCtx, args: unknown, deps: OpDeps): Promise<OpAnswer<{ coupon: CouponView }>> {
  const a = readArgs(args, {
    id: "string?", code: "string?", amountUsd: "number?", planKey: "string?", maxRedemptions: "number?", expiresAt: "string?", active: "boolean?", note: "string?",
    kind: "string?", planKeys: "string[]?", durationMonths: "number?", percentOff: "number?", amountOffUsd: "number?", perPersonLimit: "number?",
  });
  if (!a.ok) return { ok: false, error: a.error };
  const v = a.value;
  const keys: string[] = [];
  const code = v.code ? normalizeCouponCode(v.code) : "";
  if (code && !COUPON_CODE.test(code)) keys.push("code");
  if (v.amountUsd !== undefined && !isUsdAmount(v.amountUsd, { allowZero: true })) keys.push("amountUsd");
  if (v.maxRedemptions !== undefined && !(Number.isInteger(v.maxRedemptions) && v.maxRedemptions >= 0 && v.maxRedemptions <= 1_000_000)) keys.push("maxRedemptions");
  if (v.expiresAt && !Number.isFinite(Date.parse(v.expiresAt))) keys.push("expiresAt");
  if ((v.note ?? "").length > MAX_NOTE_LENGTH) keys.push("note");
  // A code with a kind (credit | plan | discount) is checked as a whole; one without keeps the earlier meaning.
  const kinded = v.kind !== undefined;
  if (kinded) {
    if (v.planKey) keys.push("planKey");
    keys.push(...couponTermsProblems({
      kind: v.kind, amountUsd: v.amountUsd ?? 0, planKeys: v.planKeys ?? [], durationMonths: v.durationMonths, percentOff: v.percentOff ?? 0,
      amountOffUsd: v.amountOffUsd ?? 0, perPersonLimit: v.perPersonLimit,
    }));
  } else {
    if (v.perPersonLimit !== undefined && !(Number.isInteger(v.perPersonLimit) && v.perPersonLimit >= 0 && v.perPersonLimit <= 1000)) keys.push("perPersonLimit");
    if (v.planKeys !== undefined || v.durationMonths !== undefined || v.percentOff !== undefined || v.amountOffUsd !== undefined) keys.push("kind");
    if (!v.id && v.amountUsd === undefined) keys.push("amountUsd");
  }
  if (keys.length) return bad([...new Set(keys)]);
  const open = await openPlatform(ctx, deps);
  if (!open.ok) return { ok: false, error: open.error };
  const { caller } = open;
  const g = deps.gateway;
  const source = await readSource(g);
  if (v.planKey || v.planKeys?.length) {
    const c = await catalogueOf(deps);
    if (!c.ok) return c.error;
    const { plans } = c;
    if (v.planKey && !planOf(plans, v.planKey)) return bad(["planKey"]);
    const paid = (k: string) => {
      const p = planOf(plans, k);
      return Boolean(p && !p.contactSales && (p.priceUsd ?? 0) > 0);
    };
    if (v.planKeys?.some((k) => !paid(k))) return bad(["planKeys"]);
  }
  const terms: Row = kinded
    ? {
      Kind: v.kind,
      AmountUsd: centsToUsd(toCents(v.amountUsd ?? 0)),
      PlanKey: "",
      PlanKeys: [...new Set(v.planKeys ?? [])],
      DurationMonths: v.durationMonths ?? 1,
      PercentOff: v.percentOff ?? 0,
      AmountOffUsd: centsToUsd(toCents(v.amountOffUsd ?? 0)),
    }
    : {};
  if (v.perPersonLimit !== undefined) terms.PerPersonLimit = v.perPersonLimit;
  // Plan and discount codes live in Blocks Utilities when it is the source (credit codes stay rows here).
  const discountId = v.id ? discountIdOf(v.id) : null;
  if (source === "blocks-utilities" && (discountId || (kinded && v.kind !== "credit"))) {
    const u = utilitiesOf(deps);
    if (!u.ok) return u.error;
    const plans = await planNames(deps);
    const newCode = code || (discountId ? "" : newCouponCode());
    const saved = await saveCouponInUtilities(u.u, {
      discountId,
      code: newCode,
      terms: kinded ? couponTermsOf({ Code: newCode, ...terms }) : null,
      ...(v.expiresAt !== undefined ? { expiresAt: v.expiresAt } : {}),
      ...(v.active !== undefined ? { active: v.active } : {}),
      ...(v.note !== undefined ? { note: v.note.trim() } : {}),
    }, (k) => planOf(plans, k)?.name ?? k);
    if (!saved.ok) return saved.error;
    await audit(deps, ctx, caller, { targetType: "coupon", targetId: saved.coupon.code, details: { kind: saved.coupon.kind, active: saved.coupon.active, source: "blocks-utilities" } });
    return ok({ coupon: saved.coupon });
  }
  if (v.id) {
    const found = await g.listAll<Row>(BILLING_SCHEMA.coupon, { filter: { ItemId: v.id }, fields: COUPON_FIELDS, maxItems: 1 });
    const row = found[0];
    if (!row) return fail("not_found");
    if (code && code !== str(row.Code)) return bad(["code"]);
    if (kinded && str(row.Kind) && str(row.Kind) !== v.kind) return bad(["kind"]);
    const set: Row = { ...terms, UpdatedByUserId: caller.userId };
    if (v.amountUsd !== undefined) set.AmountUsd = centsToUsd(toCents(v.amountUsd));
    if (v.planKey !== undefined) set.PlanKey = v.planKey;
    if (v.maxRedemptions !== undefined) set.MaxRedemptions = v.maxRedemptions;
    if (v.expiresAt !== undefined) set.ExpiresAt = v.expiresAt ? new Date(v.expiresAt).toISOString() : "";
    if (v.active !== undefined) set.Active = v.active;
    if (v.note !== undefined) set.Note = v.note.trim();
    await g.update(BILLING_SCHEMA.coupon, v.id, set);
    await audit(deps, ctx, caller, { targetType: "coupon", targetId: str(row.Code), details: { ...set, UpdatedByUserId: undefined } });
    return ok({ coupon: couponView({ ...row, ...set }) });
  }
  const row: Row = {
    Code: code || newCouponCode(),
    AmountUsd: centsToUsd(toCents(v.amountUsd ?? 0)),
    PlanKey: v.planKey ?? "",
    MaxRedemptions: v.maxRedemptions ?? 1,
    Redemptions: 0,
    PerPersonLimit: 1,
    ...terms,
    ExpiresAt: v.expiresAt ? new Date(v.expiresAt).toISOString() : "",
    Active: v.active ?? true,
    Note: (v.note ?? "").trim(),
    CreatedByUserId: caller.userId,
    UpdatedByUserId: caller.userId,
  };
  const existing = await g.listAll<Row>(BILLING_SCHEMA.coupon, { filter: { Code: str(row.Code) }, fields: ["ItemId"], maxItems: 1 });
  if (existing.length) return fail("conflict", "billing.couponCodeTaken");
  const res = await g.insertOnce<Row>(BILLING_SCHEMA.coupon, row, `coupon:${ctx.requestId}`);
  await audit(deps, ctx, caller, { targetType: "coupon", targetId: str(row.Code), details: { amountUsd: row.AmountUsd, planKey: row.PlanKey || null, maxRedemptions: row.MaxRedemptions } });
  return ok({ coupon: couponView(res.item) });
}

export async function purchasesList(ctx: OpCtx, args: unknown, deps: OpDeps): Promise<OpAnswer<{ requests: PurchaseView[]; items: PurchaseView[] }>> {
  const a = readArgs(args, { status: "string?" });
  if (!a.ok) return { ok: false, error: a.error };
  if (a.value.status && !(PURCHASE_STATUSES as readonly string[]).includes(a.value.status)) return bad(["status"]);
  const open = await openPlatform(ctx, deps);
  if (!open.ok) return { ok: false, error: open.error };
  const rows = await deps.gateway.listAll<Row>(BILLING_SCHEMA.purchaseRequest, {
    filter: a.value.status ? { Status: a.value.status } : {},
    fields: PURCHASE_FIELDS,
    maxItems: 1000,
  });
  const names = await workspaceNames(deps.gateway, rows.map((r) => str(r.WorkspaceId)));
  const requests = rows
    .map((r) => purchaseView(r, names))
    .sort((x, y) => Number(y.status === "pending") - Number(x.status === "pending") || y.createdAt.localeCompare(x.createdAt));
  return ok({ requests, items: requests });
}

export async function purchasesDecide(ctx: OpCtx, args: unknown, deps: OpDeps): Promise<OpAnswer<{ request: PurchaseView }>> {
  const a = readArgs(args, { id: "string", decision: "string", note: "string?" });
  if (!a.ok) return { ok: false, error: a.error };
  const { id, decision } = a.value;
  if (decision !== "approve" && decision !== "decline") return bad(["decision"]);
  if ((a.value.note ?? "").length > MAX_NOTE_LENGTH) return bad(["note"]);
  const open = await openPlatform(ctx, deps);
  if (!open.ok) return { ok: false, error: open.error };
  const { caller } = open;
  const g = deps.gateway;
  const found = await g.listAll<Row>(BILLING_SCHEMA.purchaseRequest, { filter: { ItemId: id }, fields: PURCHASE_FIELDS, maxItems: 1 });
  const row = found[0];
  if (!row) return fail("not_found");
  if (str(row.Status) !== "pending") return fail("conflict", "billing.alreadyDecided");
  const workspaceId = str(row.WorkspaceId);
  const now = deps.clock.now();
  if (decision === "approve") {
    const planKey = str(row.PlanKey);
    if (planKey) {
      const plans = await planNames(deps);
      const plan = planOf(plans, planKey);
      if (!plan) return fail("conflict", "billing.planUnknown");
      await setSubscription(deps, { workspaceId, planKey, startedAt: now, renewsAt: plan.priceUsd ? addMonth(now) : "", by: caller.userId });
      const cents = toCents(plan.creditUsd);
      if (cents > 0) {
        await writeEntry(deps, { workspaceId, kind: "plan", cents, userId: str(row.UserId), planKey, note: `${plan.name} plan credit` }, `purchase:${id}`, caller.userId);
      }
    } else {
      const cents = toCents(num(row.AmountUsd));
      if (cents > 0) await writeEntry(deps, { workspaceId, kind: "purchase", cents, userId: str(row.UserId), note: "Credit purchase" }, `purchase:${id}`, caller.userId);
    }
  }
  const set = { Status: decision === "approve" ? "approved" : "declined", DecidedBy: caller.userId, DecidedAt: now, DecisionNote: (a.value.note ?? "").trim(), UpdatedByUserId: caller.userId };
  await g.update(BILLING_SCHEMA.purchaseRequest, id, set);
  await audit(deps, ctx, caller, { workspaceId, targetType: "purchase-request", targetId: id, details: { decision, planKey: str(row.PlanKey) || null, amountUsd: num(row.AmountUsd) || null } });
  const names = await workspaceNames(g, [workspaceId]);
  return ok({ request: purchaseView({ ...row, ...set }, names) });
}

export async function adjust(ctx: OpCtx, args: unknown, deps: OpDeps): Promise<OpAnswer<{ entry: CreditEntryView; balanceUsd: number }>> {
  const a = readArgs(args, { workspaceId: "string", amountUsd: "number?", note: "string" });
  if (!a.ok) return { ok: false, error: a.error };
  const note = a.value.note.trim();
  const keys: string[] = [];
  if (!isUsdAmount(a.value.amountUsd, { allowNegative: true })) keys.push("amountUsd");
  if (!note || note.length > MAX_NOTE_LENGTH) keys.push("note");
  if (keys.length) return bad(keys);
  const open = await openPlatform(ctx, deps);
  if (!open.ok) return { ok: false, error: open.error };
  const { caller } = open;
  const workspaceId = a.value.workspaceId;
  const ws = await workspaceNames(deps.gateway, [workspaceId]);
  if (!ws.has(workspaceId)) return fail("not_found");
  const cents = toCents(a.value.amountUsd as number);
  const res = await writeEntry(deps, { workspaceId, kind: "adjustment", cents, note, userId: caller.userId }, `adjust:${ctx.requestId}`, caller.userId);
  const balance = billingTotals(await workspaceEntries(deps.gateway, workspaceId)).balanceCents;
  await audit(deps, ctx, caller, { workspaceId, targetType: "credit", targetId: workspaceId, details: { amountUsd: centsToUsd(cents), note } });
  return ok({ entry: entryView(res.row), balanceUsd: centsToUsd(balance) });
}

type BalancesAnswer = OpAnswer<{ rows: BalanceRow[]; runningJobs: number }>;

export async function balancesList(ctx: OpCtx, args: unknown, deps: OpDeps): Promise<BalancesAnswer> {
  const a = readArgs(args, {});
  if (!a.ok) return { ok: false, error: a.error };
  const open = await openPlatform(ctx, deps, [BILLING_MANAGE, USAGE_VIEW]);
  if (!open.ok) return { ok: false, error: open.error };
  // the permission check ran above; every organization's balance is shared for 5 s (readCache.ts)
  return balancesCache.read("all", () => readBalances(deps), (r) => (r as BalancesAnswer).ok) as Promise<BalancesAnswer>;
}

async function readBalances(deps: OpDeps): Promise<BalancesAnswer> {
  const g = deps.gateway;
  const [workspaces, entries, subs, { plans }, runningJobs] = await Promise.all([
    g.listAll<Row>(BILLING_SCHEMA.workspace, { filter: {}, fields: ["ItemId", "Name", "Status"], maxItems: 5000 }),
    g.listAll<Row>(BILLING_SCHEMA.creditEntry, { filter: {}, fields: ["WorkspaceId", "Kind", "AmountUsd", "AmountCents", "Tokens"], maxItems: 5000 }),
    g.listAll<Row>(BILLING_SCHEMA.subscription, { filter: {}, fields: ["WorkspaceId", "PlanKey", "Status"], maxItems: 5000 }),
    planNames(deps).then((plans) => ({ plans })),
    runningJobCount(g),
  ]);
  const byWs = new Map<string, Row[]>();
  for (const e of entries) {
    const list = byWs.get(str(e.WorkspaceId)) ?? [];
    list.push(e);
    byWs.set(str(e.WorkspaceId), list);
  }
  const subOf = new Map(subs.filter((s) => str(s.Status) !== "cancelled").map((s) => [str(s.WorkspaceId), str(s.PlanKey)]));
  const rows = workspaces.map((w): BalanceRow => {
    const t = billingTotals(byWs.get(str(w.ItemId)) ?? []);
    const planKey = subOf.get(str(w.ItemId)) || "free";
    return {
      workspaceId: str(w.ItemId),
      name: str(w.Name),
      planKey,
      planName: planOf(plans, planKey)?.name ?? planKey,
      balanceUsd: centsToUsd(t.balanceCents),
      grantedUsd: centsToUsd(t.grantedCents),
      consumedUsd: centsToUsd(t.consumedCents),
      tokens: t.tokens,
    };
  });
  return ok({ rows: rows.sort((x, y) => x.balanceUsd - y.balanceUsd || x.name.localeCompare(y.name)), runningJobs });
}

export async function entriesList(ctx: OpCtx, args: unknown, deps: OpDeps): Promise<OpAnswer<{ entries: CreditEntryView[] }>> {
  const a = readArgs(args, { workspaceId: "string" });
  if (!a.ok) return { ok: false, error: a.error };
  const open = await openPlatform(ctx, deps, [BILLING_MANAGE, USAGE_VIEW]);
  if (!open.ok) return { ok: false, error: open.error };
  const rows = await workspaceEntries(deps.gateway, a.value.workspaceId);
  return ok({ entries: rows.map(entryView).sort((x, y) => y.at.localeCompare(x.at)).slice(0, 200) });
}

// ---------------------------------------------------------------- usage report

/** Groups usage entries (CreditEntry kind usage, DetailJson) into report rows; costUsd is what was CHARGED. */
export function usageRows(
  entries: readonly Row[],
  groupBy: UsageGroup,
  label: (key: string) => string,
): { rows: UsageRow[]; totals: Omit<UsageRow, "key" | "label"> } {
  const zero = (): Omit<UsageRow, "key" | "label"> => ({ tokens: 0, tokensIn: 0, tokensOut: 0, cacheRead: 0, cacheWrite: 0, costUsd: 0, chargedUsd: 0, rawCostUsd: 0, jobs: 0 });
  const groups = new Map<string, { r: Omit<UsageRow, "key" | "label">; charged: number; raw: number }>();
  const total = { r: zero(), charged: 0, raw: 0 };
  for (const e of entries) {
    const detail = parseJobUsage(str(e.DetailJson));
    const key =
      groupBy === "workspace" ? str(e.WorkspaceId)
      : groupBy === "project" ? str(e.ProjectId)
      : groupBy === "user" ? str(e.UserId)
      : groupBy === "model" ? modelLabel(detail?.models ?? [])
      : str(e.At).slice(0, 10);
    const g = groups.get(key) ?? { r: zero(), charged: 0, raw: 0 };
    for (const t of [g, total]) {
      t.r.tokens += num(e.Tokens) || detail?.tokens.total || 0;
      t.r.tokensIn += detail?.tokens.in ?? 0;
      t.r.tokensOut += detail?.tokens.out ?? 0;
      t.r.cacheRead += detail?.tokens.cacheRead ?? 0;
      t.r.cacheWrite += detail?.tokens.cacheWrite ?? 0;
      t.r.jobs += 1;
      t.charged += -entryCents(e);
      t.raw += detail?.costUsd ?? 0;
    }
    groups.set(key, g);
  }
  const finish = (t: { r: Omit<UsageRow, "key" | "label">; charged: number; raw: number }) => ({
    ...t.r,
    costUsd: centsToUsd(t.charged),
    chargedUsd: centsToUsd(t.charged),
    rawCostUsd: Number(t.raw.toFixed(4)),
  });
  const rows = [...groups.entries()].map(([key, g]) => ({ key, label: label(key), ...finish(g) }));
  rows.sort((x, y) => (groupBy === "day" ? x.key.localeCompare(y.key) : y.costUsd - x.costUsd || y.tokens - x.tokens));
  return { rows, totals: finish(total) };
}

export async function usageReport(ctx: OpCtx, args: unknown, deps: OpDeps): Promise<OpAnswer<UsageReport>> {
  const a = readArgs(args, { from: "string", to: "string", groupBy: "string" });
  if (!a.ok) return { ok: false, error: a.error };
  const keys: string[] = [];
  const from = Date.parse(a.value.from);
  const to = Date.parse(a.value.to);
  if (!Number.isFinite(from)) keys.push("from");
  if (!Number.isFinite(to) || to <= from) keys.push("to");
  if (!(USAGE_GROUPS as readonly string[]).includes(a.value.groupBy)) keys.push("groupBy");
  if (keys.length) return bad(keys);
  const open = await openPlatform(ctx, deps, [USAGE_VIEW, BILLING_MANAGE]);
  if (!open.ok) return { ok: false, error: open.error };
  const groupBy = a.value.groupBy as UsageGroup;
  const fromIso = new Date(from).toISOString();
  const toIso = new Date(to).toISOString();
  // the permission check ran above; the answer is shared for 5 s per period and grouping (readCache.ts)
  const key = usageReportKey(fromIso, toIso, groupBy, Date.parse(deps.clock.now()));
  return usageReportCache.read(key, () => readUsageReport(fromIso, toIso, groupBy, deps), (r) => (r as OpAnswer<UsageReport>).ok) as Promise<OpAnswer<UsageReport>>;
}

async function readUsageReport(fromIso: string, toIso: string, groupBy: UsageGroup, deps: OpDeps): Promise<OpAnswer<UsageReport>> {
  const g = deps.gateway;
  const [all, runningJobs] = await Promise.all([
    g.listAll<Row>(BILLING_SCHEMA.creditEntry, {
      filter: { Kind: "usage", At: { gte: fromIso, lte: toIso } },
      fields: CREDIT_FIELDS,
      maxItems: 5000,
    }),
    runningJobCount(g),
  ]);
  // the range is inclusive at the gateway; the report's `to` is exclusive
  const entries = all.filter((e) => str(e.At) >= fromIso && str(e.At) < toIso);
  const ids = [...new Set(entries.map((e) => str(groupBy === "workspace" ? e.WorkspaceId : groupBy === "project" ? e.ProjectId : e.UserId)).filter(Boolean))];
  const names = new Map<string, string>();
  if (ids.length && groupBy === "workspace") (await workspaceNames(g, ids)).forEach((v, k) => names.set(k, v));
  if (ids.length && groupBy === "project") {
    const rows = await g.listAll<Row>(BILLING_SCHEMA.project, { filter: { ItemId: { in: ids } }, fields: ["ItemId", "Name"] });
    rows.forEach((r) => names.set(str(r.ItemId), str(r.Name)));
  }
  if (ids.length && groupBy === "user") {
    const rows = await g.listAll<Row>(BILLING_SCHEMA.membership, { filter: { UserId: { in: ids } }, fields: ["UserId", "DisplayName", "Email"], maxItems: 5000 });
    rows.forEach((r) => names.set(str(r.UserId), str(r.DisplayName) || str(r.Email)));
  }
  const label = (key: string) => names.get(key) || (key ? key : groupBy === "project" ? "No project" : groupBy === "user" ? "Not recorded" : key);
  const { rows, totals } = usageRows(entries, groupBy, label);
  return ok({ from: fromIso, to: toIso, groupBy, rows, totals, runningJobs });
}

