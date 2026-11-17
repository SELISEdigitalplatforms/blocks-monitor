// board.plan: the locked scope broken into tickets — one story ticket per story of each milestone's features, plus
// the cross-cutting tasks a team adds (the build pipeline, sign-in and roles, a connection to another system, offline
// storage on the phone, a security review) — each created in Planned with its first board event. The tickets are
// written a few at a time (each insert has its own RequestKey, so the order does not matter and a resumed run gets
// its rows back). A re-plan keeps tickets that already moved and updates the ones still in Planned (by PlanRef);
// nothing is deleted (as the unlock keeps planned tickets).
// Every ticket gets its dependencies (DependsOn: the tickets it waits for, planned as a team plans them, see
// src/domain/ticketDeps.ts): the ones that exist already at once, the rest once every ticket exists.
// Every ticket names the role that does its work (AgentRole, src/domain/ticketRole.ts): the tech lead for the stories
// and the build tasks, SecOps for a security review; a re-plan gives a ticket still in Planned its role again.
// Every ticket's EstimateHours is the real estimate (src/domain/engineEstimate.ts): the build time it adds to its
// milestone's build on MADP, measured from the builds MADP finished, as a fraction of an hour; the board's PlanHours is
// the build time of every milestone's build. The screens compute the same from the same calibration. Without enough
// measured builds both are left out: never a guessed person-hour figure.
import type { Row } from "../../../../../functions/_lib/gateway";
import { planDependencies, type DepItem } from "../../../../../src/domain/ticketDeps";
import { plannedRoleOf, type TaskKind } from "../../../../../src/domain/ticketRole";
import type { ChatRole } from "../../../../../src/domain/agentChat";
import { briefFactsOf } from "../../../../../src/domain/projectBrief";
import { num, str, strs } from "../../context.ts";
import { inParallel, type JobRun, type KindResult } from "../../run.ts";
import { cap, clip, listOf, lower, plural } from "../../text.ts";
import { early } from "../../ai/index.ts";
import { planEstimateHours } from "../../../../../src/domain/engineEstimate";
import { estimateField, readCalibration } from "../../estimates.ts";
import { aiTasks } from "./ai.ts";
import { WORDS, actorsOf, actorsPlural, includedFeatures, mentions, type FeatureInfo } from "./common.ts";

export interface PlanTicket {
  planRef: string;
  title: string;
  type: "story" | "task";
  featureRef: string;
  milestoneId: string;
  milestoneNumber: number;
  acceptance: string[];
  description: string;
  /** the role that does the work (Ticket.AgentRole) */
  agentRole: ChatRole;
}

export interface Task {
  tag: string;
  /** what kind of work it is (the role that does it follows from it); "other" when not given */
  kind?: TaskKind;
  title: string;
  hours: number;
  description: string;
  acceptance: string[];
  feature?: string;
}

const shortClient = (name: string): string => name.replace(/\s+(AG|GmbH|SA|Sàrl|SARL|Ltd\.?|Inc\.?|KG|AB|S\.A\.)$/i, "").trim();

function systemOf(text: string): string {
  const t = text.toLowerCase();
  return /\bsap\b/.test(t) ? "SAP" : /abacus/.test(t) ? "Abacus" : /bexio/.test(t) ? "bexio" : /\berp\b/.test(t) ? "ERP" : /\bcrm\b/.test(t) ? "CRM" : /accounting/.test(t) ? "accounting system" : "connected system";
}

const PERSONAL: [RegExp, string][] = [
  [/payslip|salar/, "payroll data"],
  [/signature|photo/, "photos and signatures"],
  [/bank|iban/, "bank details"],
  [/price|invoice/, "pricing data"],
  [/employee|personal|address|contact/, "personal data"],
  [/certificate|document|receipt|tax/, "uploaded documents"],
];

