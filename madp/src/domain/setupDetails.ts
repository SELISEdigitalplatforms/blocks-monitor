/** The project's setup details beyond the guided start: what it must do (must-haves with a priority), key workflows,
 *  what to leave out, what to respect (constraints), what should change (existing products) and who approves the
 *  result. Pure: the "What must it do?" and "Who approves the result?" windows, the project.setup.save op and the
 *  "Project brief" note all use these rules, so the stored fields and every reader stay the same.
 *
 *  Stored on Project (S1 String fields; lists as compact JSON):
 *   SetupMustHaves      [{"text","priority":"must"|"should"|"could"}]
 *   SetupWorkflows      ["who does what", …]
 *   SetupExclusions     ["…", …]
 *   SetupConstraints    [{"kind":"deadline"|"budget"|"compliance"|"languages"|"integrations"|"other","text"}]
 *   IntendedChanges     plain text (existing products)
 *   IntendedChangeTags  ["Add new features", …] (existing products)
 *   ApprovalOwnerUserId a workspace member's user id */
import type { Check } from "./projects";

export const PRIORITIES = ["must", "should", "could"] as const;
export type Priority = (typeof PRIORITIES)[number];
export const PRIORITY_LABEL: Readonly<Record<Priority, string>> = { must: "Must", should: "Should", could: "Could" };
export const PRIORITY_HINT: Readonly<Record<Priority, string>> = {
  must: "We can't go live without it",
  should: "Important, but it could follow soon after",
  could: "Nice to have, if there is time",
};

export const CONSTRAINT_KINDS = ["deadline", "budget", "compliance", "languages", "integrations", "other"] as const;
export type ConstraintKind = (typeof CONSTRAINT_KINDS)[number];
export const CONSTRAINT_LABEL: Readonly<Record<ConstraintKind, string>> = {
  deadline: "Deadline", budget: "Budget", compliance: "Compliance", languages: "Languages", integrations: "Integrations", other: "Something else",
};
export const CONSTRAINT_PLACEHOLDER: Readonly<Record<ConstraintKind, string>> = {
  deadline: "For example: live before the spring season starts on 1 March",
  budget: "For example: about CHF 80 000 for the first version",
  compliance: "For example: Swiss data protection (revDSG), data stays in Switzerland",
  languages: "For example: German and French, English later",
  integrations: "For example: our ERP (orders and stock) and Microsoft 365 sign-in",
  other: "Anything else we must keep in mind",
};

/** Quick picks for "What would you like to change?" (existing products). */
export const CHANGE_CHIPS = [
  "Add new features", "Make it easier to use", "Make it faster", "Fix what doesn't work", "A fresh look", "Connect other systems", "Use it on the phone",
] as const;

export const SETUP_LIMITS = {
  itemText: 300, mustHaves: 40,
  workflowText: 400, workflows: 20,
  exclusionText: 300, exclusions: 20,
  constraintText: 400, constraints: 12,
  intendedChanges: 4000, changeTags: 12, changeTag: 60,
} as const;

export interface MustHave { text: string; priority: Priority }
export interface ConstraintItem { kind: ConstraintKind; text: string }

export interface SetupDetails {
  mustHaves: MustHave[];
  workflows: string[];
  exclusions: string[];
  constraints: ConstraintItem[];
  intendedChanges: string;
  changeTags: string[];
}

export const EMPTY_DETAILS: SetupDetails = { mustHaves: [], workflows: [], exclusions: [], constraints: [], intendedChanges: "", changeTags: [] };

/** The S1 field of each detail. */
export const SETUP_FIELD = {
  mustHaves: "SetupMustHaves",
  workflows: "SetupWorkflows",
  exclusions: "SetupExclusions",
  constraints: "SetupConstraints",
  intendedChanges: "IntendedChanges",
  changeTags: "IntendedChangeTags",
  approvalOwnerUserId: "ApprovalOwnerUserId",
} as const;
export const SETUP_FIELDS = Object.values(SETUP_FIELD);

export const isPriority = (v: unknown): v is Priority => (PRIORITIES as readonly unknown[]).includes(v);
export const isConstraintKind = (v: unknown): v is ConstraintKind => (CONSTRAINT_KINDS as readonly unknown[]).includes(v);

/** One line of text: inner whitespace (new lines too) folded to single spaces, trimmed. */
export const oneLine = (s: string): string => s.replace(/\s+/g, " ").trim();
const fold = (s: string): string => oneLine(s).toLowerCase();

/** A list of lines without empty ones and without repeats (case ignored); the first spelling stays. */
export function cleanLines(lines: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const l of lines) {
    const t = oneLine(l);
    if (!t || seen.has(t.toLowerCase())) continue;
    seen.add(t.toLowerCase());
    out.push(t);
  }
  return out;
}

