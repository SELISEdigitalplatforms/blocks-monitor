/**
 * sanitization.complete: freezes Requirements v1 and moves the journey to Requirements & objective.
 * Order matters (no transactions): the ItemVersion N=1 rows first, the Project step last, so a
 * retry after a partial run completes the rest without duplicates.
 */
import { isTerminal, parseOutputRef } from "../../../../src/domain/engineJob";
import type { EngineJobStatus } from "../../../../src/domain/engineJob";
import { factoryNote } from "../../../../src/domain/factoryNotes";
import { journeyStep } from "../../../../src/domain/journey";
import {
  completionBlockers,
  projectPaused,
  stepStateFromProject,
  v1VersionRows,
} from "../../../../src/domain/sanitization";
import type { OpContext, OpResult, OpTable, ReadEnv, Row } from "./ports";
import { fail, fromCheck, gate, ok, requirePermission, withReads } from "./common";

/** The reads of the first completion (shared with the prefetch, so they cost no round of their own). */
function readSet(env: Pick<ReadEnv, "gateway" | "project">) {
  const project = env.project;
  return Promise.all([
    env.gateway.list("Clarification", { ProjectId: project.ItemId }, { fields: ["ItemId", "Status"], max: 500 }),
    env.gateway.list("Requirement", { ProjectId: project.ItemId }, { max: 300 }),
    env.gateway.list("Objective", { ProjectId: project.ItemId }, { first: 1 }),
    env.gateway.list(
      "EngineJob",
      { ProjectId: project.ItemId, Kind: "requirements.draft" },
      { sort: [{ field: "CreatedDate", dir: "desc" }], first: 50 },
    ),
  ]);
}

async function complete(_args: Record<string, unknown>, ctx: OpContext): Promise<OpResult> {
  const refused = gate(ctx, "complete") ?? requirePermission(ctx, "sanitization.edit");
  if (refused) return refused;
  const project = ctx.project;
  if (projectPaused({ stage: String(project.Stage) })) return fail("invalid_input", "sanitization.paused");

  const state = stepStateFromProject({
    stage: String(project.Stage),
    resumeTo: typeof project.ResumeTo === "string" && project.ResumeTo !== "" ? project.ResumeTo : undefined,
  });
  if (!state) return fail("invalid_input", "sanitization.unavailable");
  if (state.step !== "sanitization") {
    const [done, rows] = await Promise.all([
      ctx.gateway.findMine("ItemVersion", "v1:objective:main"),
      ctx.gateway.list("ItemVersion", { ProjectId: project.ItemId, N: 1 }, { fields: ["ItemId"], max: 1000 }),
    ]);
    if (!done) return fail("invalid_input", "sanitization.alreadyComplete");
    // Re-emit with the same eventKey: a retry after a failed flush still delivers, and nobody gets two rows.
    ctx.notify(factoryNote("requirements.ready", { projectId: String(project.ItemId), discriminator: "v1", withActor: false }));
    return ok({ stage: "requirements", versions: rows.length });
  }

  const [clarifications, requirements, objectives, jobs] = await readSet(ctx);
  const objective = objectives[0] ?? null;
  const newest = jobs[0];
  const activeDraftJob =
    newest && !isTerminal(newest.Status as EngineJobStatus)
      ? { id: newest.ItemId as string, status: newest.Status as string }
      : null;

  const blockers = completionBlockers({
    clarifications: clarifications.map((c) => ({ status: c.Status as string })),
    requirements: requirements.map((r) => ({
      number: r.Number as number,
      title: (r.Title as string) ?? "",
      acceptanceCriteria: (r.AcceptanceCriteria as string[]) ?? [],
    })),
    objective: objective ? { statement: (objective.Statement as string) ?? "" } : null,
    activeDraftJob,
  } );
  if (blockers.length > 0) return fail("invalid_input", "sanitization.notReady", { blockers });

  const step = journeyStep(state, "sanitization.complete", { kind: "user", permissions: ctx.permissions });
  if (!step.ok) return fail("invalid_input", "sanitization.journeyRefused");

  // A row is engine-drafted when a succeeded job wrote it and nobody but its creator touched it since.
  const engineIds = new Set<string>();
  for (const j of jobs) {
    if (j.Status !== "succeeded") continue;
    for (const ref of (j.OutputRefs as string[]) ?? []) {
      const p = parseOutputRef(ref);
      if (p && (p.schema === "Requirement" || p.schema === "Objective")) engineIds.add(p.id);
    }
  }
  const untouched = (r: Row) =>
    engineIds.has(r.ItemId as string) && r.UpdatedByUserId === r.CreatedByUserId;

  const built = v1VersionRows({
    requirements: requirements.map((r) => ({
      id: r.ItemId as string,
      title: (r.Title as string) ?? "",
      text: (r.Text as string) ?? "",
      priority: r.Priority as string,
      acceptanceCriteria: (r.AcceptanceCriteria as string[]) ?? [],
      engineDrafted: untouched(r),
    })),
    objective: objective
      ? {
          statement: (objective.Statement as string) ?? "",
          highLevelMd: (objective.HighLevelMd as string) ?? "",
          architectureMd: (objective.ArchitectureMd as string) ?? "",
          acceptanceCriteria: (objective.AcceptanceCriteria as string[]) ?? [],
          engineDrafted: untouched(objective),
        }
      : null,
  } );
  if (!built.ok) return fromCheck(built);
  const versions = built.value;

  // objective:main goes last among the versions: it is the marker that a retry looks for.
  const ordered = [...versions.filter((v) => v.itemKey !== "objective:main"), ...versions.filter((v) => v.itemKey === "objective:main")];
  // Every version row goes in one round. The Project step moves in the bookkeeping round, after all of them exist, so a
  // retry after a partial run rewrites the versions (rows that exist are left as they are) and then moves the step.
  await ctx.gateway.insertMany(
    "ItemVersion",
    ordered.map((v) => ({
      fields: { ProjectId: project.ItemId, ItemKey: v.itemKey, N: 1, Text: v.text, Origin: v.origin },
      localKey: "v1:" + v.itemKey,
    })),
  );

  ctx.audit({ action: "sanitization.complete", targetType: "project", targetId: String(project.ItemId), details: { versions: ordered.length, requirements: requirements.length } });
  // The last write: the journey moves on.
  const stage = { Stage: "requirements", SanitizationCompletedAt: ctx.now() };
  ctx.after(() => ctx.gateway.patch("Project", String(project.ItemId), stage));
  ctx.notify(factoryNote("requirements.ready", { projectId: String(project.ItemId), discriminator: "v1", withActor: true }));
  return ok({ stage: "requirements", versions: ordered.length });
}

export const COMPLETE_OPS: OpTable = {
  "sanitization.complete": withReads(complete, { prefetch: (env) => readSet(env) }),
};
