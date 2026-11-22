// Board, build and release: the plan of tickets (board.plan), each milestone's build (build.run with the tickets moving
// through the agents' columns, then preview.deploy and the preview), the dev release, approvals and promotions to stage
// and production, and change requests after go-live (change.build). Tickets carry their dependencies (DependsOn, planned
// with the engine's rules in src/domain/ticketDeps.ts) and a ticket starts only after the tickets it waits for are done.
import { changeCode, changeVersionAtStart } from "../../src/domain/delivery";
import { chainLength, changeDependencies, planDependencies, teamOrder, type DepItem } from "../../src/domain/ticketDeps";
import { hexOf } from "../core/rng";
import type { ChangePlan, P } from "../model";
import { followers, plus, reached, ref, row, t, u, type Ctx } from "./ctx";
import { job } from "./jobs";
import { audit, nameOf, notify } from "./world";

type Column = "planned" | "dev" | "review" | "test" | "security" | "docs" | "gate" | "done";
const FLOW: Column[] = ["planned", "dev", "review", "test", "security", "docs", "gate", "done"];
const OWNER: Record<Column, string> = { planned: "planner", dev: "dev", review: "reviewer", test: "qa", security: "secops", docs: "docs", gate: "shipper", done: "shipper" };

interface Ev {
  kind: "move" | "comment" | "artifact" | "note";
  from?: Column;
  to?: Column;
  label: string;
  person?: P;
  text: string;
  at: string;
}

interface Tk {
  number: number;
  planRef: string;
  title: string;
  type: "story" | "task" | "fix";
  featureRef: string;
  milestone: number | null;
  hours: number;
  acceptance: string[];
  description: string;
  source: "plan" | "change-request" | "fix";
  changeRequest?: string;
  column: Column;
  doneAt?: string;
  createdAt: string;
  events: Ev[];
  job?: string;
  /** Numbers of the tickets this one waits for. */
  deps: number[];
}

const slug = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 28);

/** The plan of tickets: one per story (milestone by milestone), then the cross-cutting tasks. */
function planTickets(c: Ctx, createdAt: string): Tk[] {
  const sc = c.plan.scope!;
  const out: Tk[] = [];
  c.milestones.forEach((m, mi) => {
    let i = 0;
    for (const fk of m.plan.features) {
      const f = sc.features.find((x) => x.key === fk)!;
      for (const st of f.stories) {
        out.push({
          number: out.length + 1,
          planRef: `r${mi + 1}.${i++}`,
          title: st.title,
          type: "story",
          featureRef: `feature:${f.key}`,
          milestone: mi,
          hours: st.hours,
          acceptance: st.criteria,
          description: `${st.actor}: ${st.text}`,
          source: "plan",
          column: "planned",
          createdAt,
          events: [],
          deps: [],
        });
      }
    }
    for (const task of (c.plan.delivery?.tasks ?? []).filter((x) => x.milestone === mi + 1)) {
      out.push({
        number: out.length + 1,
        planRef: `x.${task.tag}`,
        title: task.title,
        type: "task",
        featureRef: task.feature ? `feature:${task.feature}` : "",
        milestone: mi,
        hours: task.hours,
        acceptance: task.acceptance,
        description: task.description,
        source: "plan",
        column: "planned",
        createdAt,
        events: [],
        deps: [],
      });
    }
  });
  // What waits for what, as the planner plans it.
  const items: DepItem[] = out.map((tk) => ({
    ref: tk.planRef,
    milestone: tk.milestone ?? 0,
    kind: tk.type === "task" ? "task" : "story",
    feature: tk.featureRef.replace(/^feature:/, ""),
    tag: tk.planRef.startsWith("x.") ? tk.planRef.slice(2) : "",
    title: tk.title,
    text: `${tk.description} ${tk.acceptance.join(" ")}`,
  }));
  const features = c.milestones.flatMap((m, mi) =>
    m.plan.features.map((fk) => {
      const f = sc.features.find((x) => x.key === fk)!;
      return { key: f.key, milestone: mi, title: f.title, description: f.description, actors: f.stories.map((st) => st.actor) };
    }),
  );
  const deps = planDependencies({ items, features });
  const numberOf = new Map(out.map((tk) => [tk.planRef, tk.number]));
  for (const tk of out) tk.deps = (deps.get(tk.planRef) ?? []).map((r) => numberOf.get(r)!);
  return out;
}