/** Must-haves without empty or repeated ones (the first one's priority stays). */
export function cleanMustHaves(items: readonly MustHave[]): MustHave[] {
  const seen = new Set<string>();
  const out: MustHave[] = [];
  for (const i of items) {
    const t = oneLine(i.text);
    if (!t || seen.has(t.toLowerCase())) continue;
    seen.add(t.toLowerCase());
    out.push({ text: t, priority: isPriority(i.priority) ? i.priority : "must" });
  }
  return out;
}

/** Constraints: one per kind ("other" may repeat), a kind without words is kept (it was picked). */
export function cleanConstraints(items: readonly ConstraintItem[]): ConstraintItem[] {
  const out: ConstraintItem[] = [];
  const kinds = new Set<string>();
  for (const c of items) {
    if (!isConstraintKind(c.kind)) continue;
    const text = oneLine(c.text);
    if (c.kind === "other" && !text) continue;
    if (c.kind !== "other") { if (kinds.has(c.kind)) continue; kinds.add(c.kind); }
    else if (out.some((o) => o.kind === "other" && fold(o.text) === text.toLowerCase())) continue;
    out.push({ kind: c.kind, text });
  }
  return out;
}

/** True when the list adds an item already there (case and spaces ignored). */
export const hasLine = (lines: readonly string[], text: string): boolean => lines.some((l) => fold(l) === fold(text));

// ---------------------------------------------------------------- validation (op input)

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const bad = (key: string): Check<never> => ({ ok: false, messageKey: "input.wrongType", params: { key } });
const tooLong = (key: string, max: number): Check<never> => ({ ok: false, messageKey: "input.tooLong", params: { key, max } });
const tooMany = (key: string, max: number): Check<never> => ({ ok: false, messageKey: "input.tooMany", params: { key, max } });

function checkLines(raw: unknown, key: string, maxItems: number, maxText: number): Check<string[]> {
  if (!Array.isArray(raw) || raw.some((x) => typeof x !== "string")) return bad(key);
  const lines = cleanLines(raw as string[]);
  if (lines.length > maxItems) return tooMany(key, maxItems);
  if (lines.some((l) => l.length > maxText)) return tooLong(key, maxText);
  return { ok: true, value: lines };
}

/** The details a save sends (each key optional; a sent key replaces that detail). */
export function checkSetupDetails(raw: Record<string, unknown>): Check<Partial<SetupDetails>> {
  const out: Partial<SetupDetails> = {};
  if (raw.mustHaves !== undefined) {
    const v = raw.mustHaves;
    if (!Array.isArray(v) || v.some((i) => !isObj(i) || typeof i.text !== "string" || !isPriority(i.priority) || Object.keys(i).some((k) => k !== "text" && k !== "priority"))) return bad("mustHaves");
    const items = cleanMustHaves(v as MustHave[]);
    if (items.length > SETUP_LIMITS.mustHaves) return tooMany("mustHaves", SETUP_LIMITS.mustHaves);
    if (items.some((i) => i.text.length > SETUP_LIMITS.itemText)) return tooLong("mustHaves", SETUP_LIMITS.itemText);
    out.mustHaves = items;
  }
  if (raw.workflows !== undefined) {
    const c = checkLines(raw.workflows, "workflows", SETUP_LIMITS.workflows, SETUP_LIMITS.workflowText);
    if (!c.ok) return c;
    out.workflows = c.value;
  }
  if (raw.exclusions !== undefined) {
    const c = checkLines(raw.exclusions, "exclusions", SETUP_LIMITS.exclusions, SETUP_LIMITS.exclusionText);
    if (!c.ok) return c;
    out.exclusions = c.value;
  }
  if (raw.constraints !== undefined) {
    const v = raw.constraints;
    if (!Array.isArray(v) || v.some((i) => !isObj(i) || typeof i.text !== "string" || !isConstraintKind(i.kind) || Object.keys(i).some((k) => k !== "text" && k !== "kind"))) return bad("constraints");
    const items = cleanConstraints(v as ConstraintItem[]);
    if (items.length > SETUP_LIMITS.constraints) return tooMany("constraints", SETUP_LIMITS.constraints);
    if (items.some((i) => i.text.length > SETUP_LIMITS.constraintText)) return tooLong("constraints", SETUP_LIMITS.constraintText);
    out.constraints = items;
  }
  if (raw.intendedChanges !== undefined) {
    if (typeof raw.intendedChanges !== "string") return bad("intendedChanges");
    const t = raw.intendedChanges.trim();
    if (t.length > SETUP_LIMITS.intendedChanges) return tooLong("intendedChanges", SETUP_LIMITS.intendedChanges);
    out.intendedChanges = t;
  }
  if (raw.changeTags !== undefined) {
    const c = checkLines(raw.changeTags, "changeTags", SETUP_LIMITS.changeTags, SETUP_LIMITS.changeTag);
    if (!c.ok) return c;
    out.changeTags = c.value;
  }
  return { ok: true, value: out };
}

