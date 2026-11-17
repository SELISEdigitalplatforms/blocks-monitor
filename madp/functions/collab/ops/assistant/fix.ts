// "Start the fix" server steps around L8's cr.saveDraft / cr.startBuild: claim, record, release, decline.
import { defineOp, f, v } from "../../../_lib";
import type { OpCtx, OpDeps, Row } from "../../../_lib";
import { FIX_DECLINED_TEXT, canFixTransition, fixDraftFrom, fixFollowUpText, parseAnalysis } from "../../../../src/domain/assistant";
import type { FixState } from "../../../../src/domain/assistant";
import { changeCode } from "../../../../src/domain/delivery";
import { projectArgs } from "../common/args";
import { childOf, liveProject } from "../common/loaders";
import { MSG } from "../common/messages";
import { FIELDS, SCHEMA, isoPlus, num, pick, str } from "../common/records";
import { prefetchChild, warm } from "../wiki/savePath";
import { assistantRow } from "./facts";

const fixState = (m: Row): FixState => {
  const s = str(m, "FixState");
  return s === "offered" || s === "started" || s === "declined" ? s : "none";
};

/** Insert one assistant row under a per-command key. A repeat of the same key answers with the stored id (nothing is read back). */
async function insertOnce(deps: OpDeps, row: Row, key: string): Promise<Row> {
  const res = await deps.gw.insert(SCHEMA.assistant, row, { key });
  return res.itemId ? { ...row, ItemId: res.itemId } : deps.fail("conflict");
}

const prefetchMessage = (p: Parameters<typeof prefetchChild>[0], projectId: string, messageId: string): Promise<void> =>
  warm(prefetchChild(p, SCHEMA.assistant, messageId, "ProjectId", projectId, FIELDS.assistant));

async function loadAnalysis(ctx: OpCtx, deps: OpDeps, projectId: string, messageId: string): Promise<Row> {
  const [, message] = await Promise.all([liveProject(ctx, deps), childOf(deps, SCHEMA.assistant, messageId, projectId, FIELDS.assistant)]);
  if (str(message, "Role") !== "assistant" || str(message, "Kind") !== "analysis") return deps.fail("invalid_input", MSG.assistantNotAnalysis);
  return message;
}

const CLAIMABLE: FixState[] = (["offered", "declined"] as const).filter((s) => canFixTransition(s, "started", false));

const audited = (deps: OpDeps, messageId: string, details: Record<string, string>): void =>
  deps.audit({ targetType: "assistant-message", targetId: messageId, details });

const started = (deps: OpDeps, m: Row): never =>
  deps.fail("conflict", MSG.assistantFixStarted, { changeRequestId: str(m, "FixChangeRequestId") });