const MOVE_TEXT: Record<Column, (tk: Tk, n: number) => string> = {
  planned: (tk) => `Created in Planned: ${tk.title}.`,
  dev: (tk) => `Started on ${tk.title}.`,
  review: (tk, n) => `Ready for review on branch mf-${tk.number}-${slug(tk.title)}: ${3 + (n % 9)} files changed.`,
  test: () => "Review approved: structure, naming and error handling are fine.",
  security: (_tk, n) => `${12 + (n % 23)} automated checks passed; acceptance criteria verified.`,
  docs: () => "Security checks passed with no findings.",
  gate: () => "User guide and release notes updated.",
  done: () => "Release gate passed.",
};

const SEND_BACKS = [
  "Sent back: the empty state is missing when there is nothing to show.",
  "Sent back: the error message on a lost connection is not translated into plain words.",
  "Sent back: two acceptance criteria are not covered by a test yet.",
];
const REMARKS = [
  "Reused the existing date helpers instead of adding a new library.",
  "Added a fallback when the list is empty so the screen never looks broken.",
  "Kept the API response small: only the fields this screen shows.",
  "The import tolerates a missing optional column and logs a warning.",
];

/** The moves of one ticket from Planned to Done (with an occasional send-back), as minutes after its start. */
function flowPlan(tk: Tk, stepMin: number, seed: number): { events: { off: number; ev: Omit<Ev, "at"> }[]; end: number } {
  let off = 0;
  let col: Column = "planned";
  const events: { off: number; ev: Omit<Ev, "at"> }[] = [];
  const sendBack = seed % 5 === 2;
  const stepTo = (to: Column, text: string): void => {
    off += stepMin * (0.7 + ((seed * 7 + FLOW.indexOf(to)) % 7) / 10);
    events.push({ off, ev: { kind: "move", from: col, to, label: OWNER[col === "planned" ? "dev" : col], text } });
    col = to;
  };
  for (const to of FLOW.slice(1)) {
    stepTo(to, MOVE_TEXT[to](tk, seed));
    if (to === "review") {
      events.push({ off: off + 0.2, ev: { kind: "artifact", label: "dev", text: `Pull request #${40 + tk.number * 3} opened: ${tk.title}.` } });
      if (seed % 4 === 1) events.push({ off: off + 0.3, ev: { kind: "note", label: "dev", text: REMARKS[seed % REMARKS.length]! } });
    }
    if (to === "test" && sendBack) {
      stepTo("dev", SEND_BACKS[seed % SEND_BACKS.length]!);
      stepTo("review", "Fixed and ready for review again.");
      stepTo("test", MOVE_TEXT.test(tk, seed));
    }
    if (to === "security") events.push({ off: off + 0.2, ev: { kind: "artifact", label: "qa", text: `Test report: ${10 + (seed % 17)} passed, 0 failed.` } });
  }
  return { events, end: off };
}

/** A build of some tickets as the team works it: tickets are picked up in the team's order (set-up work first), the
 *  k-th at its slot (2 + k × slot minutes), but never before every ticket it waits for is done (plus a short pick-up
 *  gap). Answers the build's length in minutes and play(start), which writes the moves at their times (clamped to
 *  before now, so a running build is cut with cut()). */
function schedule(group: Tk[], o: { slot: number; stepMin: number; seedOf: (tk: Tk) => number }): { minutes: number; play: (c: Ctx, start: string) => void } {
  const byNo = new Map(group.map((tk) => [tk.number, tk]));
  const order = teamOrder(group.map((tk) => String(tk.number)), (id) => byNo.get(Number(id))!.deps.map(String));
  const plans = new Map<number, { start: number; flow: ReturnType<typeof flowPlan> }>();
  const end = new Map<number, number>();
  for (const [k, id] of order.entries()) {
    const tk = byNo.get(Number(id))!;
    const ready = Math.max(0, ...tk.deps.filter((d) => end.has(d)).map((d) => end.get(d)! + 1.5));
    const start = Math.max(2 + k * o.slot, ready);
    const flow = flowPlan(tk, o.stepMin, o.seedOf(tk));
    plans.set(tk.number, { start, flow });
    end.set(tk.number, start + flow.end);
  }
  return {
    minutes: Math.max(0, ...end.values()),
    play(c, start) {
      for (const tk of group) {
        const p = plans.get(tk.number)!;
        for (const e of p.flow.events) tk.events.push({ ...e.ev, at: plus(c, start, p.start + e.off) });
        tk.column = "done";
        tk.doneAt = plus(c, start, p.start + p.flow.end);
      }
    },
  };
}

