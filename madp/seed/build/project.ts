// One project from its plan: the project row and assignment history, then every step it has reached, in journey order.
import { STEPS, type ProjectPlan, type Step } from "../model";
import { type Ctx, followers, plus, reached, row, t, u } from "./ctx";
import { seedDocs } from "./docs";
import { seedSanitization } from "./sanitization";
import { seedDesign } from "./design";
import { seedExtras } from "./extras";
import { confirmRequirements, seedScope } from "./scope";
import { seedDelivery } from "./delivery";
import { seedCollab } from "./collab";
import { audit, nameOf, notify, type World } from "./world";

function stepOf(plan: ProjectPlan): Step {
  if (plan.stage === "paused" || plan.stage === "abandoned") return plan.resumeTo ?? "business";
  return plan.stage;
}

function repoFields(plan: ProjectPlan): Record<string, unknown> {
  const r = plan.repo;
  if (r.mode === "existing") {
    return { RepoProvider: "github", RepoOwner: r.owner, RepoName: r.name, RepoMode: "existing", RepoVisibility: "", RepoBranch: r.branch, RepoExisting: `${r.owner}/${r.name}`, RepoNameEdited: false };
  }
  if (!r.owner) return { RepoProvider: "", RepoOwner: "", RepoName: "", RepoMode: "new", RepoVisibility: "", RepoBranch: "", RepoExisting: "", RepoNameEdited: false };
  return { RepoProvider: "github", RepoOwner: r.owner, RepoName: r.name ?? "", RepoMode: "new", RepoVisibility: r.visibility ?? "private", RepoBranch: r.branch ?? "main", RepoExisting: "", RepoNameEdited: false };
}

export async function seedProject(w: World, plan: ProjectPlan): Promise<string> {
  const ws = w.ws.get(plan.workspace);
  if (!ws) throw new Error(`seed: no workspace ${plan.workspace}`);
  const s = w.s;
  const step = stepOf(plan);
  const has = (st: Step) => STEPS.indexOf(step) >= STEPS.indexOf(st);
  const d = plan.days;
  const when = (x: string | undefined) => (x ? s.clock.at(x) : undefined);
  const at = {
    created: s.clock.at(d.created),
    handedOver: has("sanitization") ? when(d.handedOver) : undefined,
    sanitized: has("requirements") ? when(d.sanitized) : undefined,
    confirmed: has("scope") ? when(d.confirmed) : undefined,
    locked: has("board") ? when(d.locked) : undefined,
    buildStart: has("build") ? when(d.buildStart) : undefined,
    stopped: when(d.stopped),
    updated: "",
  };
  for (const [k, need] of [["handedOver", "sanitization"], ["sanitized", "requirements"], ["confirmed", "scope"], ["locked", "board"]] as const) {
    if (has(need) && !at[k]) throw new Error(`seed: ${plan.key} reached ${need} without days.${k}`);
  }
  const latest = [at.created, at.handedOver, at.sanitized, at.confirmed, at.locked, at.stopped].filter(Boolean).sort().pop()!;
  at.updated = when(d.updated) ?? latest;

  const c: Ctx = { w, s, ws, plan, id: "", step, at, refs: new Map(), milestones: [] };
  c.id = await row(
    c,
    "Project",
    plan.key,
    {
      Name: plan.name,
      ClientName: plan.client.name,
      ClientContact: plan.client.contact,
      ClientIndustry: plan.client.industry,
      ClientRegion: plan.client.region,
      Status: "active",
      Brief: plan.brief,
      NameSuggested: false,
      Stage: plan.stage,
      ResumeTo: plan.stage === "paused" || plan.stage === "abandoned" ? step : "",
      CurrentScopeVersion: has("scope") ? 1 : 0,
      AssigneeUserId: plan.assignee ? u(c, plan.assignee) : "",
      ...(at.handedOver ? { BusinessHandedOverAt: at.handedOver, BusinessHandedOverByUserId: u(c, plan.handedOverBy ?? plan.creator) } : {}),
      ...(at.sanitized ? { SanitizationCompletedAt: at.sanitized } : {}),
      // the lead approves the requirements (the requirements.confirm audit in build/scope.ts names the same person)
      ...(at.confirmed ? { RequirementsConfirmedAt: at.confirmed, RequirementsConfirmedByUserId: u(c, plan.lead) } : {}),
      ...(at.locked ? { ScopeLockedAt: at.locked } : {}),
      ...repoFields(plan),
      Rev: has("board") ? 1 : 0,
    },
    { by: plan.creator, at: at.created, updatedAt: at.updated, updatedBy: plan.lead },
  );
  await audit(w, { actor: plan.creator, action: "project.create", targetType: "project", targetId: c.id, targetLabel: plan.name, at: at.created, ws, projectId: c.id, details: { name: plan.name, type: plan.repo.mode === "existing" ? "existing" : "new" } });

  // Assignment history: earlier assignees, then the current one (Project.AssigneeUserId is the newest row).
  const history = [...(plan.previousAssignees ?? [])];
  if (plan.assignee) history.push({ person: plan.assignee, by: plan.assignedBy ?? plan.creator, at: "" });
  for (const [i, h] of history.entries()) {
    const hat = h.at ? t(c, h.at) : plus(c, at.created, 25 + i);
    await row(c, "ProjectAssignment", `assign-${i}`, { AssigneeUserId: u(c, h.person), AssignedByUserId: u(c, h.by), At: hat }, { by: h.by, at: hat });
    await audit(w, { actor: h.by, action: "project.assign", targetType: "project", targetId: c.id, targetLabel: plan.name, at: hat, ws, projectId: c.id, details: { assignee: nameOf(h.person) } });
    await notify(w, {
      kind: "assigned",
      to: [h.person],
      params: { projectId: c.id, projectName: plan.name, actorName: nameOf(h.by), workspaceId: ws.id },
      link: `/p/${c.id}`,
      at: hat,
      eventKey: `assigned:${c.id}:${i}`,
      actor: h.by,
      ws,
      projectId: c.id,
    });
  }

  await seedDocs(c);

  if (reached(c, "sanitization")) {
    const by = plan.handedOverBy ?? plan.creator;
    await audit(w, { actor: by, action: "business.handOver", targetType: "project", targetId: c.id, targetLabel: plan.name, at: at.handedOver!, ws, projectId: c.id });
    await notify(w, {
      kind: "business.handed-over",
      to: followers(c),
      params: { projectId: c.id, projectName: plan.name, actorName: nameOf(by), workspaceId: ws.id },
      link: `/p/${c.id}/sanitization`,
      at: at.handedOver!,
      eventKey: `business.handed-over:${c.id}`,
      actor: by,
      ws,
      projectId: c.id,
    });
    await seedSanitization(c);
  }
  if (reached(c, "requirements")) {
    await seedDesign(c);
    await seedExtras(c);
  }
  if (reached(c, "scope")) {
    await confirmRequirements(c);
    await seedScope(c);
  }
  if (reached(c, "board")) await seedDelivery(c);
  await seedCollab(c);
  if (plan.stage === "paused" || plan.stage === "abandoned") {
    await audit(w, { actor: plan.lead, action: "project.update", targetType: "project", targetId: c.id, targetLabel: plan.name, at: at.stopped ?? at.updated, ws, projectId: c.id, details: { stage: plan.stage, resumeTo: step } });
  }
  return c.id;
}
