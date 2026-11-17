/**
 * Success & performance of a draft scope version, and the "screens reviewed" mark (step "Scope & success").
 *   scope.success.save    stores the targets (SuccessTargets JSON on the ScopeVersion row) after normalizeTargets: the
 *                         product manager's answers and who asked always come from the stored row, never from args.
 *   scope.success.ask     queues a scope.success engine job: "propose" fills the empty values from the project,
 *                         "answer" lets the product manager answer the open questions.
 *   scope.screens.review  marks the version's screens as reviewed (or takes the mark back).
 * All three need the scope step open and the version in draft; scope.lock checks the targets again.
 */
import { SCOPE_OP_PERMISSION } from "../../../../src/domain/scope";
import { SUCCESS_KEYS, normalizeTargets, parseSuccessTargets, serializeSuccessTargets } from "../../../../src/domain/successTargets";
import { fail, ok, parseArgs, type Parsed, type ScopeOpDef } from "./ports";
import { SCHEMA } from "./records";
import { loadVersion, rawVersion, refuseUnlessDraftOpen } from "./shared";

interface SaveArgs { projectId: string; scopeVersionId: string; targets: Record<string, unknown> }
interface AskArgs { projectId: string; scopeVersionId: string; mode: "propose" | "answer"; keys?: string[] }
interface ReviewArgs { projectId: string; scopeVersionId: string; reviewed: boolean }

const ACTIVE = new Set(["queued", "claimed", "running"]);

export const scopeSuccessSave: ScopeOpDef<SaveArgs> = {
  op: "scope.success.save",
  kind: "command",
  permission: SCOPE_OP_PERMISSION["scope.success.save"],
  parse: (raw) => parseArgs(raw, { scopeVersionId: { type: "id" }, targets: { type: "object" } }) as Parsed<SaveArgs>,
  prefetch: (env, args) => loadVersion(env, args.scopeVersionId),
  async run(env, args) {
    const version = await loadVersion(env, args.scopeVersionId);
    if (!version) return fail("not_found");
    const refused = refuseUnlessDraftOpen(env, version);
    if (refused) return refused;
    const prev = parseSuccessTargets(version.SuccessTargets);
    const next = normalizeTargets(parseSuccessTargets(args.targets), prev, env.userId, env.nowIso, String(env.project.Name ?? ""));
    const text = serializeSuccessTargets(next);
    if (text === serializeSuccessTargets(prev) && typeof version.SuccessTargets === "string") return ok({ version: rawVersion(version) });
    await env.db.update(SCHEMA.scopeVersion, version.id, { SuccessTargets: text });
    env.audit("scope-version", version.id, { number: version.number, successTargets: true });
    return ok({ version: { ...rawVersion(version), SuccessTargets: text, LastUpdatedDate: env.issuedStamp } });
  },
};

export const scopeSuccessAsk: ScopeOpDef<AskArgs> = {
  op: "scope.success.ask",
  kind: "command",
  permission: SCOPE_OP_PERMISSION["scope.success.ask"],
  parse: (raw) => parseArgs(raw, {
    scopeVersionId: { type: "id" },
    mode: { type: "string", enum: ["propose", "answer"], max: 10 },
    keys: { type: "strings", optional: true, maxItems: SUCCESS_KEYS.length, max: 20 },
  }) as Parsed<AskArgs>,
  prefetch: (env, args) => Promise.all([loadVersion(env, args.scopeVersionId), env.jobs.list(["scope.success"])]),
  async run(env, args) {
    const [version, jobs] = await Promise.all([loadVersion(env, args.scopeVersionId), env.jobs.list(["scope.success"])]);
    if (!version) return fail("not_found");
    const refused = refuseUnlessDraftOpen(env, version);
    if (refused) return refused;
    const keys = (args.keys ?? []).filter((k) => (SUCCESS_KEYS as readonly string[]).includes(k));
    const input = { projectId: env.projectId, scopeVersion: version.number, scopeVersionId: version.id, mode: args.mode, ...(keys.length ? { keys } : {}) };
    // one live request per version: an active one of another version is cancelled in the same round
    const stale = jobs.filter((j) => j.TargetId !== version.id && ACTIVE.has(String(j.Status)));
    const [made, cancelled] = await Promise.all([
      env.jobs.create({ kind: "scope.success", input, targetType: "scope-version", targetId: version.id }),
      stale.length ? env.jobs.cancelRows(stale, "system") : Promise.resolve({ cancelled: [] as string[], skipped: [] as string[] }),
    ]);
    return ok({ job: made.job, existing: made.existing, cancelledJobIds: cancelled.cancelled });
  },
};

export const scopeScreensReview: ScopeOpDef<ReviewArgs> = {
  op: "scope.screens.review",
  kind: "command",
  permission: SCOPE_OP_PERMISSION["scope.screens.review"],
  parse: (raw) => parseArgs(raw, { scopeVersionId: { type: "id" }, reviewed: { type: "boolean" } }) as Parsed<ReviewArgs>,
  prefetch: (env, args) => loadVersion(env, args.scopeVersionId),
  async run(env, args) {
    const version = await loadVersion(env, args.scopeVersionId);
    if (!version) return fail("not_found");
    const refused = refuseUnlessDraftOpen(env, version);
    if (refused) return refused;
    // the gateway refuses null patches: "" clears the mark
    const patch = args.reviewed ? { ScreensReviewedAt: env.nowIso, ScreensReviewedBy: env.userId } : { ScreensReviewedAt: "", ScreensReviewedBy: "" };
    await env.db.update(SCHEMA.scopeVersion, version.id, patch);
    env.audit("scope-version", version.id, { number: version.number, screensReviewed: args.reviewed });
    return ok({ version: { ...rawVersion(version), ...patch, LastUpdatedDate: env.issuedStamp } });
  },
};

export const SUCCESS_HANDLERS: ScopeOpDef[] = [scopeSuccessSave, scopeSuccessAsk, scopeScreensReview] as ScopeOpDef[];
