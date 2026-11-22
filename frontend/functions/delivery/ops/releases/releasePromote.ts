import { defineDeliveryOp, fail, failFromRule, startEngineJob, strictArgs, idArg, stringArg } from "../common";
import type { ReadPorts } from "../ports";
import { countedStepRows, policyFromRows, readPolicyRows, readReleases, releaseStatesOf, requestsFromRows } from "../rows";
import { canPromote, defaultApprovalPolicy, policyGaps } from "../../../../src/domain/promotion";
import type { GatedEnvironment } from "../../../../src/domain/promotion";
import {
  changeRequestsToPromote,
  checkPromotionVersion,
  checkVersion,
  compareReleaseVersions,
  currentApprovalRequest,
} from "../../../../src/domain/delivery";
import { changesNotUsable, promotionBlockedBy } from "../../../../src/domain/afterDeploy";
import { checksSettled } from "../../../../src/domain/changeChecks";

/**
 * Everything the check needs, independent of one another: the request steps are read by project (not by the
 * request ids), so one round holds the lot and a prefetch can start it.
 */
const readPromotion = (ports: ReadPorts, projectId: string, env: GatedEnvironment) =>
  Promise.all([
    readReleases(ports, projectId),
    readPolicyRows(ports, projectId),
    ports.query("ApprovalRequest", { ProjectId: projectId, Environment: env }),
    ports.query("ApprovalStep", { ProjectId: projectId, ParentType: "request" }),
    ports.query("ChangeRequest", { ProjectId: projectId }),
    // the builds: a change whose own checks failed on dev is not usable there and is never promoted
    ports.query("EngineJob", { ProjectId: projectId, Kind: { in: ["build.run", "change.build"] } }),
  ]);

/**
 * release.promote: records a stage or production release once the current
 * approval policy is satisfied by the request for exactly this version, and
 * queues its deployment for the MADP engine (a preview.deploy job with the
 * environment, as the first release to dev). The engine puts the address on
 * the Release row once the version runs there; until then the page reads it
 * as being deployed, never as live.
 * Dev is never a target: dev releases come from the engine's build output.
 */
