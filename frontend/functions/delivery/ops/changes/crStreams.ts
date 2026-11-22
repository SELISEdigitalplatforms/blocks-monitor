/**
 * Parallel streams on the delivery ops (src/domain/parallelStreams.ts).
 *
 * cr.parallelStreams: the person's choice of how many independent change requests build side by side (1..5), never
 * above what the product's set-up allows (the engine host's advice; the page and the tech lead's chat offer only up to
 * the tech lead's suggestion, suggestStreams).
 * business.edit or build.run holders only. Stored in Project.ParallelStreams with the suggestion it was chosen from.
 *
 * readStreams / streamsLimit: the streams in use for the ops that start a build (cr.startBuild, cr.fixChecks,
 * build.retryAfterDeploy): with more than one, a build of another change is queued while builds run (the engine starts it
 * when the plan lets it); with one, "another build is running" as before. A tenant without the fields (its migration not
 * applied yet) answers one stream.
 */
import { defineDeliveryOp, fail, strictArgs, idArg } from "../common";
import type { ReadPorts, Row } from "../ports";
import { parseContinueSetting, serializeContinueSetting, type ContinueSetting } from "../../../../src/domain/continueIncrements";
import {
  MAX_STREAMS, parseStreamsAdvice, parseStreamsChoice, serializeStreamsChoice, streamsInUse, suggestStreams, type StreamChange, type StreamsChoice,
} from "../../../../src/domain/parallelStreams";

const s = (v: unknown): string => (typeof v === "string" ? v : "");

/** The project's stream fields, read on their own (a tenant without them answers null: one stream). */
export const readStreams = (ports: ReadPorts, projectId: string): Promise<Row | null> =>
  ports.query("Project", { ItemId: projectId }, { fields: ["ParallelStreams", "StreamsAdvice"], limit: 1 }).then((rows) => rows[0] ?? null, () => null);

/** The streams in use (1 without a choice or the fields). */
export const streamsLimit = (row: Row | null): number => streamsInUse(parseStreamsChoice(row?.ParallelStreams), parseStreamsAdvice(row?.StreamsAdvice));

const readChanges = (ports: ReadPorts, projectId: string) =>
  ports.query("ChangeRequest", { ProjectId: projectId }, { fields: ["Lane", "Number", "Title", "Status", "Analysis"] });

export const streamChangeOf = (c: Row): StreamChange => ({
  id: s(c.ItemId), lane: s(c.Lane), number: typeof c.Number === "number" ? c.Number : 1, title: s(c.Title), status: s(c.Status), analysis: c.Analysis ?? null,
});

export const crParallelStreamsOp = defineDeliveryOp({
  permission: ["business.edit", "build.run"],
  validate(raw: unknown) {
    const a = strictArgs(raw, ["projectId", "chosen"]);
    const n = a.chosen;
    if (typeof n !== "number" || !Number.isInteger(n) || n < 1 || n > MAX_STREAMS) fail("invalid_input", "delivery.args.invalid", { field: "chosen" });
    return { projectId: idArg(a.projectId, "projectId"), chosen: n as number };
  },
  prefetch: (ports: ReadPorts, args: { projectId: string }) => Promise.all([readStreams(ports, args.projectId), readChanges(ports, args.projectId)]),
  async handler(ctx, args: { projectId: string; chosen: number }) {
    const [row, changes] = await Promise.all([readStreams(ctx.ports, ctx.projectId), readChanges(ctx.ports, ctx.projectId)]);
    const suggestion = suggestStreams({ changes: (changes as Row[]).map(streamChangeOf), advice: parseStreamsAdvice(row?.StreamsAdvice) });
    // never above what the product's set-up allows (the page and the chat offer only up to the tech lead's suggestion,
    // which the page holds steady while it is open; the waiting changes may have moved since)
    if (args.chosen > suggestion.cap) fail("invalid_input", "delivery.streams.aboveSuggestion", { suggested: suggestion.cap });
    const choice: StreamsChoice = { v: 1, chosen: args.chosen, suggested: suggestion.suggested, reason: suggestion.reason, by: ctx.caller.userId, at: ctx.now };
    await ctx.ports.update("Project", ctx.projectId, ctx.touch({ ParallelStreams: serializeStreamsChoice(choice) }));
    await ctx.after(() => ctx.audit("cr.parallelStreams", "Project", ctx.projectId, { chosen: args.chosen, suggested: suggestion.suggested }));
    return { streams: parseStreamsChoice(serializeStreamsChoice(choice)), suggestion };
  },
});

/**
 * cr.continueIncrements: "Continue with the next increment when the checks pass" on or off for the project
 * (Project.ContinueIncrements, src/domain/continueIncrements.ts). business.edit or build.run holders only.
 */
export const crContinueIncrementsOp = defineDeliveryOp({
  permission: ["business.edit", "build.run"],
  validate(raw: unknown) {
    const a = strictArgs(raw, ["projectId", "on"]);
    if (typeof a.on !== "boolean") fail("invalid_input", "delivery.args.invalid", { field: "on" });
    return { projectId: idArg(a.projectId, "projectId"), on: a.on as boolean };
  },
  async handler(ctx, args: { projectId: string; on: boolean }) {
    const setting: ContinueSetting = { v: 1, on: args.on, by: ctx.caller.userId, at: ctx.now };
    const value = serializeContinueSetting(setting);
    await ctx.ports.update("Project", ctx.projectId, ctx.touch({ ContinueIncrements: value }));
    await ctx.after(() => ctx.audit("cr.continueIncrements", "Project", ctx.projectId, { on: args.on }));
    return { continueIncrements: parseContinueSetting(value) };
  },
});