/** Keeps the events up to `until`; the ticket stands in the column of its last move. */
function cut(tk: Tk, until: number): void {
  tk.events = tk.events.filter((e) => Date.parse(e.at) <= until);
  const last = [...tk.events].reverse().find((e) => e.kind === "move");
  tk.column = (last?.to as Column) ?? "planned";
  if (tk.column !== "done") delete tk.doneAt;
}

const minutesFor = (n: number): number => Math.min(225, 80 + 14 * n);

export async function seedDelivery(c: Ctx): Promise<void> {
  const d = c.plan.delivery;
  if (!d) throw new Error(`seed: ${c.plan.key} reached board without a delivery plan`);
  const lead = c.plan.lead;
  const locked = c.at.locked!;
  const sv = c.scopeVersionId!;

  for (const p of d.policies ?? []) await seedPolicy(c, p);

  // board.plan: queued by the lock, written by the engine.
  const planJobAt = plus(c, locked, 1);
  const planJob = await job(c, {
    local: "board-plan",
    kind: "board.plan",
    status: "succeeded",
    by: lead,
    at: planJobAt,
    minutes: 12,
    target: { type: "scope-version", id: sv },
    input: { projectId: c.id, scopeVersion: 1 },
    outputs: [],
    requestKey: `job:board.plan:${sv}:${locked}`,
  });
  const plannedAt = plus(c, planJobAt, 13);
  const tickets = planTickets(c, plannedAt);
  for (const tk of tickets) tk.events.push({ kind: "move", from: undefined, to: "planned", label: "planner", text: MOVE_TEXT.planned(tk, 0), at: tk.createdAt });

  // Builds: finished milestones run start to end; the current one is cut at "now".
  const buildJobs: { mi: number; id: string; start: string; end?: string }[] = [];
  if (reached(c, "build")) {
    const count = d.builtMilestones + (d.current ? 1 : 0);
    for (let mi = 0; mi < count; mi++) {
      const mine = tickets.filter((x) => x.milestone === mi);
      const minutes = minutesFor(mine.length);
      const running = mi === d.builtMilestones;
      const plan = schedule(mine, { slot: (minutes * 0.55) / Math.max(1, mine.length), stepMin: (minutes * 0.42) / 9, seedOf: (tk) => tk.number + mi });
      // a running build is the share `progress` of the way through (by time, waiting tickets included)
      const start = running ? c.s.clock.at(`-${Math.round(plan.minutes * d.current!.progress) + 4}m`) : t(c, d.builds[mi]!);
      plan.play(c, start);
      if (running) mine.forEach((tk) => cut(tk, c.s.clock.nowMs - 3 * 60_000));
      const end = running ? undefined : mine.reduce((m, tk) => (tk.doneAt && tk.doneAt > m ? tk.doneAt : m), start);
      buildJobs.push({ mi, id: "", start, end: end ? plus(c, end, 2) : undefined });
    }
  }

  // Person comments on tickets.
  for (const cm of d.ticketComments ?? []) {
    const tk = tickets.find((x) => x.planRef === cm.ticket);
    if (!tk) throw new Error(`seed: ${c.plan.key} has no ticket ${cm.ticket}`);
    const base = tk.events[Math.min(cm.after, tk.events.length - 1)]!;
    tk.events.push({ kind: "comment", label: "", person: cm.by, text: cm.text, at: plus(c, base.at, 3) });
  }

  // Build jobs first (the ticket events point at them), then the tickets, then their events.
  for (const b of buildJobs) {
    const m = c.milestones[b.mi]!;
    const mine = tickets.filter((x) => x.milestone === b.mi);
    const doneCount = mine.filter((x) => x.column === "done").length;
    const running = !b.end;
    b.id = await job(c, {
      local: `build-m${m.number}`,
      kind: "build.run",
      status: running ? "running" : "succeeded",
      by: lead,
      at: plus(c, b.start, -1),
      minutes: running ? undefined : (Date.parse(b.end!) - Date.parse(b.start)) / 60_000,
      input: { projectId: c.id, milestoneId: m.id },
      outputs: [],
      progress: running ? Math.round(d.current!.progress * 100) : 100,
      message: running
        ? `Building ${m.plan.name}: ${doneCount} of ${mine.length} tickets done.`
        : `${m.plan.name} built: ${mine.length} of ${mine.length} tickets done.`,
      requestKey: `job:build.run:${c.id}:${m.id}:1`,
    });
    for (const tk of mine) tk.job = b.id;
  }

  const ticketIds = await insertTickets(c, tickets, planJob);
  await c.s.update("EngineJob", planJob, { OutputRefs: tickets.map((x) => `Ticket:${ticketIds.get(x.number)}`) }, plus(c, planJobAt, 13));

  // The board row: one per project, on the locked version.
  await row(
    c,
    "Board",
    "board",
    { ScopeVersion: 1, Status: "ready", LockedAt: locked, PlanHours: tickets.reduce((h, x) => h + x.hours, 0), EngineJobId: planJob },
    { by: lead, at: plannedAt },
  );

  // Previews of the built milestones, the build notes and the audit of each build start.
  const devUrl = d.urls.dev;
  for (const b of buildJobs) {
    const m = c.milestones[b.mi]!;
    await audit(c.w, { actor: lead, action: "build.start", targetType: "milestone", targetId: m.id, targetLabel: m.plan.name, at: plus(c, b.start, -1), ws: c.ws, projectId: c.id, details: { milestone: m.number } });
    await notify(c.w, {
      kind: "build.started",
      to: followers(c),
      params: { projectId: c.id, projectName: c.plan.name, milestoneName: m.plan.name, workspaceId: c.ws.id, actorName: nameOf(lead) },
      link: `/p/${c.id}/build`,
      at: plus(c, b.start, -1),
      eventKey: `factory:build.started:${c.id}:${m.id}:1`,
      actor: lead,
      ws: c.ws,
      projectId: c.id,
    });
    if (b.end) {
      const mine = tickets.filter((x) => x.milestone === b.mi);
      await c.s.update("EngineJob", b.id, { OutputRefs: mine.map((x) => `Ticket:${ticketIds.get(x.number)}`) }, b.end);
      const version = `0.${m.number}.0`;
      const deployAt = plus(c, b.end, 1);
      const deployJob = await job(c, {
        local: `preview-m${m.number}`,
        kind: "preview.deploy",
        status: "succeeded",
        by: lead,
        at: deployAt,
        minutes: 5,
        target: { type: "milestone", id: m.id },
        input: { projectId: c.id, milestoneId: m.id, version },
        outputs: [],
        message: `Preview ${version} is live.`,
      });
      const readyAt = plus(c, deployAt, 7);
      const previewId = await row(
        c,
        "Preview",
        `preview-m${m.number}`,
        { MilestoneId: m.id, Environment: "dev", Version: version, Url: devUrl.replace("https://", `https://m${m.number}-`), Status: "ready", ReadyAt: readyAt, EngineJobId: deployJob },
        { by: lead, at: readyAt },
      );
      await c.s.update("EngineJob", deployJob, { OutputRefs: [`Preview:${previewId}`, `Milestone:${m.id}`] }, readyAt);
      await notify(c.w, {
        kind: "preview.ready",
        to: [...followers(c), ...(c.plan.assignee ? [c.plan.assignee] : [])],
        params: { projectId: c.id, projectName: c.plan.name, milestoneName: m.plan.name, workspaceId: c.ws.id },
        link: `/p/${c.id}/build`,
        at: readyAt,
        eventKey: `factory:preview.ready:${c.id}:${m.id}:${version}`,
        ws: c.ws,
        projectId: c.id,
      });
    }
  }

  if (c.step === "release") await seedRelease(c, buildJobs[buildJobs.length - 1]!, ticketIds.size);
}