export const releasePromoteOp = defineDeliveryOp({
  permission: "release.promote",
  overlap: true,
  validate(raw) {
    const a = strictArgs(raw, ["projectId", "environment", "version"]);
    if (a.environment === "dev") {
      return fail("invalid_input", "delivery.release.devNotTarget", { field: "environment" });
    }
    if (a.environment !== "stage" && a.environment !== "production") {
      return fail("invalid_input", "invalid_input", { field: "environment" });
    }
    return {
      projectId: idArg(a.projectId, "projectId"),
      environment: a.environment as GatedEnvironment,
      version: stringArg(a.version, "version", 40),
    };
  },
  prefetch: (ports, args) => readPromotion(ports, args.projectId, args.environment),
  async handler(ctx, args) {
    const env = args.environment;
    const v = checkVersion(args.version);
    if (!v.ok) return failFromRule(v);

    // Round 1 (prefetched by the router): everything independent.
    const [releaseRows, { policyRows, policyStepRows }, requestRows, allRequestStepRows, crRows, jobRows] = await readPromotion(
      ctx.ports,
      ctx.projectId,
      env,
    );
    const released = releaseStatesOf(releaseRows);
    await ctx.authorized(); // the membership check ran alongside the reads
    const policy = policyFromRows(env, policyRows, policyStepRows);

    // The deployment of a recorded release: one engine job per environment and version (deduplicated).
    const queueDeploy = (releaseId: string) =>
      startEngineJob(ctx.ports, {
        workspaceId: ctx.workspaceId,
        projectId: ctx.projectId,
        kind: "preview.deploy",
        input: { projectId: ctx.projectId, environment: env, version: args.version, releaseId },
        dedupeKey: `preview.deploy:${env}:${ctx.projectId}:${args.version}`,
        createdByUserId: ctx.caller.userId ?? "",
      });

    // An interrupted promotion is completed from the stored Release row: every id still at the pre-promotion
    // status moves to promoted-<env> (never backwards), a release not deployed yet is queued again (deduplicated);
    // notify and audit are not repeated.
    const preStatus = env === "stage" ? ["released-dev"] : ["promoted-stage"];
    const finishPromotion = async (releaseRow: { ItemId: string; ChangeRequestIds?: unknown; Url?: unknown }) => {
      const stored = Array.isArray(releaseRow.ChangeRequestIds) ? releaseRow.ChangeRequestIds.map(String) : [];
      const statusOf = new Map(crRows.map((c) => [String(c.ItemId), String(c.Status)]));
      await Promise.all([
        ...stored
          .filter((id) => preStatus.includes(statusOf.get(id) ?? ""))
          .map((id) => ctx.ports.update("ChangeRequest", id, ctx.touch({ Status: `promoted-${env}` }))),
        ...(String(releaseRow.Url ?? "") ? [] : [queueDeploy(String(releaseRow.ItemId))]),
      ]);
      return {
        releaseId: String(releaseRow.ItemId),
        existing: true,
        environment: env,
        version: args.version,
        changeRequestIds: stored,
      };
    };

    // (a) idempotent: this version is already released to this environment.
    const already = released.rows.find((r) => r.Environment === env && r.Version === args.version);
    if (already) {
      return finishPromotion(already);
    }

    const pv = checkPromotionVersion(released.states, env, args.version);
    if (!pv.ok) return failFromRule(pv);

    // only green builds move on: a version that carries the code of a change whose own checks failed on dev (and that
    // was not fixed or taken off again) is not usable, so it is not promoted
    const s = (v: unknown) => (typeof v === "string" ? v : "");
    // a change whose every failing check a person marked "known before this change", or whose every failing check
    // passes since on a later version of dev (any change's run judged it), is not the blocker
    const broken = changesNotUsable(jobRows.map((j) => ({ id: s(j.ItemId), kind: s(j.Kind), status: s(j.Status), errorCode: s(j.ErrorCode), finishedAt: s(j.FinishedAt), inputJson: s(j.InputJson) })),
      checksSettled(crRows.map((c) => ({ id: String(c.ItemId), checks: c.Checks }))));
    const blocker = promotionBlockedBy(args.version, broken, releaseRows.filter((r) => r.Environment === "dev").map((r) => ({ version: s(r.Version), engineJobId: s(r.EngineJobId) })), compareReleaseVersions);
    if (blocker) {
      const cr = crRows.find((c) => c.ItemId === blocker);
      fail("invalid_input", "delivery.release.checksFailed", { field: "version", ...(cr ? { changeNumber: Number(cr.Number) } : {}) });
    }

    // C1: a complete approval policy is the owner minimum for stage and production.
    const gaps = policy.status === "ok" ? policyGaps(env, policy.policy) : [];
    if (policy.status !== "ok" || gaps.length > 0) {
      const dflt = canPromote(defaultApprovalPolicy(env), null);
      const missing = policy.status !== "ok" ? (dflt.ok ? [] : dflt.missing) : gaps;
      return fail("approval_required", "delivery.release.approvalRequired", { environment: env, missing });
    }
    const requestIds = new Set(requestRows.map((r) => r.ItemId));
    const requestStepRows = allRequestStepRows.filter((s) => requestIds.has(String(s.ParentId)));
    // Separation of duties: a step decided by the request's own requester counts only while no other active approver
    // of that step exists (the one-person fallback of approvalRequest.decide).
    const requesterOf = new Map(requestRows.map((r) => [r.ItemId, r.RequestedByUserId]));
    const countedSteps = countedStepRows(requestStepRows, (id) => requesterOf.get(id), ctx.activeMemberIds);
    const selfApproved = countedSteps.some((s, i) => s.Decision !== requestStepRows[i]!.Decision);
    const req = currentApprovalRequest(requestsFromRows(requestRows, countedSteps), env, args.version);
    const check = canPromote(policy.policy, req?.request ?? null, args.version);
    if (!check.ok || !req) {
      const missing = check.ok ? [] : check.missing;
      return fail(
        "approval_required",
        selfApproved && missing.length > 0 ? "delivery.approvals.ownRequest" : "delivery.release.approvalRequired",
        { missing },
      );
    }

    const crs = changeRequestsToPromote(
      crRows.map((c) => ({ id: String(c.ItemId), status: String(c.Status), version: String(c.Version ?? "") || null })),
      env,
      args.version,
    );
    const changeRequestIds = crs.map((c) => c.id);

    // No URL is invented here: the deployment is engine work (queued below). The Release page shows the row as
    // being deployed until the engine writes its address.
    let releaseId: string;
    let existing = false;
    // The Release row is written FIRST (idempotent by RequestKey): a failing insert leaves every change request untouched.
    try {
      const ins = await ctx.ports.insert(
        "Release",
        ctx.stamp({
          ProjectId: ctx.projectId,
          Environment: env,
          Version: args.version,
          Url: "",
          Status: "released",
          ChangeRequestIds: changeRequestIds,
          ApprovalRequestId: req.id,
          ReleasedAt: ctx.now,
          ReleasedByUserId: ctx.caller.userId,
        }),
        { requestKey: ctx.requestKey() },
      );
      releaseId = ins.itemId;
      existing = ins.existing;
    } catch (e) {
      if (!ctx.ports.isDuplicateKey(e)) throw e;
      const rows = await ctx.ports.query("Release", { ProjectId: ctx.projectId, Environment: env, Version: args.version });
      if (!rows[0]) throw e;
      return finishPromotion(rows[0]);
    }
    if (existing) {
      const rows = await ctx.ports.query("Release", { ProjectId: ctx.projectId, Environment: env, Version: args.version });
      return rows[0] ? finishPromotion(rows[0]) : { releaseId, existing: true, environment: env, version: args.version, changeRequestIds };
    }

    const owner = String(ctx.project.AssigneeUserId || ctx.project.CreatedByUserId || "");
    const approvers = req.request.steps.flatMap((s) => [...s.approverUserIds]);
    const recipients = [...new Set([owner, ctx.caller.userId, ...approvers].filter(Boolean))];
    // A rejected update fails the op (retryable, never finished): the Release exists, so the retry completes the promotion.
    await Promise.all([
      ...changeRequestIds.map((id) => ctx.ports.update("ChangeRequest", id, ctx.touch({ Status: `promoted-${env}` }))),
      queueDeploy(releaseId),
      ctx.notify(recipients, "release.promoted", { version: args.version }, env),
      ctx.audit("release.promote", "Release", releaseId, {
        environment: env,
        version: args.version,
        changeRequests: changeRequestIds.length,
        approvalRequestId: req.id,
        // approvals the requester gave themselves as the only approver (approvalRequest.decide)
        selfApprovals: req.request.steps.filter((s) => s.decision === "approved" && !!s.decidedBy && s.decidedBy === req.requestedByUserId).length,
      }),
    ]);
    return { releaseId, existing: false, environment: env, version: args.version, changeRequestIds };
  },
});
