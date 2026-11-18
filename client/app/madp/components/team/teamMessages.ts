/** The project team as people the client talks to (the owner's software-company picture): YOUR BUSINESS ANALYST owns what
 *  gets built (change requests, their questions, conflicts and approval) and YOUR TECH LEAD owns the engineering (builds,
 *  pausing and resuming, technical questions). Pure: every message is worded from real rows (ChangeRequest and its
 *  Analysis, EngineJob, Milestone, Preview, AgentChatMessage); nothing is invented, and a row without a time shows none. */
import type { DeliveryChangeRequest } from "@/madp/blocks/delivery/types";
import type { EngineJob } from "@/madp/blocks/engine/types";
import type { ChangeDecideRight } from "@/madp/domain/delivery";
import { changeCode } from "@/madp/domain/delivery";
import { changesNotUsable, isAfterDeployRetry } from "@/madp/domain/afterDeploy";
import { checksSettled, fixRoundOf, isRevert } from "@/madp/domain/changeChecks";
import { MAX_JOB_ATTEMPTS, isTerminal } from "@/madp/domain/engineJob";
import { analysisOf, buildCount, changeStage, decisionOf, featureProgress, ticketCount } from "@/madp/components/changes/changeFlow";
import { changeWaitJobOf, changesWaiting, releaseDeployInput, waitOf, type ChangeWait } from "./changeWaiting";
import { t } from "@/madp/i18n";

export type TeamContactId = "analyst" | "lead";
export const TEAM_CONTACT_IDS: readonly TeamContactId[] = ["analyst", "lead"];

export interface TeamContact { initials: string; name: string; short: string; role: string }

/** The two team members in the current language (read at render time). */
export function teamContact(contact: TeamContactId): TeamContact {
  return contact === "analyst"
    ? {
      initials: t("team.contacts.analyst.initials", "BA"), name: t("team.contacts.analyst.name", "Your business analyst"),
      short: t("team.contacts.analyst.short", "Business analyst"),
      role: t("team.contacts.analyst.role", "Owns what gets built: new features, changes, open questions and conflicts."),
    }
    : {
      initials: t("team.contacts.lead.initials", "TL"), name: t("team.contacts.lead.name", "Your tech lead"),
      short: t("team.contacts.lead.short", "Tech lead"),
      role: t("team.contacts.lead.role", "Owns the engineering: builds, pausing and resuming them, technical questions."),
    };
}

/** analyst / lead: the team member speaks; person: someone on the project (the signed-in person is "You"); note: a small
 *  line between messages. */
export type TeamAuthor = "analyst" | "lead" | "person" | "note";
export type TeamTone = "plain" | "working" | "attention" | "done" | "problem";

export type TeamAction =
  /** an open analysis question, answered inline with cr.answer */
  | { kind: "question"; changeRequestId: string; questionId: string }
  /** approve or decline with cr.decide (the four-eyes rule decides who sees it) */
  | { kind: "decide"; changeRequestId: string; scopeRoute: boolean; feature: { builds: number; tickets: number } | null }
  /** cr.submit: a saved draft, or an analysis that stopped */
  | { kind: "submit"; changeRequestId: string; label: string; disabledReason: string | null }
  /** job.cancel on an active build */
  | { kind: "pause"; jobId: string; name: string }
  /** start a stopped build again: job.retry (failed and retryable), build.start (a milestone) or cr.startBuild (a change) */
  | { kind: "resume"; how: "retry" | "milestone" | "change"; jobId: string; targetId: string; name: string }
  /** cr.startBuild on an approved change (or its next increment) */
  | { kind: "startChange"; changeRequestId: string; label: string }
  | { kind: "open"; href: string; label: string };

export interface TeamMessage {
  /** stable across reads */
  id: string;
  author: TeamAuthor;
  /** who, for author "person": "You" for the signed-in person, else the member's name */
  name?: string;
  /** author "person": the signed-in person wrote it */
  mine?: boolean;
  /** ISO time from the row; null when the row has none */
  at: string | null;
  text: string;
  tone: TeamTone;
  /** a job that is still working: its progress (never invented: null until the job reports one) */
  job?: { id: string; progress: number | null; working: boolean };
  /** a technical question still waiting for its answer: the chat.reply job */
  waitingJobId?: string;
  action?: TeamAction;
  /** waiting for the signed-in person */
  needsYou?: boolean;
}

export interface TeamGroup {
  id: string;
  title: string;
  /** the page the group is about */
  href: string | null;
  messages: TeamMessage[];
  /** the newest dated message (ms); -Infinity when none is dated */
  latest: number;
}

export interface TeamThread {
  groups: TeamGroup[];
  /** the newest dated message the team member wrote (ms), for the unread dot */
  latestFromContact: number;
  /** messages waiting for the signed-in person */
  needsYou: number;
  /** the newest line, for the contact list */
  lastLine: string | null;
}

