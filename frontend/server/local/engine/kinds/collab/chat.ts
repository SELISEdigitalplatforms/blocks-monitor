// Answers to open questions: the 3D-office agents (in the voice of their role, from the board, the builds and the
// scope) and the release assistant (about what runs in an environment). Pure: facts in, text out.
import type { Row } from "../../../../../functions/_lib/gateway";
import { AGENT_COLUMN, HUMAN_ROLE, MAX_TEXT, ticketCode, type ChatRole } from "../../../../../src/domain/agentChat";
import { STEP_LABEL } from "../../../../../src/domain/journey";
import { num, str } from "../../context.ts";
import { choose, clip, lower, listOf, plural, sentence, wordsOf } from "../../text.ts";
import { storyLine } from "./words.ts";
import { estimateBuild, estimateTicket, minutesInWords, type EstimateCalibration } from "../../../../../src/domain/engineEstimate";
import {
  activeMilestone,
  codeAreaOf,
  codePaths,
  compareVersions,
  currentBuild,
  latestRelease,
  matchDecision,
  matchChange,
  matchFeature,
  matchStory,
  type CollabFacts,
  type FeatureFact,
  type TicketFact,
} from "./facts.ts";

export type QuestionKind = "why" | "time" | "how" | "security" | "quality" | "opinion" | "who" | "where" | "capability" | "other";

/** What an open question asks for. */
export function questionKind(text: string): QuestionKind {
  const t = text.toLowerCase();
  if (/\bwhy\b|\breason\b|how come|what for\b/.test(t)) return "why";
  if (/what happens|what if|walk me through/.test(t)) return "how";
  if (
    /how long|^when\b|\bwhen (?:will|is|are|do|does|can|could|would|should)\b|\beta\b|by when|\bfinish(?:ed)? (?:by|on|today|tomorrow)|\bbe ready\b|\bdone by\b|\btake\b.*\b(?:long|time|hours|days)\b|deadline|how much time|how many hours/.test(
      t,
    )
  )
    return "time";
  if (/secur|privacy|gdpr|data protection|personal data|encrypt|attack|vulnerab|password|permission|pen ?test|owasp/.test(t)) return "security";
  if (/quality|coverage|edge case|regression|\bbugs?\b|\bfail|sent back|send back/.test(t)) return "quality";
  if (/should we|do you think|would you|recommend|\bbetter\b|instead|alternative|prefer|worth|\bor\b.*\?/.test(t)) return "opinion";
  if (/\bwho\b|\bwhose\b/.test(t)) return "who";
  if (/which file|\bcode\b|implemented|repository|\brepo\b|where (?:is|are)\b.*\b(?:handled|done|calculated|stored|saved|checked)/.test(t)) return "where";
  if (/\bhow (?:does|do|will|would|should|can|is|are)\b|what happens|what if|explain|walk me through|\bworks?\b|handle|handled/.test(t)) return "how";
  if (/^(?:does|do|is|are|can|could|will|would|has|have)\b|\bis there\b|\bsupport|is it possible/.test(t)) return "capability";
  return "other";
}

const COLUMN_LABEL: Record<string, string> = {
  planned: "Planned",
  dev: "development",
  review: "review",
  test: "testing",
  security: "the security checks",
  docs: "documentation",
  gate: "the release gate",
  done: "Done",
};

export interface ChatContext {
  /** The project's ticket events, oldest first. */
  events: Row[];
  /** Display names: the assignee and the lead of the project. */
  people: { assignee: string; creator: string };
  /** Stable choice key (the job id). */
  key: string;
  /** The calibration of the real build estimates (src/domain/engineEstimate.ts); without it no time is named. */
  estimates?: EstimateCalibration | null;
}

