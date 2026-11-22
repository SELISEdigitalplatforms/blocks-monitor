/**
 * cr.fixChecks: a person's answer to a change whose own checks failed after its deploy (src/domain/changeChecks.ts).
 *   - action "fix" ("Fix what the checks found"): a fix round of the same change, a change.build with { fixChecks: true,
 *     afterJobId, baseJobId, round, auto: false, version }: the change, the failing checks with their output, the
 *     deployed commits and the rule go to the development team; the same gates, deploy and checks run; a patch version.
 *   - action "revert" ("Put development back"): development back to the last build whose checks passed, a change.build
 *     with { revertChecks: true, afterJobId, baseJobId, auto: false, version }; the change goes back to "approved".
 * Only while the change's newest delivered build still has checks that did not pass (openAttention: accept-failed);
 * one delivery job at a time, as for every build; a second click while it runs answers that job.
 *
 * cr.checksPolicy: the project's policy (Project.ChecksPolicy): how many fix rounds the engine starts by itself after a
 * build whose checks failed (0 to MAX_AUTO_FIX_ROUNDS), and whether it then puts development back by itself.
 *
 * cr.markKnown: a person marks a failing check of the change "known before this change" with a short reason (action
 * "mark"), or takes the mark back ("unmark"). Stored on the change's checks record (ChangeRequest.Checks marks): from
 * then on it is never the change's failure, never a fix round's target, and the change's newest failing build counts
 * without it (a build whose every failing check is marked is usable, never blocks the next build or a promotion);
 * every later build hands the marks to the engine (`madp accept --known`), which still calls a NEW failure of that
 * file the change's. Only a check that failed in one of the change's builds can be marked.
 */
import { defineDeliveryOp, fail, idArg, startEngineJob, strictArgs } from "../common";
import type { ReadPorts, Row } from "../ports";
import { readReleases } from "../rows";
import { deliveryTargetOf, newestDelivered, openAttention, type AfterDeployJob } from "../../../../src/domain/afterDeploy";
import {
  MARK_REASON_MAX, MAX_AUTO_FIX_ROUNDS, baseJobOf, checksCleared, checksPolicyOf, fixRoundInput, fixRoundOf, markOf, nextRound, parseChangeChecks, revertInput, revertOf,
  serializeChangeChecks, serializeChecksPolicy, withMark, withoutMark,
} from "../../../../src/domain/changeChecks";
import { fixRoundVersion, takenVersions } from "../../../../src/domain/delivery";
import { mayQueueBuild } from "../../../../src/domain/parallelStreams";
import { readStreams, streamsLimit } from "./crStreams";

const ACTIVE = new Set(["queued", "claimed", "running"]);
const s = (v: unknown): string => (typeof v === "string" ? v : "");

const readJobs = (ports: ReadPorts, projectId: string) =>
  ports.query("EngineJob", { ProjectId: projectId, Kind: { in: ["build.run", "change.build", "preview.deploy"] } });
const readChanges = (ports: ReadPorts, projectId: string) => ports.query("ChangeRequest", { ProjectId: projectId });

const view = (j: Row): AfterDeployJob & { inputJson: string } => ({
  id: s(j.ItemId), kind: s(j.Kind), status: s(j.Status), errorCode: s(j.ErrorCode), finishedAt: s(j.FinishedAt), inputJson: s(j.InputJson),
});

type Action = "fix" | "revert";

