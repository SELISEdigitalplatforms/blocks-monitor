// Scope v1: the version, features, stories and milestones, the engine's milestone proposal and second opinion with its
// challenges, feedback on scope items, the lock (board onwards), shares and share links.
import { createHash } from "node:crypto";
import type { MilestonePlan } from "../model";
import { followers, plus, reached, ref, row, t, u, type Ctx } from "./ctx";
import { seedThread, type ThreadTarget } from "./feedback";
import { job } from "./jobs";
import { audit, nameOf, notify } from "./world";
import { SUCCESS_KEYS, emptyTargets, questionText, serializeSuccessTargets, type SuccessQuestion } from "../../src/domain/successTargets";
import { SUCCESS_SEED } from "../data/success";

/** ScopeVersion.SuccessTargets of the project (seed/data/success.ts): the lead set the values and asked the product
 *  manager the rest soon after the scope opened; the product manager answered within the hour. */
function successTargetsOf(c: Ctx, opened: string, locked: string | undefined): string | undefined {
  const plan = SUCCESS_SEED[c.plan.key];
  if (!plan) return undefined;
  const lead = u(c, c.plan.lead);
  const cap = (iso: string) => (locked && iso > locked ? locked : iso);
  const asked = cap(plus(c, opened, 20));
  const answered = cap(plus(c, opened, 45));
  const decided = cap(plus(c, opened, 90));
  const out = emptyTargets();
  for (const k of SUCCESS_KEYS) {
    const sd = plan[k];
    if (!sd) continue;
    const a = sd.answer;
    const status: SuccessQuestion["status"] = !a ? "open" : a.use ? "answered" : a.accept ? "accepted" : "proposed";
    const decidedNow = status === "answered" || status === "accepted";
    const question: SuccessQuestion | null = sd.unsure ? {
      status, text: questionText(k, c.plan.name), askedAt: asked, askedBy: lead,
      answer: a?.value ?? "", reason: a?.reason ?? "", answeredAt: a ? answered : "",
      resolvedAt: decidedNow ? decided : "", resolvedBy: decidedNow ? lead : "",
    } : null;
    out[k] = {
      value: a?.use ? a.value : sd.value ?? "", unsure: Boolean(sd.unsure && !a?.use), choice: sd.choice ?? "",
      suggested: Boolean(sd.suggested), question,
    };
  }
  return serializeSuccessTargets(out);
}

/** Milestone status from the delivery plan: built ones have their preview, the next one is being built. */
function milestoneStatus(c: Ctx, index: number): string {
  if (!reached(c, "build")) return "planned";
  const d = c.plan.delivery;
  const built = d?.builtMilestones ?? 0;
  if (index < built) return c.step === "release" ? "done" : "preview-ready";
  if (index === built && d?.current) return "building";
  return "planned";
}

export function planHours(c: Ctx): number {
  return (c.plan.scope?.features ?? [])
    .filter((f) => f.priority !== "later" && !f.dropped)
    .reduce((sum, f) => sum + f.stories.reduce((h, s) => h + s.hours, 0), 0);
}

