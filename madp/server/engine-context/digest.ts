// The digest of a project's context: plain lines per block, newest first, each block within its share of a character
// budget, headed by the context version. The prompts' material (ai/material.ts) adds the blocks a job's kind needs;
// context.json keeps the whole-project digest that the project-brief MCP server's get_project_context serves, so a short
// JSON call and a Claude Code run with tools read the same text, made by this code. Pure.
import type { ContextFile } from "./store.ts";
import type { FeedbackEntry, FeedbackThreadItem, Item } from "./snapshot.ts";

export const BLOCKS = ["basics", "sources", "brief", "clarifications", "requirements", "scope", "milestones", "tickets", "builds", "previews", "releases", "decisions", "design", "feedback", "chat"] as const;
/** Shorter forms of a block that only a job's prompt asks for (never in the whole digest): "openFeedback" = the threads
 *  not resolved yet, one line each with the person's last comment. */
export const JOB_BLOCKS = ["openFeedback"] as const;
export type Block = (typeof BLOCKS)[number] | (typeof JOB_BLOCKS)[number];

/** The blocks a job's prompt gets beyond what material.ts writes itself (basics, notes, files, answers, decisions). */
export const KIND_BLOCKS: Readonly<Record<string, readonly Block[]>> = {
  "setup.assist": [],
  "file.extract": [],
  "engine.skills-sync": [],
  // the live product's documentation reads the notes and files itself (kinds/document/sources.ts)
  "product.document": [],
  "sanitization.assist": ["brief", "requirements", "feedback"],
  "requirements.draft": ["brief", "requirements", "feedback"],
  "design.generate": ["requirements", "scope", "feedback"],
  "scope.draft": ["brief", "requirements", "feedback"],
  "scope.grill": ["requirements", "scope", "milestones", "feedback"],
  "scope.success": ["requirements", "scope", "milestones", "feedback"],
  "milestones.suggest": ["requirements", "scope", "feedback"],
  "board.plan": ["scope", "milestones", "tickets", "openFeedback"],
  "build.run": ["design", "requirements", "scope", "milestones", "tickets", "builds", "openFeedback"],
  "change.build": ["design", "scope", "tickets", "builds", "releases", "openFeedback"],
  "change.analyse": ["requirements", "scope", "milestones", "tickets", "releases", "feedback"],
  "preview.deploy": ["builds", "previews", "releases"],
  "fix.analyse": ["tickets", "builds", "releases", "chat"],
  "wiki.generate": ["requirements", "scope", "milestones", "releases"],
  "docs.generate": ["requirements", "scope", "milestones", "builds", "releases"],
  "chat.reply": ["scope", "milestones", "builds", "previews", "releases", "decisions", "chat", "feedback"],
  // the comment being worked on and the items it can be about (requirements, scope features / stories / success,
  // milestones, screens); feedback last: a block after shorter ones gets what they leave
  "feedback.apply": ["requirements", "scope", "milestones", "design", "feedback"],
};

const str = (v: unknown): string => (typeof v === "string" ? v : "");
const num = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : 0);
const one = (s: string, max: number): string => {
  const t = s.replace(/\s+/g, " ").trim();
  return t.length <= max ? t : `${t.slice(0, max - 1).replace(/\s+\S*$/, "")}…`;
};
const day = (iso: string): string => (iso ? iso.slice(0, 16).replace("T", " ") : "");

// feedback threads: the item in plain words, the status, the newest entries ("Lea Meier: …", "the team (reply): …")
const ENTRY_TAG: Readonly<Record<string, string>> = { comment: "", agent: " (reply)", proposal: " (suggested change)", system: " (recorded)" };
const entryText = (e: FeedbackEntry, max: number): string =>
  `${e.who}${ENTRY_TAG[e.kind] ?? ` (${e.kind})`}: ${one(e.text, max)}${e.files.length ? ` [files: ${one(e.files.join(", "), 160)}]` : ""}`;