export const crFixChecksOp = defineDeliveryOp({
  permission: "build.run",
  overlap: true,
  validate(raw: unknown) {
    const a = strictArgs(raw, ["projectId", "changeRequestId", "action"]);
    const action = a.action === undefined ? "fix" : a.action;
    if (action !== "fix" && action !== "revert") fail("invalid_input", "delivery.args.invalid", { field: "action" });
    return { projectId: idArg(a.projectId, "projectId"), changeRequestId: idArg(a.changeRequestId, "changeRequestId"), action: action as Action };
  },
  prefetch: (ports: ReadPorts, args: { projectId: string; changeRequestId: string }) =>
    Promise.all([ports.getById("ChangeRequest", args.changeRequestId), readJobs(ports, args.projectId), readReleases(ports, args.projectId), readChanges(ports, args.projectId), readStreams(ports, args.projectId)]),
  async handler(ctx, args: { projectId: string; changeRequestId: string; action: Action }) {
    const { ports, projectId, workspaceId } = ctx;
    const { changeRequestId, action } = args;
    const [cr, rows, releases, changes, streams] = (await Promise.all([
      ports.getById("ChangeRequest", changeRequestId), readJobs(ports, projectId), readReleases(ports, projectId), readChanges(ports, projectId), readStreams(ports, projectId),
    ])) as [Row | null, Row[], Row[], Row[], Row | null];
    await ctx.authorized(); // the membership check ran alongside the reads
    if (!cr || cr.ProjectId !== projectId || (cr.WorkspaceId && cr.WorkspaceId !== workspaceId)) fail("not_found", "delivery.cr.notFound");

    const jobs = rows.map(view);
    const mine = (j: { kind: string; inputJson: string }) => j.kind === "change.build" && deliveryTargetOf(j) === changeRequestId;
    // a round or a revert of this change on its way already: answer it (a double click, a replay)
    const running = jobs.find((j) => ACTIVE.has(j.status) && mine(j) && (action === "fix" ? fixRoundOf(j) : revertOf(j)));
    if (running) return { jobId: running.id, existing: true, action, jobStatus: running.status };
    // parallel streams: queued beside other changes' builds (the engine runs it in the merge turn); one stream: alone
    const room = mayQueueBuild({ jobs, limit: streamsLimit(streams), targetId: changeRequestId });
    if (!room.ok || jobs.some((j) => j.kind === "preview.deploy" && ACTIVE.has(j.status))) fail("conflict", "delivery.build.active");

    // only while the change's newest delivered build still has checks that did not pass
    const own = newestDelivered(jobs, mine);
    const open = own ? openAttention(own, newestDelivered(jobs)) : null;
    if (!own || !open || !open.issues.includes("accept-failed")) return fail("invalid_input", "delivery.checks.nothingFailed");
    // every check that failed is marked "known before this change": nothing of the change's to fix
    if (action === "fix" && checksCleared(cr.Checks, own.id)) return fail("invalid_input", "delivery.checks.nothingFailed");

    const taken = takenVersions({ releases: releases.map((r) => r.Version as string), changes: changes.map((c) => c.Version as string), jobs });
    const version = fixRoundVersion(taken) ?? "";
    let started: { jobId: string; existing: boolean; status: string };
    let round = 0;
    if (action === "fix") {
      const next = nextRound(jobs, own);
      round = next.round;
      started = await startEngineJob(ports, {
        workspaceId, projectId, kind: "change.build",
        input: fixRoundInput(projectId, { changeRequestId, afterJobId: own.id, baseJobId: next.baseJobId, round, auto: false, version }),
        dedupeKey: `change.build:fix:${changeRequestId}:${next.baseJobId}:${round}`,
        createdByUserId: ctx.caller.userId,
        // one active round per build it follows (the engine queues automatic ones the same way)
        target: { type: "EngineJob", id: own.id },
      }, { field: "changeRequestId", id: changeRequestId });
    } else {
      const base = baseJobOf(own, jobs);
      const earlier = jobs.filter((j) => revertOf(j)?.baseJobId === base);
      if (earlier.some((j) => j.status === "succeeded")) fail("invalid_input", "delivery.checks.reverted");
      started = await startEngineJob(ports, {
        workspaceId, projectId, kind: "change.build",
        input: revertInput(projectId, { changeRequestId, afterJobId: own.id, baseJobId: base, auto: false, version }),
        dedupeKey: `change.build:revert:${changeRequestId}:${base}:${earlier.length + 1}`,
        createdByUserId: ctx.caller.userId,
        target: { type: "EngineJob", id: own.id },
      }, { field: "changeRequestId", id: changeRequestId });
    }
    if (!started.existing) {
      await ctx.after(() => ctx.audit("cr.fixChecks", "ChangeRequest", changeRequestId, { action, jobId: started.jobId, afterJobId: own.id, ...(round ? { round } : {}), version }));
    }
    return { jobId: started.jobId, existing: started.existing, action, jobStatus: started.status, ...(round ? { round } : {}), version };
  },
});

export const crChecksPolicyOp = defineDeliveryOp({
  permission: "build.run",
  validate(raw: unknown) {
    const a = strictArgs(raw, ["projectId", "autoFixRounds", "autoRevert"]);
    const rounds = a.autoFixRounds;
    if (typeof rounds !== "number" || !Number.isInteger(rounds) || rounds < 0 || rounds > MAX_AUTO_FIX_ROUNDS) fail("invalid_input", "delivery.args.invalid", { field: "autoFixRounds" });
    if (typeof a.autoRevert !== "boolean") fail("invalid_input", "delivery.args.invalid", { field: "autoRevert" });
    return { projectId: idArg(a.projectId, "projectId"), autoFixRounds: rounds as number, autoRevert: a.autoRevert as boolean };
  },
  async handler(ctx, args: { projectId: string; autoFixRounds: number; autoRevert: boolean }) {
    const value = serializeChecksPolicy({ autoFixRounds: args.autoFixRounds, autoRevert: args.autoRevert });
    await ctx.ports.update("Project", ctx.projectId, ctx.touch({ ChecksPolicy: value }));
    await ctx.after(() => ctx.audit("cr.checksPolicy", "Project", ctx.projectId, { autoFixRounds: args.autoFixRounds, autoRevert: args.autoRevert }));
    return { policy: checksPolicyOf(value) };
  },
});