async function insertTickets(c: Ctx, tickets: Tk[], planJob: string): Promise<Map<number, string>> {
  const ids = new Map<number, string>();
  const order = new Map<string, number>();
  for (const tk of tickets) {
    const lane = `${tk.milestone ?? "cr"}:${tk.column}`;
    const sort = order.get(lane) ?? 0;
    order.set(lane, sort + 1);
    const last = tk.events.reduce((m, e) => (e.at > m ? e.at : m), tk.createdAt);
    const milestoneId = tk.milestone === null ? "" : c.milestones[tk.milestone]!.id;
    const id = await row(
      c,
      "Ticket",
      `ticket-${tk.number}`,
      {
        Number: tk.number,
        PlanRef: tk.planRef,
        Title: tk.title,
        TicketType: tk.type,
        FeatureRef: tk.featureRef,
        StoryRef: "",
        MilestoneId: milestoneId,
        AgentRole: OWNER[tk.column],
        Column: tk.column,
        EstimateHours: tk.hours,
        Acceptance: tk.acceptance,
        SortOrder: sort,
        Description: tk.description,
        IsDone: tk.column === "done",
        ...(tk.doneAt ? { DoneAt: tk.doneAt } : {}),
        Source: tk.source,
        ...(tk.changeRequest ? { ChangeRequestId: tk.changeRequest } : {}),
        EngineJobId: tk.source === "plan" ? planJob : tk.job ?? "",
        DependsOn: [],
      },
      { by: c.plan.lead, at: tk.createdAt, updatedAt: last },
    );
    ids.set(tk.number, id);
    for (const [i, e] of tk.events.entries()) {
      await row(
        c,
        "TicketEvent",
        `ticket-${tk.number}-ev-${i}`,
        {
          TicketId: id,
          Kind: e.kind,
          FromColumn: e.from ?? "",
          ToColumn: e.to ?? "",
          AuthorUserId: e.person ? u(c, e.person) : "",
          AuthorLabel: e.person ? "" : e.label,
          Text: e.text,
          At: e.at,
          IsAuto: !e.person,
          EngineJobId: e.person || e.to === "planned" ? "" : tk.job ?? "",
        },
        { by: e.person ?? c.plan.lead, at: e.at },
      );
    }
  }
  // The dependencies once every ticket has its id (a ticket may wait for one later on the board).
  for (const tk of tickets) {
    if (tk.deps.length === 0) continue;
    const last = tk.events.reduce((m, e) => (e.at > m ? e.at : m), tk.createdAt);
    await c.s.update("Ticket", ids.get(tk.number)!, { DependsOn: tk.deps.map((n) => ids.get(n)!) }, last);
  }
  return ids;
}