function ticketRef(f: CollabFacts, text: string): TicketFact | null {
  const m = /(?:#|\bMF-?)(\d{1,5})\b/i.exec(text);
  if (!m) return null;
  return f.tickets.find((t) => t.number === Number(m[1])) ?? null;
}

function buildLine(f: CollabFacts): string {
  const b = currentBuild(f);
  if (!b) return "";
  const s = str(b.Status);
  const p = Math.round(num(b.Progress));
  if (s === "running") return `The build is at ${p} %.`;
  if (s === "queued" || s === "claimed") return "The next build is about to start.";
  if (s === "failed") return "The last build stopped with an error, so that comes first.";
  return "";
}

function milestoneState(f: CollabFacts, estimates?: EstimateCalibration | null): { name: string; number: number; done: number; total: number; minutesLeft: number | null } | null {
  const m = activeMilestone(f);
  if (!m) return null;
  const mine = f.tickets.filter((t) => t.milestoneId === m.id);
  // the build time on MADP of its open tickets (the real estimate), never the stored person-hours
  const left = estimateBuild(estimates, mine.filter((t) => !t.isDone).map((t) => t.type));
  return {
    name: m.name,
    number: m.number,
    done: mine.filter((t) => t.isDone).length,
    total: mine.length,
    minutesLeft: left ? left.minutes.value : null,
  };
}

function myOpen(f: CollabFacts, role: ChatRole): TicketFact[] {
  const col = AGENT_COLUMN[role];
  return f.tickets.filter((t) => t.column === col && !t.isDone).sort((a, b) => a.number - b.number);
}

function stepLabel(f: CollabFacts): string {
  return (STEP_LABEL as Record<string, string | undefined>)[f.stage] ?? f.stage;
}

// Closing lines say only what the team really does (nothing is promised from the chat: work goes in as a request).
const CLOSER: Record<ChatRole, string[]> = {
  planner: ["The plan follows the order of the board.", "If the priority should change, tell me what you need and it goes in as a request."],
  dev: ["The build follows the plan and each ticket's acceptance criteria.", "If you want it done differently, a change request is the clean way."],
  reviewer: ["Every ticket is reviewed before it is tested.", "The review checks each ticket against what it needs."],
  qa: ["The tests check each ticket against its acceptance criteria.", "A ticket that fails its checks goes back to development."],
  secops: ["The security stage checks every ticket before the release gate.", "That's part of the checks before the release gate."],
  docs: ["The user guide covers what is built.", "The release notes list what each version brings."],
  shipper: ["It goes out with the next preview once it passes the gate.", "Each release carries its release notes."],
};

const closer = (role: ChatRole, key: string): string => choose(`${key}:closer`, CLOSER[role]);

function featureState(f: CollabFacts, feat: FeatureFact): string {
  const m = feat.milestone;
  if (!m) return "";
  if (f.releases.length > 0 && (m.status === "done" || f.stage === "release")) return `It was delivered with milestone ${m.number} “${m.name}” and is released.`;
  const state = m.status === "done" || m.status === "preview-ready" ? "is built" : m.status === "building" ? "is being built now" : "is planned";
  return `It ${state} in milestone ${m.number} “${m.name}”.`;
}

function storySentence(feat: FeatureFact, text: string): string {
  const s = matchStory(feat, text) ?? feat.stories[0];
  if (!s) return feat.description ? sentence(feat.description) : "";
  const criteria = s.criteria.slice(0, 3).map((c) => lower(c.replace(/[.]+$/, "")));
  const what = storyLine(s);
  return criteria.length ? `${what} Done means: ${listOf(criteria)}.` : what;
}

function techFor(f: CollabFacts, text: string): Row | null {
  const words = wordsOf(text);
  let best: Row | null = null;
  let bestScore = 0;
  for (const t of f.techDecisions) {
    const tw = wordsOf(`${str(t.Title)} ${str(t.Choice)} ${str(t.Rationale)}`);
    let score = 0;
    for (const w of words) if (tw.has(w)) score += 1;
    if (score > bestScore) {
      best = t;
      bestScore = score;
    }
  }
  return best;
}

function roleAddOn(f: CollabFacts, role: ChatRole, feat: FeatureFact, text: string, key: string): string {
  const s = matchStory(feat, text) ?? feat.stories[0];
  switch (role) {
    case "dev": {
      const t = techFor(f, `${text} ${feat.title} ${feat.description}`) ?? f.techDecisions[0];
      return t ? `Technically it builds on “${str(t.Title)}”: ${lower(str(t.Choice).replace(/[.]+$/, ""))}.` : closer(role, key);
    }
    case "qa":
      return s?.criteria[0] ? `My tests check exactly that, starting with “${s.criteria[0].replace(/[.]+$/, "")}”.` : closer(role, key);
    case "reviewer":
      return "In the review I look at the error handling and the empty states of that part in particular.";
    case "secops": {
      const sec = f.techDecisions.find((t) => ["security", "data", "hosting"].includes(str(t.Area)));
      return sec ? `On my side the rule is “${str(sec.Title)}”: ${lower(str(sec.Choice).replace(/[.]+$/, ""))}.` : "On my side I check who can see that data and that nothing leaks into logs.";
    }
    case "docs":
      return `The user guide will describe it step by step for the ${s?.actor || "people"} who use it.`;
    case "shipper":
      return feat.milestone ? `It ships with milestone ${feat.milestone.number} once it passes the release gate.` : closer(role, key);
    case "planner":
      return feat.priority === "must" ? "It's a must for this scope." : feat.priority === "nice" ? "It's a nice-to-have, so it can move if time gets short." : closer(role, key);
  }
}

/** The answer of an agent to an open question (2 to 5 sentences, at most MAX_TEXT characters). */
export function agentReply(f: CollabFacts, role: ChatRole, question: string, c: ChatContext): string {
  const kind = questionKind(question);
  const ticket = ticketRef(f, question);
  const featHit = matchFeature(f, question);
  const feat = featHit && featHit.score >= 3 ? featHit.feature : null;
  const ms = milestoneState(f, c.estimates);
  const parts: string[] = [];

  if (ticket) {
    const where = ticket.isDone ? "is done" : `is in ${COLUMN_LABEL[ticket.column] ?? ticket.column}`;
    const adds = ticket.isDone ? null : estimateTicket(c.estimates, ticket.type);
    parts.push(`${ticketCode(ticket.number)} “${ticket.title}” ${where}${adds ? `; it adds about ${minutesInWords(adds.minutes.value)} to its build's time on MADP` : ""}.`);
    const evs = c.events.filter((e) => e.TicketId === ticket.id);
    const back = [...evs].reverse().find((e) => /^Sent back:/.test(str(e.Text)));
    if (back && (kind === "why" || kind === "quality")) parts.push(`It was sent back once: ${lower(str(back.Text).replace(/^Sent back:\s*/, ""))}`);
    else if (kind === "why" || kind === "quality") parts.push(evs.some((e) => e.ToColumn === "review" || e.ToColumn === "test") ? "It was not sent back: it went through review and testing on the first pass." : "It hasn't reached review yet, so nothing was sent back.");
    const last = [...evs].reverse().find((e) => e.Kind !== "comment");
    if (last && !back && kind !== "why" && kind !== "quality") parts.push(`Last step: ${sentence(str(last.Text))}`);
    if (!ticket.isDone && kind === "time") parts.push(ms ? `It's part of milestone ${ms.number} “${ms.name}”, which has ${ms.done} of ${ms.total} tickets done.` : "");
    parts.push(closer(role, c.key));
    return finish(parts);
  }

  switch (kind) {
    case "why": {
      const d = matchDecision(f, question);
      if (d) {
        parts.push(`We decided “${d.title}”: ${lower(d.statement.replace(/[.]+$/, ""))}.`);
        if (d.rationale) parts.push(sentence(d.rationale));
      } else if (feat) {
        const req = f.requirements.find((r) => feat.requirementKeys.includes(str(r.Key)));
        parts.push(`“${feat.title}” is in the scope because ${req ? lower(str(req.Text).replace(/[.]+$/, "")) : lower((feat.description || f.brief).replace(/[.]+$/, ""))}.`);
        parts.push(featureState(f, feat));
      } else if (role === "reviewer" || role === "qa") {
        const backs = c.events.filter((e) => /^Sent back:/.test(str(e.Text)));
        const lastBack = backs[backs.length - 1];
        if (lastBack) {
          const t = f.tickets.find((x) => x.id === lastBack.TicketId);
          parts.push(`The last ticket I sent back${t ? ` was ${ticketCode(t.number)} “${t.title}”` : ""}: ${lower(str(lastBack.Text).replace(/^Sent back:\s*/, ""))}`);
          parts.push("It went back to development and came through on the second pass.");
        } else parts.push("Nothing was sent back so far, so I can't point to a reason in the records.");
      } else {
        const ds = [...f.decisions.map((d) => str(d.Title)), ...f.techDecisions.map((t) => str(t.Title))].filter(Boolean).slice(0, 3);
        parts.push("I can't find a recorded reason for that in the project.");
        if (ds.length) parts.push(`The decisions so far are ${listOf(ds.map((d) => `“${d}”`))}.`);
      }
      parts.push(closer(role, c.key));
      break;
    }
    case "time": {
      if (ms && ms.total > 0) {
        parts.push(`Milestone ${ms.number} “${ms.name}” has ${ms.done} of ${ms.total} tickets done${ms.minutesLeft !== null ? `; building the rest takes MADP about ${minutesInWords(ms.minutesLeft)}` : ""}.`);
        const b = buildLine(f);
        if (b) parts.push(b);
        const open = myOpen(f, role);
        if (role !== "planner" && open.length) parts.push(`On my side ${plural(open.length, "ticket")} ${open.length === 1 ? "is" : "are"} waiting: ${listOf(open.slice(0, 3).map((t) => ticketCode(t.number)))}.`);
        parts.push(ms.done === ms.total ? "The preview comes next." : "The preview follows as soon as the last ticket passes the release gate.");
      } else if (f.milestones.length) {
        const first = f.milestones[0]!;
        // its build time on MADP for one ticket per story (the real estimate), never the stories' person-hours
        const build = estimateBuild(c.estimates, f.features.filter((x) => first.featureRefs.includes(x.ref)).flatMap((x) => x.stories).map(() => "story"));
        parts.push(`Milestone 1 “${first.name}” is planned${build ? `; building it takes MADP about ${minutesInWords(build.minutes.value)}` : ""}.`);
        parts.push("The clock starts once the build of that milestone is started on the Build page.");
      } else {
        parts.push(`There's no plan to estimate yet: ${f.name} is at ${stepLabel(f)}.`);
        parts.push("Once the scope is locked, MADP plans the tickets and I can tell you per milestone.");
      }
      break;
    }
    case "how":
    case "capability": {
      if (feat) {
        parts.push(`In “${feat.title}”: ${storySentence(feat, question)}`);
        parts.push(roleAddOn(f, role, feat, question, c.key));
        const st = featureState(f, feat);
        if (st && role !== "shipper") parts.push(st);
      } else {
        const d = matchDecision(f, question);
        if (d) {
          parts.push(`That's covered by the decision “${d.title}”: ${lower(d.statement.replace(/[.]+$/, ""))}.`);
          parts.push(closer(role, c.key));
        } else {
          const names = f.features.slice(0, 4).map((x) => `“${x.title}”`);
          const stack = f.techDecisions.find((t) => str(t.Area) === "stack");
          parts.push(kind === "capability" ? "The scope doesn't decide that as it stands." : "The scope doesn't describe that yet.");
          if (stack) parts.push(`The stack is “${str(stack.Title)}”, so nothing in the build stands in the way of that.`);
          else if (names.length) parts.push(`What's in it: ${listOf(names)}.`);
          parts.push(role === "planner" ? "If you need it, describe what it should do and I'll record it for MADP." : "If you need it, describe it to the Planner and it goes through MADP as a change.");
        }
      }
      break;
    }
    case "security": {
      const sec = f.techDecisions.filter((t) => ["security", "data", "hosting", "nfr"].includes(str(t.Area))).slice(0, 2);
      if (sec.length) parts.push(`We have ${listOf(sec.map((t) => `“${str(t.Title)}” (${lower(str(t.Choice).replace(/[.]+$/, ""))})`))}.`);
      const checks = c.events.filter((e) => /automated checks passed|Security checks passed/.test(str(e.Text))).length;
      if (checks) parts.push(`So far ${plural(checks, "ticket")} went through the security stage with no findings.`);
      else parts.push("Every ticket goes through the security stage before the release gate: dependencies, access rules and secrets in the code.");
      if (feat) parts.push(`For “${feat.title}” I look at who can see the data and what is kept in the logs.`);
      if (role !== "secops") parts.push("The Security Engineer has the details.");
      break;
    }
    case "quality": {
      const reports = c.events.filter((e) => /^Test report:/.test(str(e.Text)));
      const passed = reports.reduce((n, e) => n + Number(/(\d+) passed/.exec(str(e.Text))?.[1] ?? 0), 0);
      const backs = c.events.filter((e) => /^Sent back:/.test(str(e.Text)));
      if (reports.length) parts.push(`${plural(reports.length, "test run")} so far, ${passed} checks passed and none failed at the end.`);
      if (backs.length) parts.push(`${plural(backs.length, "ticket was", "tickets were")} sent back on the way, ${lower(str(backs[backs.length - 1]!.Text).replace(/^Sent back:\s*/, "the last because "))}`);
      if (!reports.length && !backs.length) parts.push("Nothing has reached testing yet, so there are no results to report.");
      parts.push(feat ? `For “${feat.title}” the tests follow its acceptance criteria one by one.` : "Every acceptance criterion of a story gets at least one test.");
      if (role !== "qa") parts.push("The QA Engineer can give you the full picture.");
      break;
    }
    case "opinion": {
      const d = matchDecision(f, question);
      if (d) {
        parts.push(`I'd stay with what we decided: ${lower(d.statement.replace(/[.]+$/, ""))}.`);
        if (d.rationale) parts.push(sentence(d.rationale));
        parts.push("Changing it now would touch tickets that are already built.");
      } else if (feat) {
        const first = feat.stories[0];
        parts.push(`For “${feat.title}” I'd keep the first version small${first ? `: “${first.title}” first` : ""}, and add the rest as a change once people use it.`);
        parts.push(featureState(f, feat));
      } else {
        parts.push("Both can work; what matters is what the people using it need first.");
        parts.push(`I'd decide it against the objective: ${lower(clip(str(f.objective?.Statement) || f.brief, 160).replace(/[.]+$/, ""))}.`);
      }
      parts.push(closer(role, c.key));
      break;
    }
    case "who": {
      const owner = c.people.assignee || c.people.creator;
      parts.push(owner ? `${owner} looks after ${f.name} on the factory side.` : `The project team of ${f.name} owns it.`);
      if (f.client) parts.push(`The requirements come from ${f.client}.`);
      parts.push(`On the board, ${role === "planner" ? "I own the plan" : `I'm the ${HUMAN_ROLE[role]} and work the ${COLUMN_LABEL[AGENT_COLUMN[role]] ?? AGENT_COLUMN[role]} column`}.`);
      break;
    }
    case "where": {
      const target = featHit?.feature ?? f.features[0];
      if (target) {
        const paths = codePaths(f, target.key, codeAreaOf(question));
        parts.push(`For “${target.title}” the screen is in ${paths.web} and the server side in ${paths.api}.`);
        parts.push(`The tests are in ${paths.test}.`);
        if (f.repo.name) parts.push(`All of it lives in the ${f.repo.owner ? `${f.repo.owner}/` : ""}${f.repo.name} repository, branch ${f.repo.branch}.`);
      } else {
        parts.push("There's no code yet: the board isn't planned.");
      }
      break;
    }
    default: {
      if (feat) {
        parts.push(`About “${feat.title}”: ${storySentence(feat, question)}`);
        parts.push(roleAddOn(f, role, feat, question, c.key));
      } else {
        const open = role === "planner" ? [] : myOpen(f, role);
        const done = f.tickets.filter((t) => t.isDone).length;
        const started = f.tickets.some((t) => t.isDone || t.column !== "planned");
        if (open.length) parts.push(`Right now I have ${listOf(open.slice(0, 2).map((t) => `${ticketCode(t.number)} “${t.title}”`))} on my desk.`);
        else if (role === "planner" && f.tickets.length) parts.push(started ? `${done} of the ${plural(f.tickets.length, "ticket")} on the board are done.` : `The board has ${plural(f.tickets.length, "ticket")} planned; none has started yet.`);
        else parts.push(`${f.name} is at ${stepLabel(f)}.`);
        const b = buildLine(f);
        if (b) parts.push(b);
        const names = f.features.slice(0, 3).map((x) => `“${x.title}”`);
        parts.push(names.length ? `If it's about ${listOf(names, "or")}, ask me about that feature and I'll go into detail.` : "Ask me about a feature or a ticket and I'll go into detail.");
      }
    }
  }
  return finish(parts);
}

function finish(parts: string[]): string {
  const text = parts
    .map((p) => p.trim())
    .filter(Boolean)
    .slice(0, 5)
    .join(" ")
    .replace(/\s+/g, " ")
    .replace(/\.\./g, ".");
  return text.slice(0, MAX_TEXT);
}

// ------------------------------------------------------------------ assistant

export interface AssistantAnswer {
  text: string;
  points: string[];
  refs: { path: string; line: number | null; why: string }[];
}

const ENV_LABEL: Record<string, string> = { dev: "dev", stage: "stage", production: "production" };

/** What runs in an environment: its newest release, the features in it and the changes it carries. */
function envState(f: CollabFacts, env: string) {
  const rel = latestRelease(f, env);
  const releases = f.releases.filter((r) => r.env === env && (!rel || compareVersions(r.version, rel.version) <= 0));
  const crIds = new Set(releases.flatMap((r) => r.changeRequestIds));
  const changes = f.changes.filter((c) => crIds.has(c.id));
  return { rel, changes };
}

function guideSteps(wiki: Row[], text: string): string[] {
  const words = wordsOf(text);
  let best: Row | null = null;
  let bestScore = 0;
  for (const p of wiki.filter((x) => x.PageGroup === "guide")) {
    const pw = wordsOf(`${str(p.Title)} ${str(p.BodyMd)}`);
    let score = 0;
    for (const w of words) if (pw.has(w)) score += 1;
    if (score > bestScore) {
      best = p;
      bestScore = score;
    }
  }
  if (!best || bestScore < 2) return [];
  return str(best.BodyMd)
    .split(/\r?\n/)
    .map((l) => /^\s*(?:\d+[.)]|[-*])\s+(.*)$/.exec(l)?.[1]?.trim() ?? "")
    .filter((l) => l && !/^\[[ xX]\]/.test(l))
    .map((l) => l.replace(/\*\*/g, ""))
    .slice(0, 8);
}

/** The assistant's answer to an open question about the product in one environment. */
export function assistantReply(f: CollabFacts, env: string, question: string, wiki: Row[], key: string): AssistantAnswer {
  const kind = questionKind(question);
  const { rel, changes } = envState(f, env);
  const hit = matchFeature(f, question);
  const feat = hit && hit.score >= 3 ? hit.feature : null;
  const where = rel ? `v${rel.version} on ${ENV_LABEL[env] ?? env}` : ENV_LABEL[env] ?? env;
  const points: string[] = [];
  const refs: AssistantAnswer["refs"] = [];
  let text: string;

  if (!rel) {
    const ms = activeMilestone(f);
    text = `Nothing of ${f.name} is released to ${ENV_LABEL[env] ?? env} yet.${ms ? ` The build is on milestone ${ms.number} “${ms.name}”.` : ""}`;
    if (feat) text += ` “${feat.title}” is ${feat.milestone ? `planned in milestone ${feat.milestone.number}` : "in the scope"}.`;
    return { text, points, refs };
  }

  const changeFor = (fe: FeatureFact | null) => (fe ? changes.filter((c) => c.featureRef === fe.ref) : []);
  const cr = matchChange(f, question);
  if (cr && (kind === "how" || kind === "capability" || kind === "other" || kind === "time")) {
    const inEnv = changes.some((c) => c.id === cr.id);
    if (inEnv) text = `${kind === "capability" ? "Yes, since" : "That came with"} ${cr.code} ${cr.title}${cr.version ? ` (v${cr.version})` : ""}, which runs in ${where}.${cr.description ? ` ${sentence(clip(cr.description, 300))}` : ""}`;
    else if (cr.status === "building") text = `Not yet in ${where}. ${cr.code} ${cr.title} is building now; it reaches dev as v${cr.version} and then goes through the approvals for stage and production.`;
    else if (cr.status === "draft") text = `Not in ${where}. ${cr.code} ${cr.title} is saved as a draft change request; it is built once someone starts it on the Release page.`;
    else text = `${cr.code} ${cr.title} is ${cr.status.replace("released-", "released to ").replace("promoted-", "on ")}${cr.version ? ` as v${cr.version}` : ""}; it is not in ${where} yet.`;
    const steps = guideSteps(wiki, question);
    if (inEnv && steps.length) points.push(...steps);
    return { text: text.slice(0, 10000), points: points.slice(0, 8).map((p) => clip(p, 300)), refs };
  }

  switch (kind) {
    case "how":
    case "capability":
    case "other": {
      if (feat) {
        const story = matchStory(feat, question) ?? feat.stories[0];
        const steps = guideSteps(wiki, question);
        if (kind === "capability") {
          text = `In ${where}, “${feat.title}” works like this:${story ? ` ${storyLine(story)}` : ` ${sentence(feat.description || feat.title)}`}`;
        } else {
          text = `Here's how it works in ${where}.${story ? ` ${storyLine(story)}` : ""}`;
        }
        if (steps.length) points.push(...steps);
        else if (story) points.push(...story.criteria.slice(0, 5).map((x) => x.replace(/[.]+$/, "")));
        const cs = changeFor(feat);
        if (cs.length) text += ` Changed since go-live by ${listOf(cs.map((c) => `${c.code} ${c.title}`))}.`;
      } else {
        const d = matchDecision(f, question);
        if (d) {
          text = `In ${where}: ${sentence(d.statement)}${d.rationale ? ` ${sentence(d.rationale)}` : ""}`;
        } else {
          text =
            kind === "capability"
              ? `Not in ${where}. None of the released features covers that; it can be asked for as a change request on the Release page.`
              : `${f.name} ${where} has ${plural(f.features.length, "feature")}. I couldn't match your question to one of them; these are the ones in the release.`;
          points.push(...f.features.slice(0, 8).map((x) => x.title));
        }
      }
      break;
    }
    case "why": {
      const d = matchDecision(f, question);
      if (d) text = `That was decided as “${d.title}”: ${lower(d.statement.replace(/[.]+$/, ""))}.${d.rationale ? ` ${sentence(d.rationale)}` : ""}`;
      else if (feat) text = `“${feat.title}” works that way because of its acceptance criteria in the locked scope.${feat.stories[0] ? ` ${sentence(feat.stories[0].text || feat.stories[0].title)}` : ""}`;
      else text = "I can't find a decision about that in the project's records. The decision log in the wiki lists everything that was decided.";
      if (feat) points.push(...(matchStory(feat, question) ?? feat.stories[0])?.criteria.slice(0, 4) ?? []);
      break;
    }
    case "time": {
      const open = f.changes.filter((c) => c.status === "building" || c.status === "draft");
      const building = open.find((c) => c.status === "building");
      text = building ? `${building.code} ${building.title} is building now; it reaches dev as v${building.version} and then goes through the approvals for stage and production.` : `Nothing is building for ${f.name} right now; ${where} is the current state.`;
      points.push(...open.map((c) => `${c.code} ${c.title} · ${c.status}`));
      break;
    }
    case "where": {
      const target = hit?.feature ?? f.features[0]!;
      const paths = codePaths(f, target.key, codeAreaOf(question));
      text = `“${target.title}” is implemented in the ${f.repo.name || "project"} repository: the screen in ${paths.web}, the server side in ${paths.api}.`;
      refs.push({ path: paths.web, line: 12 + (wordsOf(question).size * 7) % 80, why: `Screen of ${lower(target.title)}` });
      refs.push({ path: paths.api, line: 20 + (target.key.length * 11) % 140, why: `Rules of ${lower(target.title)}` });
      break;
    }
    case "security": {
      const sec = f.techDecisions.filter((t) => ["security", "data", "hosting"].includes(str(t.Area)));
      text = sec.length ? `In ${where}: ${sec.map((t) => sentence(`${str(t.Title)}: ${lower(str(t.Choice))}`)).join(" ")}` : `In ${where} every release passed the security stage of the release gate with no open findings.`;
      break;
    }
    case "quality": {
      const fixes = f.changes.filter((c) => c.lane === "fix");
      text = fixes.length ? `${plural(fixes.length, "fix", "fixes")} went through MADP since go-live.` : `No fixes were needed since go-live of ${where}.`;
      points.push(...fixes.map((c) => `${c.code} ${c.title} · ${c.status}`));
      break;
    }
    default: {
      text = `${f.name} ${where}.`;
    }
  }
  if (feat && refs.length === 0 && /\b(code|file|implemented)\b/i.test(question)) {
    const paths = codePaths(f, feat.key, codeAreaOf(question));
    refs.push({ path: paths.web, line: null, why: `Screen of ${lower(feat.title)}` });
  }
  void key;
  return { text: text.slice(0, 10000), points: points.slice(0, 8).map((p) => clip(p, 300)), refs };
}