type MarkAction = "mark" | "unmark";
const SAFE_NAME = /^(?![/\\])(?!.*(?:^|\/)\.\.(?:\/|$))[^\s,]{1,160}$/;

export const crMarkKnownOp = defineDeliveryOp({
  permission: "build.run",
  validate(raw: unknown) {
    const a = strictArgs(raw, ["projectId", "changeRequestId", "repo", "name", "reason", "action"]);
    const action = a.action === undefined ? "mark" : a.action;
    if (action !== "mark" && action !== "unmark") fail("invalid_input", "delivery.args.invalid", { field: "action" });
    const repo = typeof a.repo === "string" ? a.repo.trim() : "";
    if (!/^[A-Za-z0-9_.-]{0,40}$/.test(repo)) fail("invalid_input", "delivery.args.invalid", { field: "repo" });
    const name = typeof a.name === "string" ? a.name.trim() : "";
    if (!SAFE_NAME.test(name)) fail("invalid_input", "delivery.args.invalid", { field: "name" });
    const reason = typeof a.reason === "string" ? a.reason.replace(/\s+/g, " ").trim() : "";
    if (action === "mark" && (reason.length < 3 || reason.length > MARK_REASON_MAX)) fail("invalid_input", "delivery.checks.markReason", { field: "reason" });
    return { projectId: idArg(a.projectId, "projectId"), changeRequestId: idArg(a.changeRequestId, "changeRequestId"), repo, name, reason, action: action as MarkAction };
  },
  prefetch: (ports: ReadPorts, args: { projectId: string; changeRequestId: string }) => ports.getById("ChangeRequest", args.changeRequestId),
  async handler(ctx, args: { projectId: string; changeRequestId: string; repo: string; name: string; reason: string; action: MarkAction }) {
    const { ports, projectId, workspaceId } = ctx;
    const cr = (await ports.getById("ChangeRequest", args.changeRequestId)) as Row | null;
    await ctx.authorized();
    if (!cr || cr.ProjectId !== projectId || (cr.WorkspaceId && cr.WorkspaceId !== workspaceId)) fail("not_found", "delivery.cr.notFound");
    const record = parseChangeChecks(cr!.Checks);
    const check = { repo: args.repo, name: args.name };
    if (args.action === "unmark") {
      if (!markOf(record, check)) return { action: args.action, marked: false, existing: true, checks: typeof cr!.Checks === "string" ? cr!.Checks : "" };
      const checks = serializeChangeChecks(withoutMark(record, check));
      await ports.update("ChangeRequest", args.changeRequestId, ctx.touch({ Checks: checks }));
      await ctx.after(() => ctx.audit("cr.markKnown", "ChangeRequest", args.changeRequestId, { action: "unmark", repo: args.repo, name: args.name }));
      return { action: args.action, marked: false, existing: false, checks };
    }
    // only a check that failed in one of the change's builds (the newest such run names the commit it ran on)
    const run = [...(record?.runs ?? [])].reverse().find((r) => r.failing.some((f) => f.name === args.name && (!args.repo || !f.repo || f.repo === args.repo)));
    if (!run) return fail("invalid_input", "delivery.checks.markUnknownCheck", { field: "name" });
    const failing = run.failing.find((f) => f.name === args.name && (!args.repo || !f.repo || f.repo === args.repo))!;
    const repo = args.repo || failing.repo;
    const commit = run.commits.length === 1 ? run.commits[0]! : "";
    const next = withMark(record, { repo, name: args.name, reason: args.reason, byUserId: ctx.caller.userId, at: new Date().toISOString(), jobId: run.jobId, commit });
    const checks = serializeChangeChecks(next);
    await ports.update("ChangeRequest", args.changeRequestId, ctx.touch({ Checks: checks }));
    await ctx.after(() => ctx.audit("cr.markKnown", "ChangeRequest", args.changeRequestId, { action: "mark", repo, name: args.name, jobId: run.jobId }));
    // the stored record goes back with the answer: the page shows it at once (a read right after can still be the old one)
    return { action: args.action, marked: true, existing: false, jobId: run.jobId, checks };
  },
});
