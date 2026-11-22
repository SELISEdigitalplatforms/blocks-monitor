/**
 * The "Project brief" (pure; shared by the web app and the functions): the guided start's answers written as a
 * readable note in the project's material, so people and the business analyst's analysis read them like any note.
 * The note is rewritten from the answers whenever they change while the project is still being set up.
 * Also the Project setup page's "What to do now" checklist.
 */

export const BRIEF_TITLE = "Project brief";

export interface TestEnvInfo { available: "yes" | "no" | "unsure"; url?: string; accessHow?: string }

export interface BriefInput {
  name: string;
  existing: boolean;
  description: string;
  goal: string;
  targetUsers: string;
  appUrl?: string;
  testEnv?: TestEnvInfo | null;
  runInstructions?: string;
  blocksProjectRef?: string;
}

const sentence = (s: string) => {
  const t = s.trim();
  return !t ? t : /[.!?…]$/.test(t) ? t : `${t}.`;
};

/** testEnv as stored on the project (JSON); null when absent or unreadable. */
export function parseTestEnv(raw: string | null | undefined): TestEnvInfo | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as Partial<TestEnvInfo>;
    if (v && (v.available === "yes" || v.available === "no" || v.available === "unsure")) {
      return { available: v.available, ...(typeof v.url === "string" && v.url ? { url: v.url } : {}), ...(typeof v.accessHow === "string" && v.accessHow ? { accessHow: v.accessHow } : {}) };
    }
  } catch {
    // not JSON: no test version known
  }
  return null;
}

/** The test version in plain words ("Yes: https://test… Access: Anna from IT."). */
export function testEnvText(t: TestEnvInfo | null | undefined): string {
  if (!t) return "";
  if (t.available === "no") return "There is no safe test version yet.";
  if (t.available === "unsure") return "Not sure yet whether there is a safe test version.";
  return [`Yes, there is a safe test version${t.url ? ` at ${t.url}` : ""}.`, t.accessHow ? `Access: ${sentence(t.accessHow)}` : ""].filter(Boolean).join(" ");
}

/** The brief as Markdown: about, goal, users and, for an existing product, where it runs, its test version and how it is started. */
export function briefMarkdown(b: BriefInput): string {
  const parts: string[] = [];
  const section = (heading: string, body: string) => { if (body.trim()) parts.push(`## ${heading}\n\n${body.trim()}`); };
  section(b.existing ? "About the product" : "About the project", [b.name.trim() ? `**${b.name.trim()}**` : "", sentence(b.description)].filter(Boolean).join("\n\n"));
  section("Goal", sentence(b.goal));
  section("Who will use it", sentence(b.targetUsers));
  if (b.existing) {
    section("Where it runs today", b.appUrl?.trim() ? `The product runs at ${b.appUrl.trim()}.` : "");
    section("Safe test version", testEnvText(b.testEnv));
    section("How it is started", sentence(b.runInstructions ?? ""));
  } else {
    section("SELISE Blocks project", b.blocksProjectRef?.trim() ? `There is already a SELISE Blocks project: ${b.blocksProjectRef.trim()}.` : "");
  }
  return parts.join("\n\n");
}

/* ── the "What to do now" checklist ───────────────────────────────────────── */

export type ChecklistId = "about" | "goal" | "where" | "share";

export interface ChecklistItem { id: ChecklistId; label: string; done: boolean; detail: string }

export interface ChecklistInput {
  existing: boolean;
  name: string;
  description: string;
  goal: string;
  targetUsers: string;
  /** The repository is saved (owner, name and branch). */
  repoSaved: boolean;
  repoText: string;
  /** New product: "Create a new repository for me" was chosen (GitHub can be connected later). */
  repoWillBeCreated: boolean;
  /** New product: MADP Factory keeps the code (no GitHub repository; GitHub can be connected later). */
  keptInFactory?: boolean;
  /** Notes with text (besides the Project brief) and ready files. */
  sharedCount: number;
}