// ── approvals ───────────────────────────────────────────────────────────────────────────────────────────────────

const STEP_LABEL = { architect: "Architect", security: "Security", qa: "QA tester", custom: "" } as const;

async function seedPolicy(c: Ctx, p: NonNullable<NonNullable<Ctx["plan"]["delivery"]>["policies"]>[number]): Promise<void> {
  const at = t(c, p.at);
  const id = await row(
    c,
    "ApprovalPolicy",
    `policy-${p.env}`,
    { Environment: p.env, Status: "active", AllApproversRequired: p.allRequired, Note: p.note },
    { by: p.by, at, requestKey: `approvalPolicy:${c.id}:${p.env}` },
  );
  c.refs.set(`policy:${p.env}`, id);
  for (const [i, st] of p.steps.entries()) {
    await row(
      c,
      "ApprovalStep",
      `policy-${p.env}-step-${i}`,
      {
        ParentType: "policy",
        ParentId: id,
        StepKey: `${i}-${st.type}`,
        StepType: st.type,
        Label: st.type === "custom" ? st.label ?? "" : STEP_LABEL[st.type],
        Required: st.required,
        ApproverUserIds: st.approvers.map((x) => u(c, x)),
        Decision: "",
        SortOrder: i,
      },
      { by: p.by, at },
    );
  }
  await audit(c.w, { actor: p.by, action: "approvalPolicy.save", targetType: "approval-policy", targetId: id, targetLabel: `${c.plan.name} · ${p.env}`, at, ws: c.ws, projectId: c.id, details: { environment: p.env, steps: p.steps.length } });
}