/** The cross-cutting tasks of each milestone (index 0-based), at most two per milestone. */
export function tasksFor(o: {
  milestones: { features: FeatureInfo[] }[];
  all: FeatureInfo[];
  projectName: string;
  client: string;
  existingProduct: boolean;
  repoName: string;
  brief: string;
}): Task[][] {
  const out: Task[][] = o.milestones.map(() => []);
  if (out.length === 0) return out;
  const add = (i: number, t: Task) => {
    if (out[i]!.length < 2) out[i]!.push(t);
  };
  const allText = `${o.brief} ${o.all.map((f) => f.text).join(" ")}`.toLowerCase();
  const mobile = /\bapp\b|mobile app|driver|technician|plant room|on site|tablet|offline/.test(`${o.projectName} ${allText}`.toLowerCase());

  add(0, {
    tag: "ci",
    kind: "pipeline",
    title: "Build pipeline and preview environment",
    hours: 3,
    description: o.existingProduct
      ? `Pipeline for the changes to ${o.repoName || "the existing product"} with a preview environment per milestone, next to the existing release process.`
      : `Pipeline for ${o.projectName} with a preview environment per milestone${mobile ? ", installable on the team's phones" : ""}.`,
    acceptance: o.existingProduct
      ? ["Every milestone is deployed to its preview", "The existing release process keeps working unchanged"]
      : ["Every milestone is deployed to its preview", mobile ? "The preview can be installed on Android and iPhone" : "Every change runs the automated checks before it is merged"],
  });

  const actors = actorsOf(o.all);
  if (!o.all.some((f) => mentions(f.text, WORDS.access))) {
    const who = shortClient(o.client);
    add(0, {
      tag: "auth",
      kind: "access",
      title: who ? `Sign-in and roles for ${who}` : "Sign-in and roles",
      hours: 4,
      description: actors.length
        ? `${cap(listOf(actors.slice(0, 3).map((a) => actorsPlural(a))))} sign in with their own accounts; each role sees only what it needs.`
        : "People sign in with their own accounts; each role sees only what it needs.",
      acceptance: ["Every role signs in with its own account", "A person sees only the data their role allows"],
    });
  }

  const integ = o.milestones.findIndex((m) => m.features.some((f) => mentions(`${f.title} ${f.description}`, WORDS.integration)));
  if (integ >= 0) {
    const f = o.milestones[integ]!.features.find((g) => mentions(`${g.title} ${g.description}`, WORDS.integration))!;
    const system = systemOf(f.text);
    add(integ, {
      tag: `int-${f.key}`.slice(0, 40),
      kind: "interface",
      title: `Interface to the ${system}`,
      hours: 4,
      feature: f.key,
      description: `File format, schedule and error reporting of the ${system} interface for ${lower(f.title)}, agreed with the ${system} owner.`,
      acceptance: [`The ${system} accepts a complete transfer without manual corrections`, "A failed transfer is reported and can be repeated"],
    });
  }

  if (mobile) {
    const at = Math.max(0, o.milestones.findIndex((m) => m.features.some((f) => mentions(f.text, WORDS.mobile))));
    const i = out[at]!.length < 2 ? at : Math.min(out.length - 1, at + 1);
    add(i, {
      tag: "offline-store",
      kind: "offline",
      title: "Offline storage on the phone",
      hours: 4,
      description: "Local storage of what people enter and photograph, so the app keeps working without signal.",
      acceptance: ["Entries survive a restart of the phone", "Waiting entries are sent as soon as the connection is back"],
    });
  }

  const sensitive = PERSONAL.find(([re]) => re.test(allText));
  if (sensitive) {
    const noun = sensitive[1];
    const at = o.milestones.findIndex((m) => m.features.some((f) => sensitive[0].test(f.text)));
    let i = at >= 0 ? at : out.length - 1;
    while (i < out.length - 1 && out[i]!.length >= 2) i += 1;
    add(i, {
      tag: "sec",
      kind: "review",
      title: `Security review of ${noun}`,
      hours: 3,
      description: `Check storage, access and retention of ${noun}.`,
      acceptance: [`Only the roles that need them can open ${noun}`, "Findings are fixed or accepted by IT security"],
    });
  }
  return out;
}

/** What each ticket of the plan waits for, by PlanRef (pure). */
export function planDeps(plan: readonly PlanTicket[], milestones: { number: number; features: FeatureInfo[] }[]): Map<string, string[]> {
  const items: DepItem[] = plan.map((t) => ({
    ref: t.planRef,
    milestone: t.milestoneNumber,
    kind: t.type,
    feature: t.featureRef.replace(/^feature:/, ""),
    tag: t.type === "task" && t.planRef.startsWith("x.") ? t.planRef.slice(2) : "",
    title: t.title,
    text: `${t.description} ${t.acceptance.join(" ")}`,
  }));
  const features = milestones.flatMap((m) =>
    m.features.map((f) => ({ key: f.key, milestone: m.number, title: f.title, description: f.description, actors: f.stories.map((s) => s.actor).filter(Boolean) })),
  );
  return planDependencies({ items, features });
}