const itemText = (t: FeedbackThreadItem): string => `${t.label} ${t.item ? `"${one(t.item, 120)}"` : "(no longer there)"}`;
const lastPerson = (t: FeedbackThreadItem): FeedbackEntry | undefined => [...t.entries].reverse().find((e) => e.kind === "comment");
const STATUS_WORDS: readonly [string, string][] = [["open", "waiting for the team"], ["working", "the team is on it"], ["updated", "answered, waiting for the person"]];

interface Line {
  text: string;
  ref?: string;
}

/** "Project context v7 (updated 2026-10-31 10:20 UTC)". */
export function contextHeader(c: ContextFile): string {
  return `Project context v${c.version}${c.updatedAt ? ` (updated ${day(c.updatedAt)} UTC)` : ""}`;
}

function scopeShown(c: ContextFile) {
  const sc = c.sections.scope;
  const n = sc.locked ?? sc.current;
  return { n, v: sc.versions.find((x) => x.number === n), locked: sc.locked !== null && sc.locked === n };
}

function blockLines(c: ContextFile, b: Block): { title: string; lines: Line[] } {
  const s = c.sections;
  const L = (text: string, ref?: string): Line => ({ text, ref });
  switch (b) {
    case "basics": {
      const x = s.basics;
      const lines: Line[] = [];
      const add = (label: string, v: string) => { if (v.trim()) lines.push(L(`${label}: ${one(v, 400)}`)); };
      add("Product", x.name);
      add("Client", [x.client, x.industry, x.region].filter(Boolean).join(", "));
      lines.push(L(`Kind of work: ${x.existing ? `changes to an existing product${x.repoName ? ` (${x.repoName})` : ""}` : "a new product, built from scratch"}`));
      add("Description", x.description);
      add("Goal", x.goal);
      add("Who uses it", x.targetUsers);
      if (x.mustHaves.length) add("Must-haves", x.mustHaves.map((m) => `[${m.priority}] ${m.text}`).join("; "));
      if (x.workflows.length) add("Key workflows", x.workflows.join("; "));
      if (x.exclusions.length) add("Not included", x.exclusions.join("; "));
      if (x.constraints.length) add("Constraints", x.constraints.map((k) => `${k.kind}: ${k.text}`).join("; "));
      add("What should change", [x.intendedChanges, x.changeTags.join(", ")].filter(Boolean).join(" — "));
      add("Approves the result", x.approvalOwnerName);
      add("Currency", x.currency ? `${x.currency} (named in the material)` : "");
      add("Stage", x.stage);
      return { title: "Basics", lines };
    }
    case "sources": {
      const lines: Line[] = [];
      for (const n of [...s.sources.notes].reverse()) lines.push(L(`Note "${n.title || "untitled"}"${n.body ? `: ${one(n.body, 160)}` : ""}`, n.ref));
      for (const f of [...s.sources.files].reverse()) {
        const ex = f.extraction;
        lines.push(L(`File "${f.name}" (${f.status}${ex ? `; read: ${ex.status}${ex.observationCount ? `, ${ex.observationCount} findings` : ""}` : ""})${ex?.summary ? `: ${one(ex.summary, 200)}` : ""}`, f.ref));
      }
      for (const a of [...(s.sources.attachments ?? [])].reverse()) lines.push(L(`File "${a.name}" attached to ${a.owner}${a.at ? ` (${day(a.at)})` : ""}`, a.ref));
      return { title: "Shared material", lines };
    }
    case "brief": {
      const br = s.sources.brief;
      if (!br) return { title: "Project brief", lines: [] };
      const lines: Line[] = [];
      lines.push(L(`Brief v${br.version}${br.confirmedAt ? `, understanding confirmed ${day(br.confirmedAt)}` : ", not confirmed yet"}${br.requirementDecisions.confirmed || br.requirementDecisions.rejected ? ` (${br.requirementDecisions.confirmed} confirmed, ${br.requirementDecisions.rejected} set aside)` : ""}`));
      if (br.problem) lines.push(L(`Problem: ${one(br.problem, 300)}`));
      if (br.desiredOutcome) lines.push(L(`Desired outcome: ${one(br.desiredOutcome, 300)}`));
      for (const f of br.features) {
        const reqs = [...f.confirmed.map((r) => `confirmed: ${r}`), ...f.proposed.map((r) => `proposed: ${r}`)].slice(0, 4);
        lines.push(L(`Feature "${f.name}"${reqs.length ? ` — ${one(reqs.join("; "), 400)}` : ""}${f.openQuestions.length ? ` (open: ${one(f.openQuestions.join("; "), 160)})` : ""}`));
      }
      for (const k of br.conflicts) lines.push(L(`Conflict: ${one(k.description, 200)}${k.resolution ? ` → ${one(k.resolution, 160)}` : " (open)"}`));
      for (const q of br.openQuestions) lines.push(L(`Open question: ${one(q, 200)}`));
      if (br.outOfScope.length) lines.push(L(`Out of scope: ${one(br.outOfScope.join("; "), 300)}`));
      return { title: "Project brief (what was read from the material)", lines };
    }
    case "clarifications":
      return {
        title: "Questions and answers",
        lines: [...s.clarifications].reverse().map((q) => L(`Q${num(q.number)}: ${one(str(q.question), 200)} — ${str(q.answer) ? `A: ${one(str(q.answer), 300)}` : `(${str(q.status) || "open"})`}`, q.ref)),
      };
    case "requirements": {
      const lines: Line[] = [];
      const o = s.requirements.objective;
      if (o) lines.push(L(`Objective (${str(o.status) || "draft"}): ${one(str(o.statement), 400)}`, o.ref));
      for (const r of [...s.requirements.items].reverse()) {
        lines.push(L(`R${num(r.number)} [${str(r.priority)}${str(r.status) ? `, ${str(r.status)}` : ""}] ${one(str(r.title), 160)}${str(r.text) && str(r.text) !== str(r.title) ? ` — ${one(str(r.text), 160)}` : ""}`, r.ref));
      }
      return { title: "Requirements", lines };
    }
    case "scope": {
      const { n, v, locked } = scopeShown(c);
      const lines: Line[] = [];
      if (!v) return { title: "Scope", lines };
      lines.push(L(`Scope v${n} ${locked ? `locked${v.lockedAt ? ` ${day(v.lockedAt)}` : ""}` : `(${v.status || "draft"}, not locked yet)`}${v.planHours ? `, ${v.planHours} h planned` : ""}`, v.ref));
      if (v.successTargets) lines.push(L(`Success targets: ${one(v.successTargets, 300)}`));
      for (const f of [...v.features].reverse()) {
        const stories = Array.isArray(f.stories) ? (f.stories as Item[]) : [];
        lines.push(L(`Feature "${one(str(f.title), 120)}" [${str(f.priority)}${str(f.status) === "dropped" ? ", dropped" : ""}]${stories.length ? `: ${one(stories.map((x) => str(x.title)).join("; "), 220)}` : ""}`, f.ref));
      }
      for (const o of [...c.sections.scope.versions].reverse()) if (o.number !== n) lines.push(L(`Scope v${o.number}: ${o.status}${o.lockedAt ? `, locked ${day(o.lockedAt)}` : ""}`, o.ref));
      return { title: "Scope", lines };
    }
    case "milestones": {
      const { n } = scopeShown(c);
      return {
        title: `Milestones (scope v${n})`,
        lines: s.milestones.filter((m) => num(m.scopeVersion) === n).reverse().map((m) => L(`M${num(m.number)} ${one(str(m.name), 100)} (${str(m.status) || "planned"}${str(m.acceptedAt) ? `, accepted ${day(str(m.acceptedAt))}` : ""}): ${one(str(m.goal), 200)}`, m.ref)),
      };
    }
    case "tickets": {
      const counts = new Map<string, number>();
      for (const t of s.tickets) counts.set(str(t.column) || "backlog", (counts.get(str(t.column) || "backlog") ?? 0) + 1);
      const names = new Map(s.milestones.map((m) => [m.ref, `M${num(m.number)}`]));
      const lines: Line[] = [];
      if (s.tickets.length) lines.push(L(`${s.tickets.length} tickets: ${[...counts].map(([k, v]) => `${v} ${k}`).join(", ")}`));
      for (const t of [...s.tickets].reverse()) lines.push(L(`#${num(t.number)} ${one(str(t.title), 140)} [${str(t.column)}${names.get(str(t.milestone)) ? `, ${names.get(str(t.milestone))}` : ""}${str(t.role) ? `, ${str(t.role)}` : ""}]`, t.ref));
      return { title: "Board", lines };
    }
    case "builds": {
      const b = s.builds;
      const lines: Line[] = [];
      const latest = b.latestBuild as Record<string, unknown> | null;
      if (latest) lines.push(L(`Latest published build ${str(latest.buildId)} v${str(latest.version)}${str(latest.url) ? ` at ${str(latest.url)}` : ""}`));
      for (const x of [...b.builds].reverse()) lines.push(L(`Build ${str(x.buildId)} v${str(x.version)} on ${str(x.branch)}${str(x.commit) ? ` commit ${str(x.commit).slice(0, 7)}` : ""} (${day(str(x.at))})`, x.ref));
      return { title: "Builds", lines };
    }
    case "previews":
      return { title: "Previews", lines: [...s.previews].reverse().map((p) => L(`${str(p.environment) || "preview"} v${str(p.version)} ${str(p.status)}${str(p.url) ? ` ${str(p.url)}` : ""}`, p.ref)) };
    case "releases":
      return { title: "Releases", lines: [...s.releases].reverse().map((r) => L(`${str(r.environment)} v${str(r.version)} ${str(r.status)}${str(r.releasedAt) ? ` ${day(str(r.releasedAt))}` : ""}${str(r.url) ? ` ${str(r.url)}` : ""}`, r.ref)) };
    case "decisions": {
      const d = s.decisions;
      const lines: Line[] = [];
      for (const x of [...d.decisions].reverse()) if (str(x.status) !== "rejected") lines.push(L(`D${num(x.number)} ${one(str(x.title), 120)}: ${one(str(x.statement), 220)} (${str(x.status)})`, x.ref));
      for (const x of [...d.tech].reverse()) lines.push(L(`Tech ${str(x.area)}: ${one(str(x.title), 100)} → ${one(str(x.choice), 160)} (${str(x.status)})`, x.ref));
      for (const x of [...d.changeRequests].reverse()) lines.push(L(`Change request #${num(x.number)} ${one(str(x.title), 120)} (${str(x.status)})`, x.ref));
      return { title: "Decisions", lines };
    }
    case "chat":
      return { title: "Recent chat", lines: [...s.decisions.chat].reverse().map((m) => L(`${str(m.thread)} ${str(m.role)}: ${one(str(m.text), 200)}`, m.ref)) };
    case "design": {
      const d = s.design;
      const lines: Line[] = [];
      if (!d) return { title: "Design", lines };
      const br = d.brief;
      if (br) lines.push(L(`Look and feel (${str(br.status) || "draft"}${str(br.confirmedAt) ? `, confirmed ${day(str(br.confirmedAt))}` : ""})${str(br.instructions) ? `: ${one(str(br.instructions), 240)}` : ""}`, br.ref));
      if (br && br.make) {
        lines.push(L(`${br.make.provider === 'figma-design' ? 'Native Figma screen design' : 'Product design'} revision ${str(br.make.revision)} (source ${str(br.make.source)}), reference ${str(br.make.projectUrl)}; ${str(br.status) === 'confirmed' && br.make.reviewComplete !== false ? 'approved; build must consume the matching .madp/design handoff' : 'not approved for development'}`, br.ref));
        for (const screen of br.make.screens ?? []) lines.push(L(`Figma frame ${screen.nodeId}: ${screen.name}; requirements ${screen.requirementKeys.join(', ')}`, br.ref));
      }
      for (const x of d.screens) lines.push(L(`Screen "${one(str(x.name), 100)}" v${num(x.version) || 1}${str(x.status) && str(x.status) !== "generated" ? ` (${str(x.status)})` : ""}`, x.ref));
      return { title: "Design", lines };
    }
    case "feedback": {
      const fb = s.feedback;
      const lines: Line[] = [];
      if (!fb || (!fb.threads.length && !fb.resolved.length)) return { title: "Comments on the work", lines };
      const counts = STATUS_WORDS.map(([k, w]) => [fb.threads.filter((t) => t.status === k).length, `${k} (${w})`] as const).filter(([n]) => n > 0).map(([n, w]) => `${n} ${w}`);
      const other = fb.threads.filter((t) => !STATUS_WORDS.some(([k]) => k === t.status)).length;
      lines.push(L(`Threads: ${[...counts, ...(other ? [`${other} other`] : []), ...(fb.resolvedTotal ? [`${fb.resolvedTotal} resolved (closed)`] : [])].join(", ")}`));
      for (const t of fb.threads) {
        const shown = t.entries.slice(-3);
        const before = t.total - shown.length;
        lines.push(L(`${itemText(t)} [${t.status}${t.proposalWaiting ? "; a suggested change waits for the person's decision" : ""}]: ${before ? `(+${before} earlier) ` : ""}${shown.map((e) => entryText(e, 200)).join(" | ")}`, t.ref));
      }
      for (const t of fb.resolved) {
        const asked = lastPerson(t);
        lines.push(L(`${itemText(t)} [resolved${t.decision ? `: ${t.decision}` : ""}]${asked ? `: ${entryText(asked, 140)}` : ""}`, t.ref));
      }
      return { title: "Comments on the work (waiting for the team first)", lines };
    }
    case "openFeedback": {
      const lines: Line[] = [];
      for (const t of s.feedback?.threads ?? []) {
        const asked = lastPerson(t);
        lines.push(L(`${itemText(t)} [${t.status}]${asked ? `: ${entryText(asked, 160)}` : ""}`, t.ref));
      }
      return { title: "Comments not resolved yet", lines };
    }
  }
}