const short = (s: string, n = 90) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);

export function setupChecklist(i: ChecklistInput): ChecklistItem[] {
  const inFactory = !i.repoSaved && !i.existing && i.keptInFactory === true;
  const whereDone = i.repoSaved || inFactory || (!i.existing && i.repoWillBeCreated);
  return [
    { id: "about", label: "About your project", done: Boolean(i.name.trim() && i.description.trim()), detail: short(i.description.trim()) || "A name and a sentence or two about it" },
    { id: "goal", label: "Goal & users", done: Boolean(i.goal.trim() && i.targetUsers.trim()), detail: i.goal.trim() ? short(i.goal.trim()) : "What it should achieve and who will use it" },
    {
      id: "where", label: "Where the code lives", done: whereDone,
      detail: i.repoSaved ? i.repoText
        : inFactory ? "Kept safe in MADP Factory. Connecting GitHub is optional"
        : !i.existing && i.repoWillBeCreated ? "A new repository, created for you once GitHub is connected"
        : i.existing ? "The product's repository on GitHub (optional)" : "A new repository, or one you already have",
    },
    { id: "share", label: "Share what you already have", done: i.sharedCount > 0, detail: i.sharedCount > 0 ? `${i.sharedCount} item${i.sharedCount === 1 ? "" : "s"} shared` : i.existing ? "Existing documentation, notes, screenshots" : "Briefs, notes, sketches, spreadsheets" },
  ];
}

/** The description in a "Project brief" note: the text of its "About the project/product" section without the name line. */
export function briefAbout(body: string): string {
  const lines = body.replace(/\r\n/g, "\n").split("\n");
  let inAbout = false;
  const out: string[] = [];
  for (const line of lines) {
    const h = /^##\s+(.+?)\s*#*\s*$/.exec(line);
    if (h) {
      if (inAbout) break;
      inAbout = /^about the (project|product)$/i.test(h[1]!.trim());
      continue;
    }
    if (inAbout) out.push(line);
  }
  return out
    .map((l) => l.trim())
    .filter((l) => l && !/^\*\*[^*]+\*\*$/.test(l))
    .join(" ")
    .trim();
}

/* ── the objective and the end users the business analyst works from ─────────── */

/** An answer is too thin to work from when it is only a word or two. */
export function isThin(text: string | null | undefined): boolean {
  const t = (text ?? "").trim();
  if (!t) return true;
  return t.length < 12 || t.split(/\s+/).filter(Boolean).length < 3;
}

/** The two questions the business analyst asks when the objective or the end users are missing. Their exact words are
 *  also how an answer recorded with the questions is found again. */
export function briefQuestions(name: string): { goal: string; users: string } {
  const n = name.trim() || "this project";
  return { goal: `What is the main objective of ${n}?`, users: "Who will use it day to day?" };
}

export interface AskedRow { Question: string; Answer?: string | null; Status: string }

/** The objective and the end users the business analyst works from: the project's own fields first, else the answer
 *  given to the business analyst's own question (recorded with the questions after the hand-over). A recorded answer
 *  counts however short it is. */
export function briefAnswers(i: { name: string; goal: string; users: string; asked?: readonly AskedRow[] }): {
  goal: string; users: string; missing: ("goal" | "users")[];
} {
  const q = briefQuestions(i.name);
  const answerTo = (question: string) =>
    (i.asked ?? []).find((r) => r.Status === "answered" && r.Question.trim() === question && (r.Answer ?? "").trim())?.Answer?.trim() ?? "";
  const goalAnswer = answerTo(q.goal);
  const usersAnswer = answerTo(q.users);
  const goal = !isThin(i.goal) ? i.goal.trim() : goalAnswer || i.goal.trim();
  const users = !isThin(i.users) ? i.users.trim() : usersAnswer || i.users.trim();
  // the person's own answer to the analyst's question is their answer, however short (owner, 09.11.2026: "global users"
  // is an answer); only a word or two in the project's own fields, written before the analysis, leaves it open
  const missing: ("goal" | "users")[] = [];
  if (isThin(goal) && !goalAnswer) missing.push("goal");
  if (isThin(users) && !usersAnswer) missing.push("users");
  return { goal, users, missing };
}

