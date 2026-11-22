// requirements.confirm: moves the project from Requirements to Scope confirmation.
// It does not queue design.generate: lane L7 does that on entering Scope confirmation.
import { confirmBlockers, isActiveRequirementStatus } from "../../../../src/domain/requirements";
import { journeyStep, stepIndex, type JourneyStep } from "../../../../src/domain/journey";
import { defineLaneOp, OpError, addChanged, argString, type ChangedRows } from "./ports";
import { loadRequirements, loadObjective, loadDesignBrief } from "./loaders";
import { factoryNote } from "../../../../src/domain/factoryNotes";
import { wire } from "./records";
import { landingBlocks } from "../../../../src/domain/landingPage";
import { automaticDesignDirection, designSource, parseMakePrototype, rawDesignRequirements } from "../../../../src/domain/figmaMake";
import { designSourceCurrent, parseProductPrototype } from "../../../../src/domain/factoryDesign";
import { loadDesignSources } from "../design/context";

type Row = any;

export const confirmRequirements = defineLaneOp({
  op: "requirements.confirm",
  permission: "requirements.edit",
  requireOpenStep: false, // must answer alreadyConfirmed once the step is past
  parse: (input: Record<string, unknown>) => ({ projectId: argString(input, "projectId") }),
  prefetch: (env: any) => Promise.all([loadRequirements(env), loadObjective(env), loadDesignBrief(env)]),
  async run(ctx: any) {
    const stage = ctx.project.stage as JourneyStep;
    if (stage !== "requirements") {
      if (stepIndex(stage) > stepIndex("requirements")) {
        // re-emit so a retry after a failed flush still delivers (same eventKey: no second row)
        const stored = ctx.project.requirementsConfirmedAt;
        if (stored) {
          ctx.deps.notify(factoryNote("scope.ready", { projectId: ctx.project.id, discriminator: stored, withActor: false }));
        }
        return { alreadyConfirmed: true, stage, changed: {} };
      }
      throw new OpError("conflict", "requirements.closed");
    }
    const [requirements, objective, brief] = (await Promise.all([
      loadRequirements(ctx),
      loadObjective(ctx),
      loadDesignBrief(ctx),
    ])) as [Row[], Row | null, Row | null];

    if (brief?.Mode !== "figma") throw new OpError("invalid_input", "design.notConfirmable", { reason: "prototype_stale" });
    if (brief?.Mode === "figma") {
      const candidate = parseProductPrototype(brief.PrototypeJson);
      const factory = candidate?.provider !== 'figma-make' ? candidate : null;
      const prototype = factory ?? parseMakePrototype(brief.PrototypeJson);
      const designRequirements = rawDesignRequirements(requirements);
      const sources = factory ? await loadDesignSources(ctx.db, ctx.project.id) : { source: designSource(automaticDesignDirection(designRequirements), designRequirements) };
      if (!prototype || !designSourceCurrent(prototype.source, sources) || (prototype.provider === 'figma-design' && prototype.reviewComplete === false)) {
        throw new OpError("invalid_input", "design.notConfirmable", { reason: "prototype_stale" });
      }
    }
    const blockers = confirmBlockers({
      requirements: requirements
        .filter((r) => isActiveRequirementStatus(String(r.Status)))
        .map((r) => ({
          id: String(r.ItemId),
          status: String(r.Status),
          criteria: (r.AcceptanceCriteria ?? []) as string[],
        })),
      objective: objective
        ? { text: String(objective.Statement ?? ""), criteria: (objective.AcceptanceCriteria ?? []) as string[] }
        : null,
      designBrief: brief ? { status: String(brief.Status) } : null,
      // the "Add-on: Landing page" section must be reviewed and confirmed for the latest answers
      landingPageOpen: landingBlocks(ctx.project.landingPageAddOn, ctx.project.landingPageSection),
    } as any);
    if ((blockers as unknown[]).length > 0) {
      throw new OpError("invalid_input", "requirements.blockers", { missing: blockers });
    }

    const moved = journeyStep({ step: "requirements", scopeLocked: false }, "requirements.confirm", {
      kind: "user",
      permissions: ctx.permissions,
    });
    if (!moved.ok) throw new OpError("forbidden", "permission.denied");

    const confirmedAt = ctx.now.toISOString();
    const row: Row = await ctx.db.update("Project", ctx.project.id, {
      Stage: moved.state.step,
      RequirementsConfirmedAt: confirmedAt,
      RequirementsConfirmedByUserId: ctx.actorUserId,
    });
    const changed: ChangedRows = {};
    addChanged(changed, "Project", wire(row));
    ctx.deps.notify(factoryNote("scope.ready", { projectId: ctx.project.id, discriminator: confirmedAt, withActor: true }));
    ctx.deps.audit({ targetType: "project", targetId: ctx.project.id, details: { version: confirmedAt, stage: moved.state.step } });
    return { alreadyConfirmed: false, stage: moved.state.step, changed };
  },
});
