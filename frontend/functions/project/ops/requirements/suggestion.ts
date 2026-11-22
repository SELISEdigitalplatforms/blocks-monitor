// suggestion.decide: accept, dismiss or undo a MADP suggestion.
// Runs inside defineLaneOp (auth, membership, permission, open step, envelope).
import { decideSuggestion, requirementItemKey, requirementVersionText, suggestionSourceRef, isActiveRequirementStatus } from "../../../../src/domain/requirements";
import { defineLaneOp, OpError, addChanged, argString, argEnum, type ChangedRows } from "./ports";
import { insertRequirement, loadSuggestion, loadRequirement, loadRequirements, loadRequirementByKey, assertActiveCapacity } from "./loaders";
import { writeVersion, currentVersion } from "./versioning";
import { markFlushed, recordUnlessFlushed } from "./requirement";
import { deferUpdate } from "./loaders";
import { wire } from "./records";

type Row = any;

export const decideSuggestionOp = defineLaneOp({
  op: "suggestion.decide",
  permission: "requirements.edit",
  requireOpenStep: true,
  record: recordUnlessFlushed,
  parse: (input: Record<string, unknown>) => ({
    projectId: argString(input, "projectId"),
    suggestionId: argString(input, "suggestionId"),
    decision: argEnum(input, "decision", ["accepted", "dismissed", "open"] as const),
  }),
  prefetch: (env: any, a: any) => Promise.all([loadSuggestion(env, a.suggestionId), loadRequirements(env), loadRequirementByKey(env, a.suggestionId)]),
  async run(ctx: any, args: { projectId: string; suggestionId: string; decision: "accepted" | "dismissed" | "open" }) {
    // the suggestion and the project's requirements (the linked one has Key = suggestion id) in one round
    // (the list holds the active rows; a dropped linked row comes from its own Key lookup)
    const [suggestion, requirements, byKeyRow] = (await Promise.all([
      loadSuggestion(ctx, args.suggestionId),
      loadRequirements(ctx),
      loadRequirementByKey(ctx, args.suggestionId),
    ])) as [Row, Row[], Row | null];
    if (suggestion.ProjectId !== ctx.project.id) throw new OpError("not_found", "suggestion.notFound");
    const id = String(suggestion.ItemId);
    const current = String(suggestion.Status ?? "open");
    const verdict: any = decideSuggestion(current as any, args.decision);
    if (verdict && verdict.ok === false) {
      throw new OpError("conflict", "suggestion.transition", { current });
    }
    const changed: ChangedRows = {};
    const linked: Row | null = requirements.find((r) => r.Key === id) ?? byKeyRow;
    const base = { suggestionId: id, requirementId: linked ? String(linked.ItemId) : null };

    // An unchanged decision is an idempotent no-op: no write.
    if (current === args.decision || verdict?.changed === false || verdict?.noop) {
      return { ...base, status: current, requirementRemoved: false, keptEdited: false, changed };
    }

    const audit = () => ctx.deps.audit({ targetType: "suggestion", targetId: id, details: { decision: args.decision } });
    let requirementId: string | null = base.requirementId;
    let requirementRemoved = false;
    let keptEdited = false;

    if (args.decision === "accepted") {
      if (linked) {
        if (!isActiveRequirementStatus(String(linked.Status))) {
          assertActiveCapacity(requirements);
          // reopening the requirement and recording the decision are independent writes: one round
          const [row, decided] = (await Promise.all([
            ctx.db.update("Requirement", String(linked.ItemId), { Status: "draft" }),
            ctx.db.update("Suggestion", id, { Status: args.decision, DecidedByUserId: ctx.actorUserId, DecidedAt: ctx.now.toISOString() }),
          ])) as [Row, Row];
          addChanged(changed, "Requirement", wire(row));
          addChanged(changed, "Suggestion", wire(decided));
          audit();
          return { suggestionId: id, status: args.decision, requirementId, requirementRemoved, keptEdited, changed };
        }
      } else {
        const { row, created } = await insertRequirement(
          ctx,
          {
            key: id,
            title: String(suggestion.Title ?? ""),
            detail: String(suggestion.Text ?? ""),
            priority: "nice",
            criteria: [],
            sourceRefs: [suggestionSourceRef(id)],
          },
          requirements,
          true,
        );
        requirementId = String(row.ItemId);
        addChanged(changed, "Requirement", wire(row));
        if (created) {
          audit();
          // the first version and the decision are independent writes: one round
          const [ver, updatedSuggestion] = (await Promise.all([writeVersion(ctx, {
            itemKey: requirementItemKey(requirementId),
            text: requirementVersionText({
              title: String(suggestion.Title ?? ""),
              text: String(suggestion.Text ?? ""),
              priority: "nice",
            }),
            origin: "person",
            baseVersion: null,
            empty: true,
          }), ctx.db.update("Suggestion", id, {
            Status: args.decision,
            DecidedByUserId: ctx.actorUserId,
            DecidedAt: ctx.now.toISOString(),
          }), ctx.deps.flush()])) as [any, any, unknown];
          addChanged(changed, "ItemVersion", wire((ver as any).row ?? ver));
          addChanged(changed, "Suggestion", wire(updatedSuggestion as Row));
          // the audit and notification writes went out with these writes: no bookkeeping round is left
          return markFlushed({ suggestionId: id, status: args.decision, requirementId, requirementRemoved, keptEdited, changed });
        }
      }
    } else if (args.decision === "open" && linked && isActiveRequirementStatus(String(linked.Status))) {
      const rid = String(linked.ItemId);
      // the version reads and the decision are independent: one round; dropping the requirement waits for the reads
      const [reqVersion, accVersion, decided] = (await Promise.all([
        currentVersion(ctx, `requirement:${rid}`),
        currentVersion(ctx, `acceptance:${rid}`),
        ctx.db.update("Suggestion", id, { Status: args.decision, DecidedByUserId: ctx.actorUserId, DecidedAt: ctx.now.toISOString() }),
      ])) as [number, number, Row];
      addChanged(changed, "Suggestion", wire(decided));
      audit();
      if (reqVersion <= 1 && accVersion === 0) {
        addChanged(changed, "Requirement", wire(deferUpdate(ctx, "Requirement", linked, { Status: "dropped" })));
        return { suggestionId: id, status: args.decision, requirementId, requirementRemoved: true, keptEdited, changed };
      }
      return { suggestionId: id, status: args.decision, requirementId, requirementRemoved, keptEdited: true, changed };
    }

    const updated: Row = await ctx.db.update("Suggestion", id, {
      Status: args.decision,
      DecidedByUserId: ctx.actorUserId,
      DecidedAt: ctx.now.toISOString(),
    });
    addChanged(changed, "Suggestion", wire(updated));
    audit();
    void loadRequirement;
    return { suggestionId: id, status: args.decision, requirementId, requirementRemoved, keptEdited, changed };
  },
});