export const ASSISTANT_FIX_OPS = [
  defineOp({
    op: "assistant.fix.claim",
    kind: "command",
    scope: "project",
    permission: "build.run",
    args: projectArgs({ messageId: v.id() }),
    prefetch: (p) => prefetchMessage(p, p.args.projectId, p.args.messageId),
    async handler(ctx, args, deps) {
      const message = await loadAnalysis(ctx, deps, args.projectId, args.messageId);
      const analysis = parseAnalysis(str(message, "AnalysisJson"));
      if (!analysis) return deps.fail("invalid_input", MSG.assistantNotAnalysis);
      const state = fixState(message);
      const hasCr = str(message, "FixChangeRequestId") !== "";
      if (state === "started") {
        if (hasCr) return started(deps, message);
        if (str(message, "UpdatedByUserId") !== ctx.caller.userId) return deps.fail("conflict", MSG.assistantFixStarting);
        return { message: pick(message, FIELDS.assistant), draft: fixDraftFrom(analysis) };
      }
      if (!canFixTransition(state, "started", false)) return deps.fail("invalid_input", MSG.assistantNotAnalysis);
      // The conditional write is the guard: the gateway applies a filter update atomically per row, so one concurrent claim wins.
      const r = await deps.gw.updateMany(
        SCHEMA.assistant,
        f.and(f.eq("ItemId", args.messageId), f.in("FixState", CLAIMABLE)),
        { FixState: "started", FixChangeRequestId: "" },
      );
      if (r.matched === 0) return deps.fail("conflict", MSG.assistantFixStarting);
      if (r.matched === null) {
        const again = await childOf(deps, SCHEMA.assistant, args.messageId, args.projectId, FIELDS.assistant);
        if (fixState(again) !== "started" || str(again, "UpdatedByUserId") !== ctx.caller.userId) return deps.fail("conflict", MSG.assistantFixStarting);
      }
      audited(deps, args.messageId, { fixState: "started" });
      const next = { ...message, FixState: "started", FixChangeRequestId: "", UpdatedByUserId: ctx.caller.userId };
      return { message: pick(next, FIELDS.assistant), draft: fixDraftFrom(analysis) };
    },
  }),

  defineOp({
    op: "assistant.fix.record",
    kind: "command",
    scope: "project",
    permission: "build.run",
    args: projectArgs({ messageId: v.id(), changeRequestId: v.id() }),
    prefetch: (p) =>
      warm(
        prefetchMessage(p, p.args.projectId, p.args.messageId),
        prefetchChild(p, SCHEMA.changeRequest, p.args.changeRequestId, "ProjectId", p.args.projectId, [
          "ItemId", "Number", "Lane", "Title", "Status", "Version", "RequestedByUserId",
        ]),
      ),
    async handler(ctx, args, deps) {
      const [, message, cr] = await Promise.all([
        liveProject(ctx, deps),
        childOf(deps, SCHEMA.assistant, args.messageId, args.projectId, FIELDS.assistant),
        childOf(deps, SCHEMA.changeRequest, args.changeRequestId, args.projectId, [
          "ItemId", "Number", "Lane", "Title", "Status", "Version", "RequestedByUserId",
        ]),
      ]);
      if (str(message, "Role") !== "assistant" || str(message, "Kind") !== "analysis") return deps.fail("invalid_input", MSG.assistantNotAnalysis);
      const recorded = str(message, "FixChangeRequestId");
      if (fixState(message) !== "started" || (recorded !== "" && recorded !== args.changeRequestId)) {
        if (recorded !== "") return started(deps, message);
        return deps.fail("conflict", MSG.assistantFixStarting);
      }
      if (str(cr, "RequestedByUserId") !== ctx.caller.userId) return deps.fail("forbidden");
      if (str(cr, "Lane") !== "fix" || !["draft", "analysing", "questions", "review", "approved", "building"].includes(str(cr, "Status"))) {
        return deps.fail("invalid_input", MSG.assistantWrongChange);
      }
      if (recorded === args.changeRequestId) return { message: pick(message, FIELDS.assistant), followUp: null };

      const crView = { lane: "fix", number: num(cr, "Number"), status: str(cr, "Status"), version: str(cr, "Version") };
      const patch = { FixChangeRequestId: args.changeRequestId, FixCode: changeCode(crView), FixVersion: str(cr, "Version") };
      // One round: the follow-up message and the link on the analysis are independent writes.
      const [followUp] = await Promise.all([
        insertOnce(
          deps,
          assistantRow(args.projectId, str(message, "Environment"), "assistant", fixFollowUpText(crView), ctx.now.toISOString()),
          "followUp",
        ),
        deps.gw.update(SCHEMA.assistant, args.messageId, patch),
      ]);
      audited(deps, args.messageId, { changeRequestId: args.changeRequestId });
      return {
        message: pick({ ...message, ...patch, UpdatedByUserId: ctx.caller.userId }, FIELDS.assistant),
        followUp: pick(followUp, FIELDS.assistant),
      };
    },
  }),

  defineOp({
    op: "assistant.fix.release",
    kind: "command",
    scope: "project",
    permission: "build.run",
    args: projectArgs({ messageId: v.id() }),
    prefetch: (p) => prefetchMessage(p, p.args.projectId, p.args.messageId),
    async handler(ctx, args, deps) {
      const message = await loadAnalysis(ctx, deps, args.projectId, args.messageId);
      const state = fixState(message);
      if (state === "offered") return { message: pick(message, FIELDS.assistant) };
      if (state === "started" && str(message, "FixChangeRequestId") !== "") return started(deps, message);
      if (!canFixTransition(state, "offered", false)) return deps.fail("conflict", MSG.assistantNotAnalysis);
      deps.after(() => deps.gw.update(SCHEMA.assistant, args.messageId, { FixState: "offered" }));
      audited(deps, args.messageId, { fixState: "offered" });
      return { message: pick({ ...message, FixState: "offered", UpdatedByUserId: ctx.caller.userId }, FIELDS.assistant) };
    },
  }),

  defineOp({
    op: "assistant.fix.decline",
    kind: "command",
    scope: "project",
    permission: "build.run",
    args: projectArgs({ messageId: v.id() }),
    prefetch: (p) => prefetchMessage(p, p.args.projectId, p.args.messageId),
    async handler(ctx, args, deps) {
      const message = await loadAnalysis(ctx, deps, args.projectId, args.messageId);
      const state = fixState(message);
      if (state === "declined") return { message: pick(message, FIELDS.assistant) };
      if (state === "started") return started(deps, message);
      if (!canFixTransition(state, "declined", false)) return deps.fail("invalid_input", MSG.assistantNotAnalysis);
      const [note] = await Promise.all([
        insertOnce(deps, assistantRow(args.projectId, str(message, "Environment"), "assistant", FIX_DECLINED_TEXT, isoPlus(ctx.now, 1)), "note"),
        deps.gw.update(SCHEMA.assistant, args.messageId, { FixState: "declined" }),
      ]);
      audited(deps, args.messageId, { fixState: "declined" });
      return {
        message: pick({ ...message, FixState: "declined", UpdatedByUserId: ctx.caller.userId }, FIELDS.assistant),
        note: pick(note, FIELDS.assistant),
      };
    },
  }),
];