const ms = (at: string | null | undefined): number | null => {
  if (!at) return null;
  const t = Date.parse(at);
  return Number.isFinite(t) ? t : null;
};

const clip = (s: string, max: number): string => (s.length > max ? `${s.slice(0, max - 1).trimEnd()}…` : s);
/** Ends a relayed sentence with a full stop when it has no end mark. */
const sentence = (s: string): string => (/[.!?…:]$/.test(s.trim()) ? s.trim() : `${s.trim()}.`);
const cap = (s: string): string => (s ? `${s[0]!.toUpperCase()}${s.slice(1)}` : s);

function inputOf(job: Pick<EngineJob, "inputJson">): Record<string, unknown> {
  if (!job.inputJson) return {};
  try {
    const v = JSON.parse(job.inputJson) as unknown;
    return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}
const inputText = (job: Pick<EngineJob, "inputJson">, key: string): string => {
  const v = inputOf(job)[key];
  return typeof v === "string" ? v : "";
};

/** Oldest first; jobs without a date first, in list order. */
function byCreated(a: EngineJob, b: EngineJob): number {
  return (ms(a.createdAt) ?? -Infinity) - (ms(b.createdAt) ?? -Infinity);
}

const jobsOf = (jobs: readonly EngineJob[], kind: EngineJob["kind"], changeRequestId: string): EngineJob[] =>
  jobs.filter((j) => j.kind === kind && inputText(j, "changeRequestId") === changeRequestId).sort(byCreated);

const isActive = (j: Pick<EngineJob, "status">): boolean => !isTerminal(j.status);

/** What the change requests wait for from the person (changeWaiting.ts). A thread without the approval right (the
 *  tech lead's) never asks for an approval. */
function teamWaits(rows: { changes: readonly DeliveryChangeRequest[]; jobs: readonly EngineJob[]; canRun: boolean; rightOf?: (cr: DeliveryChangeRequest) => ChangeDecideRight }): ChangeWait[] {
  const byId = new Map(rows.changes.map((c) => [c.id, c]));
  return changesWaiting({
    changes: rows.changes, jobs: rows.jobs.map(changeWaitJobOf), canRun: rows.canRun,
    rightOf: (cr) => {
      const full = byId.get(cr.id);
      return full && rows.rightOf ? rows.rightOf(full) : { ok: false, reason: "notApprover", others: [] };
    },
  });
}
const jobProgress = (j: EngineJob) => ({ id: j.id, progress: j.status === "running" && Number.isFinite(j.progress) ? j.progress : null, working: j.status !== "queued" });

function finish(groups: TeamGroup[], contact: TeamContactId): TeamThread {
  let latestFromContact = -Infinity;
  let needsYou = 0;
  for (const g of groups) {
    for (const m of g.messages) {
      const at = ms(m.at);
      if (at !== null && m.author === contact && at > latestFromContact) latestFromContact = at;
      if (m.needsYou) needsYou += 1;
    }
  }
  const sorted = [...groups].sort((a, b) => a.latest - b.latest);
  const last = sorted[sorted.length - 1]?.messages.filter((m) => m.author !== "note").pop() ?? null;
  return { groups: sorted, latestFromContact, needsYou, lastLine: last ? clip(last.text.replace(/\s+/g, " "), 120) : null };
}

function group(id: string, title: string, href: string | null, messages: TeamMessage[]): TeamGroup {
  let latest = -Infinity;
  for (const m of messages) {
    const at = ms(m.at);
    if (at !== null && at > latest) latest = at;
  }
  return { id, title, href, messages, latest };
}

/** The environment a released change is on, in words. */
function releasedWord(status: string): string {
  if (status === "promoted-stage") return t("team.environment.staging", "staging");
  if (status === "promoted-production") return t("team.environment.production", "production");
  return t("team.environment.development", "development");
}
const changeTitle = (code: string, title: string): string => `${code} · ${title || t("team.thread.changeRequest", "Change request")}`;
const asVersion = (v: string | null | undefined): string => (v ? ` ${t("team.thread.asVersion", "as version {version}", { version: v })}` : "");

// ------------------------------------------------------------------------------------------- the business analyst

export interface AnalystRows {
  projectId: string;
  changes: readonly DeliveryChangeRequest[];
  /** the project's delivery jobs (change.analyse and change.build are read) */
  jobs: readonly EngineJob[];
  /** the board's tickets (a feature's builds); empty when not read */
  tickets?: readonly { planRef: string; isDone: boolean }[];
  meId: string | null;
  nameOf: (userId: string | null) => string;
  /** the signed-in person's approval right on a change (src/components/changes/changeDecide.ts changeRightFor) */
  rightOf: (cr: DeliveryChangeRequest) => ChangeDecideRight;
  /** build.run: may send, answer and start */
  canRun: boolean;
  /** the project has a development release (change requests can be sent for analysis) */
  hasDev: boolean;
}

/** One thread group per change request: the request, the analyst's analysis in plain words, the conflicts and risks she
 *  relays, her questions with their answers, the approval and what happened next. */
export function analystThread(rows: AnalystRows): TeamThread {
  const groups: TeamGroup[] = [];
  // what waits for the person: the one rule the Dashboard and Projects count with too (changeWaiting.ts)
  const waits = teamWaits(rows);
  const who = (id: string | null) => (id && id === rows.meId ? t("team.thread.you", "You") : rows.nameOf(id) || t("team.thread.someone", "Someone on the team"));
  const mine = (id: string | null) => (id && id === rows.meId ? { mine: true } : {});
  // a change whose own checks failed on development is there, but not usable: never said to be delivered
  const notUsable = changesNotUsable(rows.jobs, checksSettled(rows.changes));
  for (const cr of [...rows.changes].sort((a, b) => a.number - b.number)) {
    const code = changeCode(cr);
    const href = `/p/${rows.projectId}/build?cr=${cr.number}`;
    const analysis = analysisOf(cr);
    const decision = decisionOf(cr);
    const analyses = jobsOf(rows.jobs, "change.analyse", cr.id);
    const builds = jobsOf(rows.jobs, "change.build", cr.id);
    const lastAnalyse = analyses[analyses.length - 1] ?? null;
    const lastBuild = builds[builds.length - 1] ?? null;
    const stage = changeStage(cr.status, analysis, decision, lastBuild, lastAnalyse);
    const m: TeamMessage[] = [];
    const say = (id: string, at: string | null, text: string, tone: TeamTone = "plain", extra: Partial<TeamMessage> = {}) =>
      m.push({ id: `${cr.id}:${id}`, author: "analyst", at, text, tone, ...extra });
    const note = (id: string, at: string | null, text: string) => m.push({ id: `${cr.id}:${id}`, author: "note", at, text, tone: "plain" });

    const description = cr.description.trim();
    m.push({
      id: `${cr.id}:request`, author: "person", name: who(cr.createdByUserId), ...mine(cr.createdByUserId), at: analyses[0]?.createdAt ?? null, tone: "plain",
      text: `${cr.title.trim() || code}${description ? `\n${clip(description, 600)}` : ""}`,
    });

    if (stage === "legacy") {
      note("legacy", null, t("team.analyst.legacy", "{code} was saved before analyses were made; the tech lead builds it as it is written.", { code }));
      groups.push(group(cr.id, changeTitle(code, cr.title), href, m));
      continue;
    }
    if (stage === "draft") {
      const reason = !rows.canRun ? t("team.analyst.draftNoRole", "Your role can't send change requests.")
        : !rows.hasDev ? t("team.analyst.draftNoDev", "It can be sent once the first milestone is on the development environment.")
        : !cr.title.trim() || !cr.description.trim() ? t("team.analyst.draftNeedsText", "Add a title and a description on the change request page first.") : null;
      note("draft", null, t("team.analyst.draft", "{code} is saved as a draft. It reaches me once it's sent for analysis.", { code }));
      m[m.length - 1]!.action = { kind: "submit", changeRequestId: cr.id, label: t("team.analyst.sendForAnalysis", "Send for analysis"), disabledReason: reason };
      groups.push(group(cr.id, changeTitle(code, cr.title), href, m));
      continue;
    }
    if (stage === "analysing") {
      say("analysing", lastAnalyse?.claimedAt ?? lastAnalyse?.createdAt ?? null,
        t("team.analyst.analysing", "I'm analysing {code} against the product as it is today. I'll come back with my questions or a plan.", { code }), "working",
        lastAnalyse && isActive(lastAnalyse) ? { job: jobProgress(lastAnalyse) } : {});
    }
    if (stage === "analysisFailed") {
      say("analysisFailed", lastAnalyse?.finishedAt ?? lastAnalyse?.updatedAt ?? null,
        t("team.analyst.analysisFailed", "My analysis of {code} stopped before it finished. Nothing was changed; I can start again with the request as it is written.", { code }), "problem", {
          action: {
            kind: "submit", changeRequestId: cr.id, label: t("team.analyst.analyseAgain", "Try the analysis again"),
            disabledReason: rows.canRun ? null : t("team.analyst.analyseNoRole", "Your role can't start an analysis."),
          },
          needsYou: waitOf(waits, cr.id, "analyseAgain") !== null,
        });
    }

    if (analysis) {
      const firstAt = analyses[0]?.finishedAt ?? cr.analysedAt;
      say("summary", firstAt, analysis.summary
        ? t("team.analyst.summary", "Here's how I understand {code}: {summary}", { code, summary: sentence(analysis.summary) })
        : t("team.analyst.analysed", "I've analysed {code}.", { code }));
      // the conflicts and risks: checked against the code when the analysis could read it, else against the product or the scope
      const readCode = (analysis.codeAreas?.length ?? 0) > 0;
      const basis = readCode ? t("team.analyst.basisCode", "I checked this with the tech lead against the code")
        : analysis.route === "feature" ? t("team.analyst.basisProduct", "I checked this against what the product does today")
        : t("team.analyst.basisScope", "I checked this against the locked scope");
      analysis.conflicts.forEach((c, i) => say(`conflict:${i}`, firstAt, `${basis}: ${sentence(c)}`, "attention"));
      analysis.risks.forEach((r, i) => say(`risk:${i}`, firstAt, readCode
        ? t("team.analyst.riskFromLead", "The tech lead points out a risk: {risk}", { risk: sentence(r) })
        : t("team.analyst.risk", "One risk to keep in mind: {risk}", { risk: sentence(r) })));

      const qs = analysis.questions;
      const open = qs.filter((q) => q.answer === null).length;
      if (qs.length) {
        const n = qs.length;
        say("questions", firstAt, analysis.conflicts.length
          ? (n === 1 ? t("team.analyst.callOne", "Which way do you want it?") : t("team.analyst.callMany", "I need your call on {count} things:", { count: n }))
          : (n === 1 ? t("team.analyst.unclearOne", "One thing is unclear to me:") : t("team.analyst.unclearMany", "{count} things are unclear to me:", { count: n })));
        qs.forEach((q) => {
          say(`q:${q.id}`, firstAt, q.text, q.answer === null ? "attention" : "plain", q.answer === null ? {
            action: { kind: "question", changeRequestId: cr.id, questionId: q.id },
            needsYou: waitOf(waits, cr.id, "answer") !== null,
          } : {});
          if (q.answer !== null) {
            m.push({ id: `${cr.id}:a:${q.id}`, author: "person", name: who(q.answeredBy), ...mine(q.answeredBy), at: q.answeredAt, text: q.answer, tone: "plain" });
          }
        });
      }
      if (stage === "questions" && open > 0 && !rows.canRun) note("questions:who", null, t("team.analyst.questionsWho", "The project team answers these questions."));
      if (stage === "refining") {
        say("refining", lastAnalyse?.claimedAt ?? lastAnalyse?.createdAt ?? null, t("team.analyst.refining", "Thanks for the answers. I'm refining the plan with them."), "working",
          lastAnalyse && isActive(lastAnalyse) ? { job: jobProgress(lastAnalyse) } : {});
      }

      const planned = stage !== "questions" && stage !== "refining";
      if (planned) {
        const builds = analysis.route === "feature" && analysis.feature ? analysis.feature.increments.length : 1;
        const plan = builds > 1
          ? t("team.analyst.planBuilds", "I planned {tickets} in {builds}. Each build goes to development for you to try before the next one starts.", { tickets: ticketCount(analysis.tickets.length), builds: buildCount(builds) })
          : analysis.route === "feature"
            ? t("team.analyst.planFeature", "I planned {tickets}, built on the product as it is in one build.", { tickets: ticketCount(analysis.estimate.tickets) })
            : t("team.analyst.plan", "I planned {tickets}.", { tickets: ticketCount(analysis.estimate.tickets) });
        say("plan", cr.analysedAt, analysis.route === "scope"
          ? `${plan} ${t("team.analyst.planBeyondScope", "It goes beyond the locked scope, so it can either be built now as a change to what is there or kept for Scope & success.")}` : plan);
      }

      if (stage === "review") {
        const right = rows.rightOf(cr);
        if (right.ok) {
          const builds = analysis.route === "feature" && analysis.feature ? analysis.feature.increments.length : 0;
          say("review", cr.analysedAt, right.self
            ? t("team.analyst.reviewSelf", "{code} is waiting for your approval. You're the only approver, so you can approve it yourself.", { code })
            : t("team.analyst.review", "{code} is waiting for your approval.", { code }), "attention", {
            action: {
              kind: "decide", changeRequestId: cr.id, scopeRoute: analysis.route === "scope",
              feature: builds ? { builds, tickets: analysis.tickets.length } : null,
            },
            needsYou: waitOf(waits, cr.id, "approve") !== null,
          });
        } else {
          const others = right.others.map((id) => rows.nameOf(id)).filter(Boolean);
          say("review", cr.analysedAt, right.reason === "ownRequest" && others.length
            ? t("team.analyst.reviewOwnRequest", "You asked for this change, so {people} approves it. I'll tell you when it's decided.", { people: others.join(` ${t("team.thread.or", "or")} `) })
            : others.length ? t("team.analyst.reviewOthers", "It's waiting for {people} to approve it.", { people: others.join(` ${t("team.thread.or", "or")} `) })
            : t("team.analyst.reviewNobody", "It's waiting for an approver."));
        }
      }

      if (decision.decidedAt && stage !== "review") {
        const approved = stage !== "rejected";
        const fast = analysis.routeDecision?.route === "fast";
        const said = `${approved ? (fast ? t("team.analyst.approvedFast", "Approved, to build it now as a change.") : t("team.analyst.approved", "Approved.")) : t("team.analyst.declined", "Declined.")}${decision.decisionNote ? ` “${decision.decisionNote}”` : ""}`;
        m.push({ id: `${cr.id}:decision`, author: "person", name: who(decision.decidedByUserId), ...mine(decision.decidedByUserId), at: decision.decidedAt, text: said, tone: "plain" });
      }

      const progress = featureProgress(analysis, cr.id, rows.tickets ?? []);
      const nBuilds = progress?.increments.length ?? 0;
      switch (stage) {
        case "approved":
          if (notUsable.has(cr.id)) {
            say("approved", lastBuild?.finishedAt ?? decision.decidedAt, t("team.analyst.notUsable", "{what} is on development, but not usable yet: its own checks fail there. The next build waits until what they found is fixed.", {
              what: progress && nBuilds > 1 && progress.built > 0 ? t("team.analyst.buildOf", "Build {n} of {total}", { n: progress.built, total: nBuilds }) : code,
            }), "plain", {
              action: { kind: "open", href, label: t("team.analyst.seeWhatFails", "See what does not work") },
            });
            break;
          }
          say("approved", decision.decidedAt, progress && nBuilds > 1 && progress.built > 0 && progress.next !== null
            ? t("team.analyst.buildOnDev", "Build {n} of {total} is on development. Try it there; the tech lead starts build {next} when you say so.", { n: progress.built, total: nBuilds, next: progress.next })
            : t("team.analyst.ticketsOnBoard", "The planned tickets are on the board, and the tech lead has the plan. The build starts when you start it."), "done");
          break;
        case "scope":
          say("scope", decision.decidedAt, t("team.analyst.keptForScope", "It's kept for Scope & success, waiting for a new scope version. To get it sooner, it can still be built as a change to what is there."), "plain", {
            action: { kind: "open", href, label: t("team.thread.openChange", "Open the change request") },
          });
          break;
        case "rejected":
          say("rejected", decision.decidedAt, t("team.analyst.rejected", "Understood. {code} is closed and nothing will be built.", { code }));
          break;
        case "building":
          note("building", lastBuild?.createdAt ?? null, t("team.analyst.building", "The tech lead is building {code}.", { code }));
          break;
        case "buildFailed":
          note("buildFailed", lastBuild?.finishedAt ?? lastBuild?.updatedAt ?? null, t("team.analyst.buildFailed", "The build of {code} stopped. The tech lead can start it again.", { code }));
          break;
        case "released":
          if (notUsable.has(cr.id)) {
            say("released", lastBuild?.finishedAt ?? null, t("team.analyst.releasedNotUsable", "{code} is on development{version}, but not usable yet: its own checks fail there.", { code, version: asVersion(cr.version) }), "plain", {
              action: { kind: "open", href, label: t("team.analyst.seeWhatFails", "See what does not work") },
            });
            break;
          }
          say("released", lastBuild?.finishedAt ?? null, t("team.analyst.released", "{code} is on {environment}{version}.", { code, environment: releasedWord(cr.status), version: asVersion(cr.version) }), "done");
          break;
        default:
          break;
      }
    }
    groups.push(group(cr.id, changeTitle(code, cr.title), href, m));
  }
  return finish(groups, "analyst");
}

// ------------------------------------------------------------------------------------------- the tech lead

export const BUILD_JOB_KINDS = ["build.run", "change.build", "preview.deploy"] as const;
/** A release's deployment (the first release to development when the last milestone is accepted, or a promotion to
 *  stage or production) is a preview.deploy job too, but no build: the release manager's work, not the tech lead's. */
export const isReleaseDeploy = (j: Pick<EngineJob, "kind" | "inputJson">): boolean =>
  j.kind === "preview.deploy" && releaseDeployInput(j.inputJson);
const isBuildJob = (j: EngineJob): boolean => (BUILD_JOB_KINDS as readonly string[]).includes(j.kind) && !isReleaseDeploy(j);

/** A technical question and its answer: the AgentChatMessage rows of the tech lead's thread. */
export interface LeadChatRow {
  id: string;
  role: "user" | "agent";
  kind: "text" | "task-created";
  text: string;
  authorUserId: string;
  engineJobId: string;
  at: string;
  task: { target: string; code: string; title: string } | null;
}

export interface LeadRows {
  projectId: string;
  changes: readonly DeliveryChangeRequest[];
  jobs: readonly EngineJob[];
  milestones: readonly { id: string; number: number; name: string; status: string }[];
  previews: readonly { milestoneId: string; version: string; createdAt: string | null }[];
  tickets?: readonly { planRef: string; isDone: boolean }[];
  /** the build page's name of a change build (its increment), when the tickets and their moves are read */
  incrementOf?: (job: EngineJob) => { n: number; of: number } | null;
  chat?: readonly LeadChatRow[];
  meId: string | null;
  nameOf: (userId: string | null) => string;
  canRun: boolean;
  canAsk?: boolean;
}

interface Target { key: string; title: string; href: string; name: string }

/** Build updates (build.run, change.build, preview.deploy) in plain words, grouped by what they build; the approved
 *  changes ready to build; and the technical questions with their answers. */
export function leadThread(rows: LeadRows): TeamThread {
  const buildPath = `/p/${rows.projectId}/build`;
  const jobs = rows.jobs.filter(isBuildJob).sort(byCreated);
  const anyActive = jobs.some(isActive);
  const waits = teamWaits(rows);
  const crById = new Map(rows.changes.map((c) => [c.id, c]));
  const msById = new Map(rows.milestones.map((m) => [m.id, m]));
  const groups = new Map<string, { target: Target; messages: TeamMessage[] }>();
  const add = (target: Target, msg: TeamMessage) => {
    const g = groups.get(target.key) ?? { target, messages: [] };
    g.messages.push(msg);
    groups.set(target.key, g);
  };

  const targetOf = (j: EngineJob): Target => {
    if (j.kind === "change.build") {
      const id = inputText(j, "changeRequestId");
      const cr = crById.get(id);
      const code = cr ? changeCode(cr) : t("team.lead.aChange", "a change");
      const inc = rows.incrementOf?.(j) ?? null;
      return {
        key: `cr:${id}`, title: cr ? changeTitle(code, cr.title) : t("team.lead.changeBuild", "Change build"),
        href: cr ? `${buildPath}?cr=${cr.number}` : buildPath,
        name: inc && inc.of > 1 ? t("team.lead.incrementName", "build {n} of {total} of {code}", { n: inc.n, total: inc.of, code }) : code,
      };
    }
    const id = inputText(j, "milestoneId");
    const ms = msById.get(id);
    const name = ms ? t("team.lead.milestoneName", "milestone {number}", { number: ms.number }) : t("team.lead.theMilestone", "the milestone");
    return {
      key: `ms:${id}`, title: ms ? t("team.lead.milestoneTitle", "Milestone {number}: {name}", { number: ms.number, name: ms.name }) : t("team.lead.milestoneBuild", "Milestone build"),
      href: buildPath, name,
    };
  };

  const newestOf = (j: EngineJob): boolean => {
    const key = targetOf(j).key;
    const same = jobs.filter((x) => x.kind === j.kind && targetOf(x).key === key);
    return same[same.length - 1]?.id === j.id;
  };

  const newestSucceededChange = new Map<string, string>();
  for (const j of jobs) if (j.kind === "change.build" && j.status === "succeeded") newestSucceededChange.set(inputText(j, "changeRequestId"), j.id);

  for (const j of jobs) {
    const target = targetOf(j);
    const after = isAfterDeployRetry(j);
    // a fix round or a revert of a change works on the increment its base build built (incrementOf), and says so
    const fix = fixRoundOf(j);
    const back = isRevert(j);
    const name = target.name;
    const what = after ? t("team.lead.whatAfterDeploy", "the steps after the deploy of {name}", { name })
      : j.kind === "preview.deploy" ? t("team.lead.whatPreview", "the preview of {name}", { name })
      : fix ? t("team.lead.whatFix", "fix round {round} of {name}", { round: fix.round, name })
      : back ? t("team.lead.whatRevert", "putting development back without {name}", { name })
      : t("team.lead.whatBuild", "the build of {name}", { name });
    const doing = after ? t("team.lead.doingAfterDeploy", "finishing the steps after the deploy of {name}", { name })
      : j.kind === "preview.deploy" ? t("team.lead.doingPreview", "putting the preview of {name} online", { name })
      : fix ? t("team.lead.doingFix", "fixing what the checks found in {name} (round {round})", { round: fix.round, name })
      : back ? t("team.lead.doingRevert", "putting development back without {name}", { name })
      : t("team.lead.doingBuild", "building {name}", { name });
    const lead = (id: string, at: string | null, text: string, tone: TeamTone, extra: Partial<TeamMessage> = {}) =>
      add(target, { id: `${j.id}:${id}`, author: "lead", at, text, tone, ...extra });
    const mayPause = rows.canRun || (rows.meId !== null && j.createdBy === rows.meId);

    if (j.status === "queued") {
      lead("queued", j.createdAt, t("team.lead.queued", "I've queued {what}. It starts as soon as a build machine picks it up.", { what }), "working", {
        job: jobProgress(j), ...(mayPause ? { action: { kind: "pause", jobId: j.id, name: what } as TeamAction } : {}),
      });
      continue;
    }
    lead("start", j.claimedAt ?? j.createdAt, t("team.lead.started", "I started {doing}.", { doing }), "plain");
    if (j.status === "claimed" || j.status === "running") {
      lead("running", j.updatedAt ?? j.claimedAt, j.message ? t("team.lead.workingOn", "Working on it: {message}", { message: sentence(j.message) }) : t("team.lead.working", "Working on it."), "working", {
        job: jobProgress(j), ...(mayPause ? { action: { kind: "pause", jobId: j.id, name: what } as TeamAction } : {}),
      });
      continue;
    }
    const endAt = j.finishedAt ?? j.updatedAt;
    if (j.status === "succeeded") {
      let text: string;
      if (after) text = t("team.lead.afterDeployDone", "I finished the steps after the deploy of {name}.", { name });
      else if (back) text = t("team.lead.revertDone", "Development was put back without {name}.", { name });
      else if (j.kind === "preview.deploy") {
        const v = inputText(j, "version");
        text = t("team.lead.previewDone", "The preview of {name} is online{version}.", { name, version: asVersion(v) });
      } else if (j.kind === "change.build") {
        const id = inputText(j, "changeRequestId");
        const v = newestSucceededChange.get(id) === j.id ? crById.get(id)?.version ?? null : null;
        text = t("team.lead.changeDone", "{name} is on development{version}.", { name: cap(name), version: asVersion(v) });
      } else {
        const ms0 = ms(j.createdAt) ?? -Infinity;
        const preview = rows.previews.filter((p) => p.milestoneId === inputText(j, "milestoneId") && (ms(p.createdAt) ?? -Infinity) >= ms0)
          .sort((a, b) => (ms(b.createdAt) ?? 0) - (ms(a.createdAt) ?? 0))[0];
        text = t("team.lead.milestoneDone", "{name} is built and on development{version}.", { name: cap(name), version: asVersion(preview?.version) });
      }
      lead("done", endAt, text, "done");
      continue;
    }
    // failed or cancelled: the newest one of its target can be started again while nothing else builds
    let resume: TeamAction | undefined;
    if (!after && !anyActive && rows.canRun && newestOf(j)) {
      if (j.kind === "change.build") {
        const id = inputText(j, "changeRequestId");
        const cr = crById.get(id);
        // the change request page offers "Start the build again" in the same stage (cr.startBuild takes it as a retry)
        // (the shared rule: the change's newest build stopped and nothing else builds)
        if (cr && waitOf(waits, id, "buildAgain")?.jobId === j.id) resume = { kind: "resume", how: "change", jobId: j.id, targetId: id, name: what };
      } else if (j.status === "failed" && j.attempts < MAX_JOB_ATTEMPTS) {
        resume = { kind: "resume", how: "retry", jobId: j.id, targetId: inputText(j, "milestoneId"), name: what };
      } else {
        const m = msById.get(inputText(j, "milestoneId"));
        if (m && m.status !== "done" && m.status !== "preview-ready") resume = { kind: "resume", how: "milestone", jobId: j.id, targetId: m.id, name: what };
      }
    }
    const extra = resume ? { action: resume, needsYou: true } : {};
    if (j.status === "failed") {
      const stopped = j.message
        ? t("team.lead.stoppedBecause", "{what} stopped: {message}", { what: cap(what), message: sentence(j.message) })
        : t("team.lead.stopped", "{what} stopped.", { what: cap(what) });
      lead("failed", endAt, `${stopped} ${resume ? t("team.lead.canStartAgain", "I can start it again when you say so.") : ""}`.trim(), "problem", extra);
    } else {
      lead("cancelled", endAt, resume
        ? t("team.lead.pausedResumable", "{what} is paused. Its tickets stay on the board, and I can start it again when you say so.", { what: cap(what) })
        : t("team.lead.paused", "{what} is paused. Its tickets stay on the board.", { what: cap(what) }), "plain", extra);
    }
  }

  // approved changes ready to build: the tech lead waits for the go
  for (const cr of rows.changes) {
    const analysis = analysisOf(cr);
    if (!analysis) continue;
    const builds = jobsOf(rows.jobs, "change.build", cr.id);
    const stage = changeStage(cr.status, analysis, decisionOf(cr), builds[builds.length - 1] ?? null);
    if (stage !== "approved") continue;
    const code = changeCode(cr);
    const progress = featureProgress(analysis, cr.id, rows.tickets ?? []);
    const n = progress?.increments.length ?? 0;
    const next = progress && n > 1 && progress.next !== null ? progress.next : null;
    const lastAt = builds[builds.length - 1]?.finishedAt ?? null;
    const target: Target = { key: `cr:${cr.id}`, title: changeTitle(code, cr.title), href: `${buildPath}?cr=${cr.number}`, name: code };
    const text = next !== null && progress!.built > 0
      ? t("team.lead.nextReady", "Build {next} of {total} of {code} is ready. I'll start it when you say so.", { next, total: n, code })
      : t("team.lead.approvedReady", "{code} is approved and its tickets are on the board. I'll start the build when you say so.", { code });
    add(target, {
      id: `${cr.id}:ready`, author: "lead", at: lastAt ?? cr.decidedAt, text, tone: "attention",
      // only a role that may run builds gets the start (cr.startBuild needs build.run); anyone else opens the change
      action: anyActive || !rows.canRun
        ? { kind: "open", href: target.href, label: t("team.thread.openChange", "Open the change request") }
        : { kind: "startChange", changeRequestId: cr.id, label: next !== null ? t("team.lead.startBuildOf", "Start build {next} of {total}", { next, total: n }) : t("team.lead.startBuild", "Start the build") },
      needsYou: waitOf(waits, cr.id, "startBuild") !== null,
    });
    if (anyActive) add(target, { id: `${cr.id}:ready:wait`, author: "note", at: null, text: t("team.lead.waitForRunning", "It can start once the build that is running now has finished."), tone: "plain" });
  }

  const out: TeamGroup[] = [...groups.values()].map((g) => group(g.target.key, g.target.title, g.target.href, g.messages));

  // the technical questions: the person's messages and the answers (an answer names the job of its question)
  if (rows.chat?.length) {
    const answered = new Set(rows.chat.filter((c) => c.role === "agent" && c.engineJobId).map((c) => c.engineJobId));
    const msgs: TeamMessage[] = rows.chat.map((c) => {
      if (c.kind === "task-created" && c.task) {
        const isCr = c.task.target === "change-request";
        return {
          id: c.id, author: "lead", at: c.at, tone: "plain",
          // a confirmation of a taken offer (it names the answer's job) says itself what happened, e.g. sent for analysis
          text: c.engineJobId && c.text ? c.text
            : isCr ? t("team.lead.savedAsChange", "That's a change to the product, so I saved it as {code} (a draft) for your business analyst: {title}", { code: c.task.code || t("team.lead.aChangeRequest", "a change request"), title: c.task.title })
            : t("team.lead.passedOn", "I passed it on to the team: {title}", { title: c.task.title }),
          ...(isCr && c.task.code ? { action: { kind: "open", href: `${buildPath}?cr=${Number(c.task.code.replace(/\D/g, ""))}`, label: t("team.thread.openChange", "Open the change request") } as TeamAction } : {}),
        } satisfies TeamMessage;
      }
      if (c.role === "user") {
        return {
          id: c.id, author: "person", name: c.authorUserId === rows.meId ? t("team.thread.you", "You") : rows.nameOf(c.authorUserId) || t("team.thread.someone", "Someone on the team"),
          ...(c.authorUserId === rows.meId ? { mine: true } : {}), at: c.at, text: c.text, tone: "plain",
          ...(c.engineJobId && !answered.has(c.engineJobId) ? { waitingJobId: c.engineJobId } : {}),
        } satisfies TeamMessage;
      }
      return { id: c.id, author: "lead", at: c.at, text: c.text, tone: "plain" } satisfies TeamMessage;
    });
    out.push(group("questions", t("team.lead.technicalQuestions", "Technical questions"), null, msgs));
  }
  return finish(out, "lead");
}

// ------------------------------------------------------------------------------------------- unread

/** The dot: something the team member wrote since the thread was last opened; before the first opening, only what
 *  waits for the person. */
export function isUnread(thread: Pick<TeamThread, "latestFromContact" | "needsYou">, seenAt: number | null): boolean {
  if (seenAt === null) return thread.needsYou > 0;
  return thread.latestFromContact > seenAt;
}

/** The contact the panel opens on: the one with something new, the analyst otherwise. */
export function firstContact(unread: Readonly<Record<TeamContactId, boolean>>, needsYou: Readonly<Record<TeamContactId, number>>): TeamContactId {
  if (unread.analyst) return "analyst";
  if (unread.lead) return "lead";
  if (needsYou.analyst) return "analyst";
  if (needsYou.lead) return "lead";
  return "analyst";
}