/** The Project patch of a save (only the sent details). */
export function detailsToFields(d: Partial<SetupDetails>): Record<string, string> {
  const f: Record<string, string> = {};
  if (d.mustHaves) f[SETUP_FIELD.mustHaves] = JSON.stringify(d.mustHaves);
  if (d.workflows) f[SETUP_FIELD.workflows] = JSON.stringify(d.workflows);
  if (d.exclusions) f[SETUP_FIELD.exclusions] = JSON.stringify(d.exclusions);
  if (d.constraints) f[SETUP_FIELD.constraints] = JSON.stringify(d.constraints);
  if (d.intendedChanges !== undefined) f[SETUP_FIELD.intendedChanges] = d.intendedChanges;
  if (d.changeTags) f[SETUP_FIELD.changeTags] = JSON.stringify(d.changeTags);
  return f;
}

// ---------------------------------------------------------------- reading (any row: browser reads, op rows, seed)

function jsonArray(v: unknown): unknown[] {
  if (Array.isArray(v)) return v;
  if (typeof v !== "string" || !v.trim()) return [];
  try {
    const p = JSON.parse(v);
    return Array.isArray(p) ? p : [];
  } catch {
    return [];
  }
}

/** The details stored on a Project row (missing or broken fields read as empty). */
export function detailsFromRow(r: Record<string, unknown>): SetupDetails {
  const strings = (v: unknown) => cleanLines(jsonArray(v).filter((x): x is string => typeof x === "string"));
  return {
    mustHaves: cleanMustHaves(jsonArray(r[SETUP_FIELD.mustHaves]).filter((x): x is MustHave => isObj(x) && typeof x.text === "string")),
    workflows: strings(r[SETUP_FIELD.workflows]),
    exclusions: strings(r[SETUP_FIELD.exclusions]),
    constraints: cleanConstraints(jsonArray(r[SETUP_FIELD.constraints]).filter((x): x is ConstraintItem => isObj(x) && typeof x.text === "string")),
    intendedChanges: typeof r[SETUP_FIELD.intendedChanges] === "string" ? (r[SETUP_FIELD.intendedChanges] as string) : "",
    changeTags: strings(r[SETUP_FIELD.changeTags]),
  };
}

export const approvalOwnerFromRow = (r: Record<string, unknown>): string =>
  typeof r[SETUP_FIELD.approvalOwnerUserId] === "string" ? (r[SETUP_FIELD.approvalOwnerUserId] as string) : "";

// ---------------------------------------------------------------- the "Project brief" note

/** The note the guided start creates; these details keep their sections in it up to date. */
export const BRIEF_NOTE_TITLE = "Project brief";

export type BriefSectionKey = "changes" | "mustHaves" | "workflows" | "exclusions" | "constraints" | "approval";

/** Each section's heading (and the headings the same content may already carry in the brief). */
export const BRIEF_SECTIONS: Readonly<Record<BriefSectionKey, { heading: string; aliases: readonly string[] }>> = {
  changes: { heading: "What should change", aliases: ["intended changes", "what would you like to change", "what should change"] },
  mustHaves: { heading: "What it must do", aliases: ["must-haves", "must haves", "key features", "what it must do", "requirements"] },
  workflows: { heading: "Key workflows", aliases: ["workflows", "key workflows", "who does what"] },
  exclusions: { heading: "Not included", aliases: ["exclusions", "not included", "what we leave out", "out of scope"] },
  constraints: { heading: "Constraints", aliases: ["constraints", "what we must respect", "anything we must respect"] },
  approval: { heading: "Approval", aliases: ["approval", "approval owner", "who approves the result"] },
};

