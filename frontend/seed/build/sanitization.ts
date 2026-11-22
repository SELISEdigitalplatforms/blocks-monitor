// Product sanitization and requirements: clarifications, decisions, tech decisions, requirements v1 and the objective,
// the engine jobs that drafted them, the v1 snapshot taken when sanitization completed, and MADP suggestions.
import { v1VersionRows } from "../../src/domain/sanitization";
import type { Ref } from "../model";
import { followers, plus, reached, ref, row, t, u, type Ctx } from "./ctx";
import { seedThread } from "./feedback";
import { job } from "./jobs";
import { audit, nameOf, notify } from "./world";

function sourceOf(c: Ctx, r: Ref | undefined): { SourceType: string; SourceRef: string } {
  if (!r) return { SourceType: "", SourceRef: "" };
  const type = r.startsWith("file:") ? "doc-file" : r.startsWith("note:") ? "doc-note" : "";
  return { SourceType: type, SourceRef: ref(c, r) };
}

export async function seedSanitization(c: Ctx): Promise<void> {
  const plan = c.plan.sanitization;
  if (!plan) throw new Error(`seed: ${c.plan.key} reached sanitization without a plan`);
  const done = reached(c, "requirements");
  const lead = c.plan.lead;

  for (const [i, q] of plan.clarifications.entries()) {
    if (done && q.status === "open" && Date.parse(t(c, q.at)) < Date.parse(c.at.sanitized!)) {
      throw new Error(`seed: ${c.plan.key} completed sanitization with open clarification ${q.key}`);
    }
    const at = t(c, q.at);
    const answeredAt = q.answeredAt ? t(c, q.answeredAt) : undefined;
    const id = await row(
      c,
      "Clarification",
      `clar-${q.key}`,
      {
        Number: i + 1,
        Question: q.q,
        Answer: q.a ?? "",
        Status: q.status,
        OwnerUserId: u(c, q.owner),
        ...sourceOf(c, q.source),
        DeferReason: q.status === "deferred" ? q.deferReason ?? "" : "",
        ...(q.status === "answered" && q.answeredBy && answeredAt ? { AnsweredByUserId: u(c, q.answeredBy), AnsweredAt: answeredAt } : {}),
        SortOrder: i + 1,
      },
      { by: lead, at, updatedAt: answeredAt ?? at, updatedBy: q.answeredBy ?? lead },
    );
    c.refs.set(`clar:${q.key}`, id);
  }

  for (const [i, d] of plan.decisions.entries()) {
    const at = t(c, d.at);
    const id = await row(
      c,
      "Decision",
      `dec-${d.key}`,
      {
        Number: i + 1,
        Title: d.title,
        Statement: d.statement,
        Rationale: d.rationale,
        ClarificationId: d.clar ? ref(c, `clar:${d.clar}`) : "",
        Status: "accepted",
        SourceRef: d.source ? ref(c, d.source) : "",
        DecidedByUserId: u(c, d.by),
        DecidedAt: at,
      },
      { by: d.by, at },
    );
    c.refs.set(`dec:${d.key}`, id);
  }

  for (const [i, d] of plan.tech.entries()) {
    const at = t(c, d.at);
    const decided = d.status !== "proposed";
    const id = await row(
      c,
      "TechDecision",
      `tech-${d.key}`,
      {
        Number: i + 1,
        Area: d.area,
        Title: d.title,
        Choice: d.choice,
        Rationale: d.rationale,
        Alternatives: d.alternatives,
        NfrCategory: d.nfr?.category ?? "",
        NfrTarget: d.nfr?.target ?? "",
        IntegrationSystem: d.system ?? "",
        ExpertUserIds: d.experts.map((p) => u(c, p)),
        Status: d.status,
        ...(decided ? { DecidedByUserId: u(c, d.by), DecidedAt: at } : {}),
      },
      { by: d.by, at },
    );
    c.refs.set(`tech:${d.key}`, id);
  }

  await seedRequirementsV1(c);

  // The engine work behind the step: clarifications first, then the first draft of requirements and objective.
  const handed = c.at.handedOver!;
  const clarIds = plan.clarifications.slice(0, Math.ceil(plan.clarifications.length * 0.6)).map((q) => `Clarification:${ref(c, `clar:${q.key}`)}`);
  const refs = {
    docNoteIds: c.plan.docs.notes.map((n) => ref(c, `note:${n.key}`)),
    docFileIds: c.plan.docs.files.map((f) => ref(c, `file:${f.key}`)),
  };
  await job(c, {
    local: "assist-clarifications",
    kind: "sanitization.assist",
    status: "succeeded",
    by: lead,
    at: plus(c, handed, 35),
    minutes: 4,
    input: { projectId: c.id, focus: "clarifications", refs },
    outputs: clarIds,
    message: `Drafted ${clarIds.length} questions from the business notes and files.`,
  });
  const techIds = plan.tech.slice(0, 2).map((d) => `TechDecision:${ref(c, `tech:${d.key}`)}`);
  if (techIds.length) {
    const failure = plan.assistFailure;
    await job(c, {
      local: "assist-technical",
      kind: "sanitization.assist",
      status: failure ? "failed" : "succeeded",
      by: lead,
      at: failure ? t(c, failure.at) : plus(c, handed, 95),
      minutes: failure ? 10 : 5,
      input: { projectId: c.id, focus: "technical", refs },
      outputs: failure ? [] : techIds,
      progress: failure ? 40 : 100,
      message: failure ? failure.message : `Proposed ${techIds.length} technical decisions.`,
      error: failure?.error,
    });
  }
  const reqOutputs = [
    ...(c.plan.requirements ?? []).map((r) => `Requirement:${ref(c, `req:${r.key}`)}`),
    ...(c.objectiveId ? [`Objective:${c.objectiveId}`] : []),
  ];
  if (reqOutputs.length) {
    await job(c, {
      local: "requirements-draft",
      kind: "requirements.draft",
      status: "succeeded",
      by: lead,
      at: plus(c, handed, 140),
      minutes: 9,
      input: {
        projectId: c.id,
        sanitizationVersion: 1,
        refs: {
          ...refs,
          clarificationIds: plan.clarifications.map((q) => ref(c, `clar:${q.key}`)),
          decisionIds: plan.decisions.map((d) => ref(c, `dec:${d.key}`)),
          techDecisionIds: plan.tech.map((d) => ref(c, `tech:${d.key}`)),
          requirementIds: [],
        },
      },
      outputs: reqOutputs,
      message: `Drafted ${reqOutputs.length - (c.objectiveId ? 1 : 0)} requirements and the objective.`,
    });
  }

  if (plan.discussion?.length) await seedThread(c, "sanitization", { type: "sanitization", id: c.id }, plan.discussion);

  if (done) await completeSanitization(c);
}