export async function seedScope(c: Ctx): Promise<void> {
  const sc = c.plan.scope;
  if (!sc) throw new Error(`seed: ${c.plan.key} reached scope without a scope plan`);
  const lead = c.plan.lead;
  const opened = plus(c, c.at.confirmed!, 6);
  const locked = reached(c, "board") ? c.at.locked! : undefined;
  const success = successTargetsOf(c, opened, locked);

  c.scopeVersionId = await row(
    c,
    "ScopeVersion",
    "scope-v1",
    {
      Number: 1,
      Title: sc.title,
      Summary: sc.summary,
      Status: locked ? "locked" : "draft",
      PlanHours: planHours(c),
      ...(locked ? { LockedByUserId: u(c, lead), LockedAt: locked } : {}),
      ...(success ? { SuccessTargets: success } : {}),
      ...(locked ? { ScreensReviewedAt: plus(c, opened, 60) < locked ? plus(c, opened, 60) : locked, ScreensReviewedBy: u(c, lead) } : {}),
    },
    { by: lead, at: opened, updatedAt: locked ?? t(c, c.plan.days.updated ?? "-0d@09:00") },
  );

  for (const [i, f] of sc.features.entries()) {
    const id = await row(
      c,
      "Feature",
      `feature-${f.key}`,
      {
        ScopeVersion: 1,
        Key: f.key,
        Title: f.title,
        Description: f.description,
        Priority: f.priority,
        Status: f.dropped ? "dropped" : "planned",
        RequirementRefs: f.reqs.map((r) => `requirement:${r}`),
        SortOrder: i + 1,
      },
      { by: lead, at: plus(c, opened, 2) },
    );
    c.refs.set(`feature:${f.key}`, id);
    for (const [j, st] of f.stories.entries()) {
      const sid = await row(
        c,
        "Story",
        `story-${st.key}`,
        {
          ScopeVersion: 1,
          FeatureRef: `feature:${f.key}`,
          Key: st.key,
          Title: st.title,
          Text: st.text,
          ActorRole: st.actor,
          AcceptanceCriteria: st.criteria,
          Priority: f.priority,
          EstimateHours: st.hours,
          SortOrder: j + 1,
        },
        { by: lead, at: plus(c, opened, 3) },
      );
      c.refs.set(`story:${st.key}`, sid);
    }
  }

  // Milestones as the engine proposed them and the team kept them.
  const milestonesAt = plus(c, opened, 40);
  for (const [i, m] of sc.milestones.entries()) {
    const status = milestoneStatus(c, i);
    const id = await row(
      c,
      "Milestone",
      `milestone-${i + 1}`,
      { ScopeVersion: 1, Number: i + 1, Name: m.name, Goal: m.goal, FeatureRefs: m.features.map((k) => `feature:${k}`), SortOrder: i, PreviewPoint: m.preview, Status: status },
      { by: lead, at: plus(c, milestonesAt, 12), updatedAt: status === "planned" ? undefined : t(c, c.plan.days.updated ?? "-0d@09:00") },
    );
    c.milestones.push({ id, number: i + 1, plan: m as MilestonePlan, status });
  }
  await job(c, {
    local: "milestones-suggest",
    kind: "milestones.suggest",
    status: "succeeded",
    by: lead,
    at: milestonesAt,
    minutes: 3,
    target: { type: "scope-version", id: c.scopeVersionId },
    input: { projectId: c.id, scopeVersion: 1 },
    outputs: c.milestones.map((m) => `Milestone:${m.id}`),
    message: `Proposed ${c.milestones.length} milestones.`,
  });

  if (sc.challenges?.length) await seedSecondOpinion(c, plus(c, opened, 90));

  for (const [i, fb] of (sc.feedback ?? []).entries()) {
    const [kind, key] = fb.target.split(":") as [string, string];
    const id = kind === "milestone" ? c.milestones[Number(key) - 1]!.id : ref(c, `${kind}:${key}`);
    await seedThread(c, `scope-${i}`, { type: kind as ThreadTarget, id }, fb.comments, fb.resolved);
  }

  for (const sh of c.plan.shares ?? []) {
    const itemRef = sh.item === "scope" ? c.scopeVersionId : sh.item === "screens" ? "all" : ref(c, `screen:${sh.screen}`);
    const at = t(c, sh.at);
    await row(
      c,
      "Share",
      `share-${sh.item}-${sh.screen ?? ""}-${sh.with}`,
      { ItemType: sh.item, ItemRef: itemRef, SharedByUserId: u(c, sh.by), SharedWithUserId: u(c, sh.with) },
      { by: sh.by, at },
    );
    const label = sh.item === "scope" ? "the scope" : sh.item === "screens" ? "the screen designs" : "a screen design";
    await notify(c.w, {
      kind: "shared",
      to: [sh.with],
      params: { projectId: c.id, projectName: c.plan.name, itemLabel: label, actorName: nameOf(sh.by), workspaceId: c.ws.id },
      link: `/p/${c.id}/scope`,
      at,
      eventKey: `share.create:${c.id}:${sh.item}:${itemRef}:${sh.with}`,
      actor: sh.by,
      ws: c.ws,
      projectId: c.id,
    });
  }

  for (const l of c.plan.links ?? []) {
    const at = t(c, l.at);
    const itemRef = l.item === "scope" ? c.scopeVersionId : ref(c, `screen:${l.screen}`);
    const revoked = l.revoked ? t(c, l.revoked) : undefined;
    const id = await row(
      c,
      "ShareLink",
      `link-${l.token.slice(0, 12)}`,
      {
        ItemType: l.item,
        ItemRef: itemRef,
        TokenHash: createHash("sha256").update(l.token, "utf8").digest("hex"),
        ExpiresAt: new Date(Date.parse(at) + l.days * 86_400_000).toISOString(),
        ...(revoked ? { RevokedAt: revoked } : {}),
        ViewCount: l.views ?? 0,
        ...(l.views ? { LastViewedAt: plus(c, at, 60 * 20) } : {}),
      },
      { by: l.by, at, updatedAt: revoked ?? (l.views ? plus(c, at, 60 * 20) : at) },
    );
    await audit(c.w, { actor: l.by, action: "shareLink.create", targetType: "share-link", targetId: id, targetLabel: l.item === "scope" ? "Scope v1" : "Screen design", at, ws: c.ws, projectId: c.id, details: { itemType: l.item, days: l.days } });
    if (revoked) await audit(c.w, { actor: l.by, action: "shareLink.revoke", targetType: "share-link", targetId: id, targetLabel: "Screen design", at: revoked, ws: c.ws, projectId: c.id });
  }

  if (locked) {
    await audit(c.w, { actor: lead, action: "scope.lock", targetType: "scope-version", targetId: c.scopeVersionId, targetLabel: `${c.plan.name} scope v1`, at: locked, ws: c.ws, projectId: c.id, details: { number: 1, milestones: c.milestones.length } });
  }
}