/** The Markdown body of each section that has something to say (an empty detail gives "" and the section is removed). */
export function briefSectionBodies(d: Partial<SetupDetails>, approval?: { name: string } | null): Partial<Record<BriefSectionKey, string>> {
  const out: Partial<Record<BriefSectionKey, string>> = {};
  if (d.intendedChanges !== undefined || d.changeTags !== undefined) {
    const tags = d.changeTags ?? [];
    const text = (d.intendedChanges ?? "").trim();
    out.changes = [tags.length ? tags.map((t) => `- ${t}`).join("\n") : "", text].filter(Boolean).join("\n\n");
  }
  if (d.mustHaves) {
    out.mustHaves = PRIORITIES.flatMap((p) => d.mustHaves!.filter((m) => m.priority === p).map((m) => `- **${PRIORITY_LABEL[p]}:** ${m.text}`)).join("\n");
  }
  if (d.workflows) out.workflows = d.workflows.map((w) => `- ${w}`).join("\n");
  if (d.exclusions) out.exclusions = d.exclusions.map((x) => `- ${x}`).join("\n");
  // a constraint of no particular kind reads as its own words: "Something else" names the picker's choice, not a category
  if (d.constraints) out.constraints = d.constraints.flatMap((c) => (c.kind === "other" ? (c.text ? [`- ${c.text}`] : []) : [`- **${CONSTRAINT_LABEL[c.kind]}**${c.text ? `: ${c.text}` : ""}`])).join("\n");
  if (approval !== undefined) out.approval = approval ? `${approval.name} approves the result.` : "";
  return out;
}

const HEADING = /^##\s+(.+?)\s*#*\s*$/;

/** The setup section a "## " heading names (its own heading or a known alias), else null. */
export function sectionKeyOf(title: string): BriefSectionKey | null {
  const t = title.toLowerCase().replace(/[?:.!]+$/, "").trim();
  for (const [k, s] of Object.entries(BRIEF_SECTIONS) as [BriefSectionKey, (typeof BRIEF_SECTIONS)[BriefSectionKey]][]) {
    if (t === s.heading.toLowerCase() || s.aliases.includes(t)) return k;
  }
  return null;
}

/** Replaces (or appends, or removes when empty) the given sections of a Markdown note; everything else stays as it is.
 *  A section runs from its "## " heading to the next "## " (or higher) heading. */
export function refreshBriefSections(body: string, bodies: Partial<Record<BriefSectionKey, string>>): string {
  const lines = body.replace(/\r\n/g, "\n").split("\n");
  type Block = { key: BriefSectionKey | null; lines: string[] };
  const blocks: Block[] = [{ key: null, lines: [] }];
  let inFence = false;
  for (const line of lines) {
    if (/^\s*```/.test(line)) inFence = !inFence;
    const m = !inFence ? HEADING.exec(line) : null;
    if (m || (!inFence && /^#\s/.test(line))) blocks.push({ key: m ? sectionKeyOf(m[1]) : null, lines: [line] });
    else blocks[blocks.length - 1].lines.push(line);
  }
  const done = new Set<BriefSectionKey>();
  const out: string[] = [];
  const section = (k: BriefSectionKey, md: string) => [`## ${BRIEF_SECTIONS[k].heading}`, "", md.trim()];
  for (const b of blocks) {
    if (b.key && Object.prototype.hasOwnProperty.call(bodies, b.key)) {
      if (done.has(b.key)) continue; // a repeated section: keep one
      done.add(b.key);
      const md = bodies[b.key] ?? "";
      if (md.trim()) out.push(...section(b.key, md), "");
      continue;
    }
    out.push(...b.lines);
  }
  // sections not in the note yet: appended in the brief's order
  const order: BriefSectionKey[] = ["changes", "mustHaves", "workflows", "exclusions", "constraints", "approval"];
  const missing = order.filter((k) => !done.has(k) && (bodies[k] ?? "").trim());
  if (missing.length) {
    while (out.length && out[out.length - 1].trim() === "") out.pop();
    for (const k of missing) out.push("", ...section(k, bodies[k]!));
  }
  while (out.length && out[out.length - 1].trim() === "") out.pop();
  return `${out.join("\n")}\n`;
}

/** The setup sections of an old brief, carried into a rewritten one (project.setup rewrites the brief from the guided
 *  start's answers; the sections these windows keep stay as they were). */
export function carrySetupSections(oldBody: string, newBody: string): string {
  const kept = extractBriefSections(oldBody);
  return Object.keys(kept).length ? refreshBriefSections(newBody, kept) : newBody;
}

/** The setup sections a brief has, by key (their Markdown bodies). */
export function extractBriefSections(body: string): Partial<Record<BriefSectionKey, string>> {
  const out: Partial<Record<BriefSectionKey, string>> = {};
  let key: BriefSectionKey | null = null;
  let buf: string[] = [];
  const flush = () => { if (key && !out[key]) { const t = buf.join("\n").trim(); if (t) out[key] = t; } };
  let inFence = false;
  for (const line of body.replace(/\r\n/g, "\n").split("\n")) {
    if (/^\s*```/.test(line)) inFence = !inFence;
    const m = !inFence ? HEADING.exec(line) : null;
    if (m || (!inFence && /^#\s/.test(line))) {
      flush();
      key = m ? sectionKeyOf(m[1]) : null;
      buf = [];
      continue;
    }
    buf.push(line);
  }
  flush();
  return out;
}