/** Requirements v1 and the objective: drafted after hand-over, refined by the team, confirmed with the scope. */
async function seedRequirementsV1(c: Ctx): Promise<void> {
  const reqs = c.plan.requirements ?? [];
  const lead = c.plan.lead;
  const drafted = plus(c, c.at.handedOver!, 150);
  const refined = c.at.sanitized ? plus(c, c.at.sanitized, -40) : t(c, c.plan.days.updated ?? "-0d@09:00");
  for (const [i, r] of reqs.entries()) {
    const status = r.status ?? (reached(c, "scope") ? "confirmed" : "draft");
    const id = await row(
      c,
      "Requirement",
      `req-${r.key}`,
      {
        Number: i + 1,
        Key: r.key,
        Title: r.title,
        Text: r.text,
        Category: r.category,
        Priority: r.priority,
        Status: status,
        AcceptanceCriteria: r.criteria,
        SourceRefs: r.sources.map((s) => (s.startsWith("manual:") ? `manual:${u(c, s.slice(7))}` : ref(c, s))),
        SpecVersion: 1,
        SortOrder: (i + 1) * 10,
      },
      // Every third requirement was reworked by hand after the engine drafted it.
      { by: lead, at: drafted, updatedAt: i % 3 === 0 ? refined : drafted, updatedBy: i % 3 === 0 ? c.plan.assignee ?? lead : lead },
    );
    c.refs.set(`req:${r.key}`, id);
  }
  const o = c.plan.objective;
  if (o) {
    c.objectiveId = await row(
      c,
      "Objective",
      "objective",
      {
        Statement: o.statement,
        AcceptanceCriteria: o.criteria,
        HighLevelMd: o.highLevelMd,
        ArchitectureMd: o.architectureMd,
        SpecVersion: 1,
        Status: reached(c, "scope") ? "confirmed" : "draft",
        ...(reached(c, "scope") ? { ConfirmedByUserId: u(c, lead), ConfirmedAt: c.at.confirmed } : {}),
      },
      { by: lead, at: drafted, updatedAt: reached(c, "scope") ? c.at.confirmed : refined },
    );
  }
}

