// The Requirements document's other lists (key workflows, not included, constraints) of a project that reached Goals &
// requirements: written by the product manager's draft when the understanding was completed (or by a person later).
import { EXTRAS_SEED } from "../data/extras";
import { type Ctx, plus, row } from "./ctx";

export async function seedExtras(c: Ctx): Promise<void> {
  const plan = EXTRAS_SEED[c.plan.key];
  if (!plan || !c.at.sanitized) return;
  const items = [
    ...plan.workflows.map((w, i) => ({ local: `extra-workflow-${i + 1}`, by: w.by, fields: { Kind: "workflow", Title: w.title, Who: w.who, Steps: w.steps, ConstraintKind: "", SortOrder: i + 1 } })),
    ...plan.exclusions.map((x, i) => ({ local: `extra-exclusion-${i + 1}`, by: x.by, fields: { Kind: "exclusion", Title: x.text, Who: "", Steps: [], ConstraintKind: "", SortOrder: i + 1 } })),
    ...plan.constraints.map((k, i) => ({ local: `extra-constraint-${i + 1}`, by: k.by, fields: { Kind: "constraint", Title: k.text, Who: "", Steps: [], ConstraintKind: k.kind, SortOrder: i + 1 } })),
  ];
  for (const [i, it] of items.entries()) {
    const at = it.by ? plus(c, c.at.sanitized, 90 + i) : plus(c, c.at.sanitized, -20 + i);
    await row(c, "RequirementExtra", it.local, { ...it.fields, Status: "active", Origin: it.by ? "person" : "engine" }, { by: it.by ?? c.plan.lead, at });
  }
}