/** The objective as Business Analysis shows it ("What we understood"): the recorded goal (briefAnswers / briefFacts),
 *  else, while that is missing or too thin, the business analyst's drafted objective statement (Objective row). */
export function briefObjective(goal: string, statement: unknown): string {
  const drafted = typeof statement === "string" ? statement.trim() : "";
  return isThin(goal) && drafted ? drafted : goal;
}

/* ── what the project is about, wherever it is recorded ───────────────────── */

/** The project's description, objective and end users as every agent reads them. */
export interface BriefFacts { description: string; goal: string; targetUsers: string }

/** The records besides the project row that hold what the project is about. Since 08.11 Project Setup no longer asks
 *  for the goal or the users: the description lives in the "Project brief" note (Project.Brief stays empty), and after
 *  the hand-over the business analyst's two brief questions are answered as Clarification rows. */
export interface BriefRecords {
  /** The project's DocNote rows (only the Project brief note is read). */
  notes?: readonly Record<string, unknown>[];
  /** The project's Clarification rows (only answered brief questions are read). */
  clarifications?: readonly Record<string, unknown>[];
}

const textOf = (v: unknown): string => (typeof v === "string" ? v : "");
const liveRow = (r: Record<string, unknown>) => r.IsDeleted !== true;
const byItemId = (a: Record<string, unknown>, b: Record<string, unknown>) => textOf(a.ItemId).localeCompare(textOf(b.ItemId));
const numberOf = (r: Record<string, unknown>) => (typeof r.Number === "number" && Number.isFinite(r.Number) ? r.Number : 0);

/** The Project brief note among a project's notes: the one the guided start wrote (IsProjectBrief), else a note a
 *  person titled "Project brief" (not a scratch pad), the same way the setup save finds it. */
export function briefNoteOf(notes: readonly Record<string, unknown>[]): Record<string, unknown> | undefined {
  const live = notes.filter(liveRow).slice().sort(byItemId);
  return live.find((n) => n.IsProjectBrief === true) ?? live.find((n) => textOf(n.Title).trim() === BRIEF_TITLE && n.IsScratchPad !== true);
}

/** What the project is about: its own fields first; an empty description is the Project brief note's "About the
 *  project" section, and a missing or thin goal or users field is the answer to the business analyst's own brief
 *  question (briefAnswers, the rule of the Business Analysis page). Values are trimmed. */
export function briefFacts(project: Record<string, unknown>, records: BriefRecords = {}): BriefFacts {
  const own = textOf(project.Brief).trim();
  const note = own ? undefined : briefNoteOf(records.notes ?? []);
  const asked = (records.clarifications ?? []).filter(liveRow).slice().sort((a, b) => numberOf(a) - numberOf(b) || byItemId(a, b))
    .map((c) => ({ Question: textOf(c.Question), Answer: textOf(c.Answer), Status: textOf(c.Status) }));
  const a = briefAnswers({ name: textOf(project.Name), goal: textOf(project.Goal), users: textOf(project.TargetUsers), asked });
  return { description: own || (note ? briefAbout(textOf(note.BodyMd)) : ""), goal: a.goal, targetUsers: a.users };
}

/** A project's rows as the engine holds them (its ProjectView). */
export interface BriefRows {
  readonly project: Record<string, unknown>;
  rows(schema: string): readonly Record<string, unknown>[];
}
/** briefFacts from the engine's rows: every engine kind reads the description, goal and users through this. */
export const briefFactsOf = (p: BriefRows): BriefFacts => briefFacts(p.project, { notes: p.rows("DocNote"), clarifications: p.rows("Clarification") });