async function seedSecondOpinion(c: Ctx, at: string): Promise<void> {
  const sc = c.plan.scope!;
  const list = sc.challenges ?? [];
  const jobId = await job(c, {
    local: "scope-grill",
    kind: "scope.grill",
    status: "succeeded",
    by: c.plan.lead,
    at,
    minutes: 7,
    target: { type: "scope-version", id: c.scopeVersionId! },
    input: { projectId: c.id, scopeVersion: 1 },
    outputs: [],
    message: `Raised ${list.length} points on scope v1.`,
  });
  const open = (sev: string) => list.filter((x) => (x.status ?? "open") === "open" && x.severity === sev).length;
  const opinionAt = plus(c, at, 8);
  const opinionId = await row(
    c,
    "SecondOpinion",
    "second-opinion",
    {
      ScopeVersion: 1,
      EngineJobId: jobId,
      Readiness: Math.max(35, 100 - 18 * open("high") - 8 * open("medium") - 3 * open("low")),
      OpenHigh: open("high"),
      OpenMedium: open("medium"),
      OpenLow: open("low"),
    },
    { by: c.plan.lead, at: opinionAt },
  );
  const outputs = [`SecondOpinion:${opinionId}`];
  for (const [i, ch] of list.entries()) {
    const status = ch.status ?? "open";
    const decidedAt = status !== "open" && ch.at ? t(c, ch.at) : undefined;
    const target = ch.target ? { TargetType: ch.target.type, TargetRef: `${ch.target.type}:${ref(c, `${ch.target.type}:${ch.target.key}`)}` } : { TargetType: "", TargetRef: "" };
    const id = await row(
      c,
      "Challenge",
      `challenge-${i + 1}`,
      {
        OpinionId: opinionId,
        Severity: ch.severity,
        Question: ch.question,
        Why: ch.why,
        ...target,
        SuggestedFix: ch.fix,
        AnswerText: status === "answered" ? ch.answer ?? "" : "",
        DismissReason: status === "dismissed" ? ch.answer ?? "" : "",
        FinalText: status === "accepted" ? ch.answer ?? ch.fix : "",
        Status: status,
        ...(decidedAt && ch.by ? { DecidedByUserId: u(c, ch.by), DecidedAt: decidedAt } : {}),
      },
      { by: c.plan.lead, at: opinionAt, updatedAt: decidedAt, updatedBy: ch.by },
    );
    outputs.push(`Challenge:${id}`);
  }
  await c.s.update("EngineJob", jobId, { OutputRefs: outputs }, plus(c, at, 8));
}

/** requirements.confirm: the hand-on to Scope (scope.ready note and audit). */
export async function confirmRequirements(c: Ctx): Promise<void> {
  const at = c.at.confirmed!;
  await audit(c.w, { actor: c.plan.lead, action: "requirements.confirm", targetType: "project", targetId: c.id, targetLabel: c.plan.name, at, ws: c.ws, projectId: c.id });
  await notify(c.w, {
    kind: "scope.ready",
    to: followers(c),
    params: { projectId: c.id, projectName: c.plan.name, workspaceId: c.ws.id, actorName: nameOf(c.plan.lead) },
    link: `/p/${c.id}/scope`,
    at,
    eventKey: `factory:scope.ready:${c.id}:${at}`,
    actor: c.plan.lead,
    ws: c.ws,
    projectId: c.id,
  });
}