// ── release ─────────────────────────────────────────────────────────────────────────────────────────────────────

async function seedRelease(c: Ctx, lastBuild: { id: string; end?: string }, planTicketCount: number): Promise<void> {
  const d = c.plan.delivery!;
  const lead = c.plan.lead;
  const last = c.milestones[c.milestones.length - 1]!;
  const releasedAt = plus(c, lastBuild.end!, 30);
  const devVersions: string[] = [];
  const crIds = new Map<number, { id: string; version: string | null; plan: ChangePlan }>();

  const dev1 = await row(
    c,
    "Release",
    "release-dev-1.0.0",
    { Environment: "dev", Version: "1.0.0", Url: d.urls.dev, Status: "released", ChangeRequestIds: [], MilestoneId: last.id, ReleasedAt: releasedAt, ReleasedByUserId: u(c, lead), EngineJobId: lastBuild.id },
    { by: lead, at: releasedAt },
  );
  devVersions.push("1.0.0");
  c.refs.set("release:dev:1.0.0", dev1);
  await releaseNote(c, "dev", "1.0.0", releasedAt);

  // Change requests in order; numbers are shared by every lane.
  let ticketNo = planTicketCount;
  for (const [i, cp] of (d.changes ?? []).entries()) {
    const number = i + 1;
    const at = t(c, cp.at);
    const version = cp.status === "draft" ? null : changeVersionAtStart(cp.lane, devVersions);
    const crId = await row(
      c,
      "ChangeRequest",
      `cr-${number}`,
      {
        Number: number,
        Lane: cp.lane,
        FeatureRef: cp.feature ? `feature:${cp.feature}` : "",
        Title: cp.title,
        Description: cp.description,
        Status: cp.status,
        Version: version ?? "",
        RequestedByUserId: u(c, cp.by),
      },
      { by: cp.by, at, updatedAt: cp.built ? t(c, cp.built) : at, updatedBy: cp.status === "draft" ? cp.by : lead },
    );
    crIds.set(number, { id: crId, version, plan: cp });
    c.refs.set(`cr:${number}`, crId);
    if (version) c.refs.set(`crversion:${number}`, version);
    if (cp.status === "draft") continue;

    const start = t(c, cp.built!);
    const building = cp.status === "building";
    const buildMinutes = 50 + cp.tickets.length * 18;
    // The change's tickets: done when released, spread over the columns while building; a ticket on the same subject
    // as an earlier one (or its tests and docs) waits for it.
    const changeDeps = changeDependencies(cp.tickets.map((x) => x.title));
    const tks: Tk[] = cp.tickets.map((x, k) => {
      const fix = cp.lane === "fix";
      return {
        number: ticketNo + k + 1,
        planRef: fix ? `fx:${number}:${crId}` : `cr:${crId}:${k}`,
        title: x.title,
        type: fix || cp.lane === "change" ? "fix" : "story",
        featureRef: cp.feature ? `feature:${cp.feature}` : "",
        milestone: null,
        hours: x.hours,
        acceptance: x.acceptance,
        description: fix ? `FX-${number} · ${cp.description}` : cp.description,
        source: fix ? "fix" : "change-request",
        changeRequest: crId,
        column: "planned",
        createdAt: plus(c, start, 0.5),
        events: [{ kind: "move", to: "planned", label: "planner", text: `Created in Planned: ${x.title}.`, at: plus(c, start, 0.5) }],
        deps: changeDeps[k]!.map((j) => ticketNo + j + 1),
      };
    });
    ticketNo += tks.length;
    const chain = chainLength(tks.map((tk) => String(tk.number)), (id) => tks.find((tk) => tk.number === Number(id))!.deps.map(String));
    const plan = schedule(tks, { slot: 6, stepMin: (buildMinutes * 0.8) / 9 / (chain > 1 ? 1.4 : 1), seedOf: (tk) => tk.number });
    plan.play(c, start);
    if (building) tks.forEach((tk) => cut(tk, c.s.clock.nowMs - 2 * 60_000));
    // a build whose tickets wait for each other may take longer than planned
    const jobMinutes = Math.max(buildMinutes, Math.ceil(plan.minutes) + 1);
    const jobId = await job(c, {
      local: `change-${number}`,
      kind: "change.build",
      status: building ? "running" : "succeeded",
      by: lead,
      at: start,
      minutes: jobMinutes,
      input: { projectId: c.id, changeRequestId: crId },
      outputs: building ? [] : [`ChangeRequest:${crId}`],
      progress: building ? Math.round((cp.progress ?? 0.4) * 100) : 100,
      message: building ? `Building ${changeCode({ lane: cp.lane, number })}: ${cp.title}.` : `${changeCode({ lane: cp.lane, number })} released to dev as ${version}.`,
      requestKey: `job:change.build:${crId}:1`,
    });
    for (const tk of tks) tk.job = jobId;
    await insertTickets(c, tks, "");
    await audit(c.w, { actor: lead, action: "cr.startBuild", targetType: "change-request", targetId: crId, targetLabel: `${changeCode({ lane: cp.lane, number })} ${cp.title}`, at: start, ws: c.ws, projectId: c.id, details: { version } });
    if (building) continue;
    const doneAt = plus(c, start, jobMinutes + 2);
    const devId = await row(
      c,
      "Release",
      `release-dev-${version}`,
      { Environment: "dev", Version: version, Url: d.urls.dev, Status: "released", ChangeRequestIds: [crId], ReleasedAt: doneAt, ReleasedByUserId: u(c, lead), EngineJobId: jobId },
      { by: lead, at: doneAt },
    );
    devVersions.push(version!);
    c.refs.set(`release:dev:${version}`, devId);
    await notify(c.w, {
      kind: "change.released",
      to: [cp.by, ...followers(c)],
      params: { projectId: c.id, projectName: c.plan.name, changeNumber: changeCode({ lane: cp.lane, number }), workspaceId: c.ws.id },
      link: `/p/${c.id}/delivered?env=dev`,
      at: doneAt,
      eventKey: `factory:change.released:${c.id}:${crId}`,
      ws: c.ws,
      projectId: c.id,
    });
  }

  for (const pr of d.promotions ?? []) await seedPromotion(c, pr, [...crIds.values()]);
}