/** The tickets of the plan, in board order (pure). */
export function planTickets(o: {
  milestones: { id: string; number: number; features: FeatureInfo[] }[];
  tasks: Task[][];
}): PlanTicket[] {
  const out: PlanTicket[] = [];
  o.milestones.forEach((m, mi) => {
    let i = 0;
    for (const f of m.features) {
      for (const s of f.stories) {
        out.push({
          planRef: `r${mi + 1}.${i++}`,
          title: clip(s.title, 200),
          type: "story",
          featureRef: f.ref,
          milestoneId: m.id,
          milestoneNumber: m.number,
          acceptance: s.criteria,
          description: s.text || s.title,
          agentRole: plannedRoleOf({ type: "story" }),
        });
      }
    }
    for (const t of o.tasks[mi] ?? []) {
      out.push({
        planRef: `x.${t.tag}`,
        title: t.title,
        type: "task",
        featureRef: t.feature ? `feature:${t.feature}` : "",
        milestoneId: m.id,
        milestoneNumber: m.number,
        acceptance: t.acceptance,
        description: t.description,
        agentRole: plannedRoleOf({ type: "task", kind: t.kind ?? "other" }),
      });
    }
  });
  return out;
}

export async function boardPlan(run: JobRun): Promise<KindResult> {
  const p = run.p;
  const version = num(run.input.scopeVersion, p.scopeVersion) || p.scopeVersion;
  const features = includedFeatures(p, version);
  const byRef = new Map(features.map((f) => [f.ref, f]));
  const milestoneRows = p.milestones(version);
  const milestones = milestoneRows.map((m) => ({
    id: str(m.ItemId),
    number: num(m.Number),
    name: str(m.Name),
    features: (Array.isArray(m.FeatureRefs) ? (m.FeatureRefs as unknown[]) : []).flatMap((r) => {
      const f = byRef.get(String(r));
      return f ? [f] : [];
    }),
  }));
  const stories = milestones.reduce((n, m) => n + m.features.reduce((k, f) => k + f.stories.length, 0), 0);
  // Claude's cross-cutting tasks, started now and read before the tickets are written (else the built-in ones)
  const tasksAi = milestones.length ? early(aiTasks(run, milestones)) : Promise.resolve(null);
  // the calibration of the real estimates, read meanwhile (kept 10 minutes per process); a failed read writes none
  const calibration = milestones.length ? readCalibration(run) : Promise.resolve(null);
  await run.step(6, `Reading locked scope v${version}: ${plural(milestones.length, "milestone")} and ${plural(stories, "story", "stories")}.`);
  await run.wait(3);
  if (milestones.length === 0) return { outputs: [], message: `Scope v${version} has no milestones to plan.` };

  const tasks = (await tasksAi) ?? tasksFor({
    milestones,
    all: features,
    projectName: p.name,
    client: p.client,
    existingProduct: p.existingProduct,
    repoName: p.repo.name,
    brief: briefFactsOf(p).description,
  });
  const plan = planTickets({ milestones, tasks });
  const deps = planDeps(plan, milestones);
  const cal = await calibration;
  const planHours = planEstimateHours(cal, milestones.map((m) => plan.filter((t) => t.milestoneId === m.id).map((t) => t.type)));

  // The board row: building while the planner works.
  const sv = p.scopeVersionRow(version);
  const lockedAt = str(sv?.LockedAt) || str(p.project.ScopeLockedAt);
  const planned: Row = planHours === undefined ? {} : { PlanHours: planHours };
  const boardFields: Row = { ScopeVersion: version, Status: "building", ...planned, EngineJobId: run.id, ...(lockedAt ? { LockedAt: lockedAt } : {}) };
  const board = p.rows("Board")[0];
  const boardId = board ? str(board.ItemId) : await run.insert("Board", boardFields, "board");
  if (board) await run.update("Board", boardId, boardFields);

  const existing = new Map<string, Row>();
  for (const t of p.tickets()) existing.set(str(t.PlanRef), t);
  // ItemId per PlanRef as the tickets are written; a dependency on a ticket not written yet is linked at the end
  const idOf = new Map<string, string>([...existing].map(([ref, t]) => [ref, str(t.ItemId)]));
  const dependsOn = (ref: string): string[] => (deps.get(ref) ?? []).flatMap((d) => (idOf.has(d) ? [idOf.get(d)!] : []));
  // Milestones that had task tickets before this plan (from an earlier plan or the team).
  const hadTasks = new Set(p.tickets().filter((x) => x.TicketType === "task" && x.EngineJobId !== run.id).map((x) => str(x.MilestoneId)));
  let next = p.tickets().reduce((n, t) => Math.max(n, num(t.Number)), 0) + 1;
  const lane = new Map<string, number>();
  const perTicket = Math.min(2.2, Math.max(0.6, 26 / plan.length));
  let current = 0;

  // the plan in board order: sort order per lane and the ticket number of each new ticket, decided before any write
  const work: { t: PlanTicket; fields: Row; had?: Row; number: number }[] = [];
  for (const t of plan) {
    const sort = lane.get(t.milestoneId) ?? 0;
    lane.set(t.milestoneId, sort + 1);
    const fields: Row = {
      PlanRef: t.planRef,
      Title: t.title,
      TicketType: t.type,
      FeatureRef: t.featureRef,
      StoryRef: "",
      MilestoneId: t.milestoneId,
      AgentRole: t.agentRole,
      ...estimateField(cal, t.type),
      Acceptance: t.acceptance,
      SortOrder: sort,
      Description: t.description,
      Source: "plan",
      EngineJobId: run.id,
      DependsOn: dependsOn(t.planRef),
    };
    const had = existing.get(t.planRef);
    // A milestone the team already has tasks for gets no second set of cross-cutting tasks.
    if (!had && t.type === "task" && hadTasks.has(t.milestoneId)) continue;
    work.push({ t, fields, had, number: had ? num(had.Number) : next++ });
  }

  let done = 0;
  const outputs = await inParallel(work, 6, async ({ t, fields, had, number }, i) => {
    if (t.milestoneNumber > current) {
      current = t.milestoneNumber;
      const m = milestones.find((x) => x.number === current)!;
      await run.step(10 + Math.round((85 * i) / work.length), `Planning milestone ${current}: ${m.name}.`);
      await run.wait(1.5);
    }
    if (had) {
      // Planned again: a ticket still in Planned follows the new plan; one that moved on stays as it is.
      if (had.Column === "planned" && had.IsDone !== true) await run.update("Ticket", str(had.ItemId), fields);
      return `Ticket:${str(had.ItemId)}`;
    }
    await run.wait(perTicket);
    const id = await run.insert("Ticket", { Number: number, ...fields, Column: "planned", IsDone: false }, `ticket-${t.planRef}`);
    idOf.set(t.planRef, id);
    await run.insert(
      "TicketEvent",
      { TicketId: id, Kind: "move", FromColumn: "", ToColumn: "planned", AuthorUserId: "", AuthorLabel: "planner", Text: `Created in Planned: ${t.title}.`, At: run.iso(), IsAuto: true, EngineJobId: "" },
      `ticket-${t.planRef}-created`,
    );
    done += 1;
    await run.step(10 + Math.round((85 * done) / work.length), `Planned #${number}: ${clip(t.title, 120)}.`);
    return `Ticket:${id}`;
  });

  // The dependencies on tickets written in this plan, now that every ticket exists (tickets that moved on keep theirs).
  await inParallel(plan, 6, async (t) => {
    const id = idOf.get(t.planRef);
    const row = id ? p.row("Ticket", id) : null;
    if (!row || row.Column !== "planned" || row.IsDone === true) return;
    const want = dependsOn(t.planRef);
    const have = strs(row.DependsOn);
    if (want.length !== have.length || want.some((d, i) => d !== have[i])) await run.update("Ticket", id!, { DependsOn: want });
  });

  await run.update("Board", boardId, { Status: "ready", ...planned });
  return { outputs, message: `Planned ${plural(outputs.length, "ticket")} for ${plural(milestones.length, "milestone")}.` };
}