/** sanitization.complete: the v1 snapshot of every requirement and the objective, the hand-on to Requirements. */
async function completeSanitization(c: Ctx): Promise<void> {
  const reqs = c.plan.requirements ?? [];
  const o = c.plan.objective;
  const built = v1VersionRows({
    requirements: reqs.map((r, i) => ({
      id: ref(c, `req:${r.key}`),
      title: r.title,
      text: r.text,
      priority: r.priority,
      acceptanceCriteria: r.criteria,
      engineDrafted: i % 3 !== 0,
    })),
    objective: o
      ? { statement: o.statement, highLevelMd: o.highLevelMd, architectureMd: o.architectureMd, acceptanceCriteria: o.criteria, engineDrafted: false }
      : null,
  });
  if (!built.ok) throw new Error(`seed: ${c.plan.key} v1 snapshot refused`);
  const at = c.at.sanitized!;
  const ordered = [...built.value.filter((v) => v.itemKey !== "objective:main"), ...built.value.filter((v) => v.itemKey === "objective:main")];
  for (const v of ordered) {
    await row(c, "ItemVersion", `v1-${v.itemKey}`, { ItemKey: v.itemKey, N: 1, Text: v.text, CommentIds: [], Origin: v.origin }, { by: c.plan.lead, at });
  }
  await audit(c.w, {
    actor: c.plan.lead,
    action: "sanitization.complete",
    targetType: "project",
    targetId: c.id,
    targetLabel: c.plan.name,
    at,
    ws: c.ws,
    projectId: c.id,
    details: { versions: ordered.length, requirements: reqs.length },
  });
  await notify(c.w, {
    kind: "requirements.ready",
    to: followers(c),
    params: { projectId: c.id, projectName: c.plan.name, workspaceId: c.ws.id, actorName: nameOf(c.plan.lead) },
    link: `/p/${c.id}/requirements`,
    at,
    eventKey: `factory:requirements.ready:${c.id}:v1`,
    actor: c.plan.lead,
    ws: c.ws,
    projectId: c.id,
  });

  for (const sg of c.plan.suggestions ?? []) {
    const sat = t(c, sg.at);
    const decided = sg.status !== "open";
    const id = await row(
      c,
      "Suggestion",
      `suggestion-${sg.key}`,
      {
        Source: sg.source,
        Key: sg.key,
        Title: sg.title,
        Text: sg.text,
        Status: sg.status,
        ...(decided && sg.decidedBy && sg.decidedAt ? { DecidedByUserId: u(c, sg.decidedBy), DecidedAt: t(c, sg.decidedAt) } : {}),
      },
      { by: c.plan.lead, at: sat, updatedAt: decided && sg.decidedAt ? t(c, sg.decidedAt) : sat, updatedBy: sg.decidedBy ?? c.plan.lead },
    );
    c.refs.set(`suggestion:${sg.key}`, id);
  }

  for (const [i, fb] of (c.plan.requirementFeedback ?? []).entries()) {
    await seedThread(c, `req-${i}`, { type: "requirement", id: ref(c, `req:${fb.req}`) }, fb.comments, fb.resolved);
  }
}