async function releaseNote(c: Ctx, env: "dev" | "stage" | "production", version: string, at: string): Promise<void> {
  await notify(c.w, {
    kind: env === "dev" ? "release.created" : "release.promoted",
    to: [...followers(c), ...(c.plan.delivery?.promoter ? [c.plan.delivery.promoter] : [])],
    params: { projectId: c.id, projectName: c.plan.name, environment: env, version, workspaceId: c.ws.id },
    link: `/p/${c.id}/delivered?env=${env}`,
    at,
    eventKey: `factory:release.${env === "dev" ? "created" : "promoted"}:${c.id}:${env}:${version}`,
    ws: c.ws,
    projectId: c.id,
  });
}

async function seedPromotion(c: Ctx, pr: NonNullable<NonNullable<Ctx["plan"]["delivery"]>["promotions"]>[number], crs: { id: string; version: string | null; plan: ChangePlan }[]): Promise<void> {
  const d = c.plan.delivery!;
  const policy = d.policies?.find((p) => p.env === pr.env);
  if (!policy) throw new Error(`seed: ${c.plan.key} promotes to ${pr.env} without a policy`);
  const policyId = ref(c, `policy:${pr.env}`);
  let approvedId: string | null = null;
  let approvedAt: string | null = null;
  for (const [ai, att] of pr.attempts.entries()) {
    const at = t(c, att.at);
    const decided = att.decisions.map((x) => t(c, x.at)).sort();
    const decidedAt = att.status === "pending" ? undefined : decided[decided.length - 1] ?? at;
    const reqId = await row(
      c,
      "ApprovalRequest",
      `request-${pr.env}-${pr.version}-${ai + 1}`,
      {
        PolicyId: policyId,
        Environment: pr.env,
        Version: pr.version,
        Attempt: ai + 1,
        Status: att.status,
        RequestedByUserId: u(c, pr.requestedBy),
        RequestedAt: at,
        ...(decidedAt ? { DecidedAt: decidedAt } : {}),
      },
      { by: pr.requestedBy, at, updatedAt: decidedAt ?? decided[decided.length - 1] ?? at },
    );
    await audit(c.w, { actor: pr.requestedBy, action: "approvalRequest.create", targetType: "approval-request", targetId: reqId, targetLabel: `${c.plan.name} ${pr.version} → ${pr.env}`, at, ws: c.ws, projectId: c.id, details: { environment: pr.env, version: pr.version, attempt: ai + 1 } });
    const approvers = [...new Set(policy.steps.flatMap((s) => s.approvers))];
    await notify(c.w, {
      kind: "approval.requested",
      to: approvers,
      params: { projectId: c.id, projectName: c.plan.name, environment: pr.env, version: pr.version, actorName: nameOf(pr.requestedBy), workspaceId: c.ws.id },
      link: `/p/${c.id}/delivered?env=${pr.env}`,
      at,
      eventKey: `approval.requested:${reqId}`,
      actor: pr.requestedBy,
      ws: c.ws,
      projectId: c.id,
    });
    for (const [i, st] of policy.steps.entries()) {
      const dec = att.decisions.find((x) => x.type === st.type);
      const dat = dec ? t(c, dec.at) : undefined;
      await row(
        c,
        "ApprovalStep",
        `request-${pr.env}-${pr.version}-${ai + 1}-step-${i}`,
        {
          ParentType: "request",
          ParentId: reqId,
          StepKey: `${i}-${st.type}`,
          StepType: st.type,
          Label: st.type === "custom" ? st.label ?? "" : STEP_LABEL[st.type],
          Required: st.required,
          ApproverUserIds: st.approvers.map((x) => u(c, x)),
          Decision: dec?.decision ?? "pending",
          ...(dec && dat ? { DecidedByUserId: u(c, dec.by), DecidedAt: dat, Comment: dec.comment ?? "" } : {}),
          SortOrder: i,
        },
        { by: pr.requestedBy, at, updatedAt: dat, updatedBy: dec?.by },
      );
      if (dec && dat) {
        await audit(c.w, { actor: dec.by, action: "approvalRequest.decide", targetType: "approval-request", targetId: reqId, targetLabel: `${c.plan.name} ${pr.version} → ${pr.env}`, at: dat, ws: c.ws, projectId: c.id, details: { stepType: st.type, decision: dec.decision } });
        await notify(c.w, {
          kind: "approval.decided",
          to: [pr.requestedBy],
          params: { projectId: c.id, projectName: c.plan.name, environment: pr.env, version: pr.version, decision: dec.decision, actorName: nameOf(dec.by), stepType: st.type, workspaceId: c.ws.id },
          link: `/p/${c.id}/delivered?env=${pr.env}`,
          at: dat,
          eventKey: `approval.decided:${reqId}:${i}`,
          actor: dec.by,
          ws: c.ws,
          projectId: c.id,
        });
      }
    }
    if (att.status === "approved") {
      approvedId = reqId;
      approvedAt = decidedAt!;
    }
  }
  if (!approvedId || !pr.promotedAt) return;
  const at = t(c, pr.promotedAt);
  if (at < approvedAt!) throw new Error(`seed: ${c.plan.key} promotes ${pr.version} before its approval`);
  const promoter = d.promoter ?? c.plan.lead;
  const carried = crs.filter((x) => x.version === pr.version).map((x) => x.id);
  const releaseId = await row(
    c,
    "Release",
    `release-${pr.env}-${pr.version}`,
    {
      Environment: pr.env,
      Version: pr.version,
      Url: (pr.env === "stage" ? d.urls.stage : d.urls.production) ?? "",
      Status: "released",
      ChangeRequestIds: carried,
      ApprovalRequestId: approvedId,
      ReleasedAt: at,
      ReleasedByUserId: u(c, promoter),
    },
    { by: promoter, at },
  );
  c.refs.set(`release:${pr.env}:${pr.version}`, releaseId);
  await audit(c.w, { actor: promoter, action: "release.promote", targetType: "release", targetId: releaseId, targetLabel: `${c.plan.name} ${pr.version} → ${pr.env}`, at, ws: c.ws, projectId: c.id, details: { environment: pr.env, version: pr.version, changes: carried.length } });
  await releaseNote(c, pr.env, pr.version, at);
}

/** A short, stable commit-like hash for texts. */
export const shortSha = (name: string): string => hexOf(name, 7);