/** The digest of the given blocks (default: all), within `budget` characters, with the refs of the records it names. */
export function contextDigest(c: ContextFile, o: { blocks?: readonly Block[]; budget?: number; withRefs?: boolean } = {}): { text: string; refs: string[] } {
  const blocks = o.blocks ?? BLOCKS;
  const budget = Math.max(400, o.budget ?? 12_000);
  const rendered = blocks.map((b) => blockLines(c, b)).filter((x) => x.lines.length > 0);
  const out: string[] = [contextHeader(c)];
  const refs: string[] = [];
  if (rendered.length === 0) return { text: out[0]!, refs };
  // every block gets an equal share; what a short block leaves is shared by the ones after it
  let left = budget - out[0]!.length;
  rendered.forEach((blk, i) => {
    const share = Math.floor(left / (rendered.length - i));
    const head = `${blk.title}:`;
    const kept: string[] = [];
    let used = head.length + 1;
    let dropped = 0;
    for (const [at, line] of blk.lines.entries()) {
      const text = `- ${line.text}${o.withRefs && line.ref ? ` {${line.ref}}` : ""}`;
      if (used + text.length + 1 > share && kept.length > 0) {
        dropped = blk.lines.length - at;
        break;
      }
      kept.push(text.length + used > share ? `${text.slice(0, Math.max(40, share - used - 1))}…` : text);
      used += Math.min(text.length, share) + 1;
      if (line.ref) refs.push(line.ref);
    }
    if (dropped) kept.push(`- … and ${dropped} older`);
    const block = `${head}\n${kept.join("\n")}`;
    out.push(block);
    left -= block.length + 2;
  });
  return { text: out.join("\n\n"), refs: [...new Set(refs)] };
}

/** The whole-project digest that context.json keeps (with the records' refs, for trace). */
export function wholeDigest(c: ContextFile): string {
  return contextDigest(c, { budget: 14_000, withRefs: true }).text;
}
