// scope.success: Rajiv (the product manager) on Success & performance of a draft scope version.
//   "propose": the empty values get a proposal from the project (goal, target users, brief, the scope's features),
//              marked as suggested so the page shows them as the product manager's until someone changes them.
//   "answer":  the open questions ("Not sure yet — ask the product manager") get an answer and the reason for it;
//              the team then uses the answer, changes it, or goes ahead without a fixed value.
// Only the ScopeVersion's SuccessTargets is written, merged into the row as it stands right before the write.
import type { Row } from "../../../../../functions/_lib/gateway";
import {
  RESPONSE_TIME_CHOICES, SUCCESS_KEYS, parseSuccessTargets, serializeSuccessTargets, type SuccessKey, type SuccessTargets,
} from "../../../../../src/domain/successTargets";
import { briefFactsOf } from "../../../../../src/domain/projectBrief";
import { num, str, strs } from "../../context.ts";
import type { JobRun, KindResult } from "../../run.ts";
import { plural } from "../../text.ts";
import { early } from "../../ai/index.ts";
import { aiTargets } from "./ai.ts";

export interface SuccessFacts {
  name: string;
  goal: string;
  targetUsers: string;
  brief: string;
  industry: string;
  existingProduct: boolean;
  /** titles and descriptions of the scope's included features */
  featureText: string;
  featureCount: number;
}

export interface Proposal { value: string; reason: string; choice: string }

const has = (text: string, words: readonly string[]): boolean => {
  const t = text.toLowerCase();
  return words.some((w) => new RegExp(`(^|[^a-z])${w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`, "i").test(t));
};

const EXTERNAL = ["customer", "client", "buyer", "dealer", "retailer", "partner", "supplier", "patient", "member", "public", "citizen", "guest", "tenant", "shop", "b2b", "b2c"];
const INTERNAL = ["staff", "employee", "team", "back office", "back-office", "accountant", "dispatcher", "planner", "manager", "admin", "clerk", "technician", "agent", "warehouse"];
const ORDERS = ["order", "basket", "cart", "checkout", "invoice", "quote", "catalogue", "catalog", "product", "price"];
const DOCS = ["document", "file", "upload", "pdf", "contract", "receipt", "scan", "attachment"];
const BOOKINGS = ["booking", "appointment", "reservation", "slot", "schedule", "shift", "visit"];
const TIME = ["save time", "faster", "quicker", "reduce", "less time", "manual", "spreadsheet", "excel", "paper", "e-mail", "email", "phone"];

/** The people the project serves, read from the target users first, then the goal and brief. */
function audienceOf(f: SuccessFacts): { external: boolean; who: string } {
  const text = `${f.targetUsers} ${f.goal} ${f.brief}`;
  const external = has(f.targetUsers || text, EXTERNAL) && !(!has(f.targetUsers, EXTERNAL) && has(f.targetUsers, INTERNAL));
  const first = f.targetUsers.split(/[,;\n]| and /i).map((x) => x.trim()).filter(Boolean)[0] ?? "";
  const who = first ? first.replace(/\.$/, "").toLowerCase() : external ? "customers" : "the team";
  return { external, who };
}

/** One proposal per value, with the reason the product manager gives for it. */
export function proposeTargets(f: SuccessFacts): Record<SuccessKey, Proposal> {
  const all = `${f.goal} ${f.brief} ${f.featureText}`;
  const { external, who } = audienceOf(f);
  const orders = has(all, ORDERS);
  const docs = has(all, DOCS);
  const bookings = has(all, BOOKINGS);
  const saveTime = has(`${f.goal} ${f.brief}`, TIME);
  const goalLine = f.goal.trim().replace(/\s+/g, " ").replace(/\.$/, "");
  const goalShort = goalLine.length > 90 ? `${goalLine.slice(0, 87).replace(/\s+\S*$/, "")}…` : goalLine;

  const outcome: Proposal = orders && external
    ? { value: `70% of repeat orders placed online within six months of launch, and order errors halved`, reason: "Online share of repeat orders and fewer order corrections are what a portal changes first; both can be counted from the order history.", choice: "" }
    : bookings
      ? { value: `80% of ${who.includes("customer") || external ? "bookings" : "planning"} done in the new system within three months, with no double bookings`, reason: "Adoption and the end of double bookings are the two signs that the old way can be switched off.", choice: "" }
      : saveTime
        ? { value: `Handling time per case down by half within three months of launch, and no parallel spreadsheets left`, reason: `The goal${goalShort ? ` ("${goalShort}")` : ""} is about time and manual work, so time per case and retired spreadsheets show the effect best.`, choice: "" }
        : docs
          ? { value: `Every document found in under a minute, and 90% of documents filed in the system within three months`, reason: "Finding documents fast and having them in one place is the result people notice.", choice: "" }
          : { value: `${goalShort ? `${goalShort}: ` : ""}at least 80% of ${who} use it every week three months after launch`, reason: "Weekly use by the people it is built for is the clearest early sign that it works; the goal gives the result to measure.", choice: "" };

  const users: Proposal = external
    ? orders
      ? { value: `about 400 ${who.includes("buyer") ? "buyers" : "customer accounts"}, up to 80 at the same time on Monday mornings`, reason: "Business customers order in waves at the start of the week; about one in five is online at the peak.", choice: "" }
      : { value: `about 1,500 ${who}, up to 150 at the same time`, reason: "For an external audience about one in ten is online at the busiest hour.", choice: "" }
    : { value: `about 40 ${who === "the team" ? "people in the team" : who}, up to 25 at the same time`, reason: "An internal tool is used by most of the team during office hours.", choice: "" };

  const fast = RESPONSE_TIME_CHOICES.find((c) => c.id === "fast")!;
  const normal = RESPONSE_TIME_CHOICES.find((c) => c.id === "normal")!;
  const responseTime: Proposal = external
    ? { value: fast.value, choice: fast.id, reason: "Customers leave when pages feel slow; one second keeps searching and ordering fluent." }
    : { value: normal.value, choice: normal.id, reason: "Two seconds is comfortable for daily work; reports can take a little longer without slowing anyone down." };

  const dataVolume: Proposal = orders
    ? { value: "about 30,000 orders a year, 5,000 products, five years of history kept", reason: "Sized from the order and catalogue features; five years covers the usual retention for business records.", choice: "" }
    : docs
      ? { value: "about 20,000 documents a year (up to 25 MB each), kept ten years", reason: "Documents are the bulk of the data; ten years is the usual retention for business documents.", choice: "" }
      : bookings
        ? { value: "about 50,000 bookings a year, two years of history online", reason: "Sized from the booking features; older bookings can be archived.", choice: "" }
        : { value: "about 50,000 records in the first year, growing about 30% a year", reason: "A typical size for a business application of this scope; nothing in the brief points to large files.", choice: "" };

  const availability: Proposal = external
    ? { value: "weekdays 06:00–20:00 CET, busiest on Monday mornings and before month-end; maintenance only at night or at weekends", reason: "Business customers order during working hours; the peaks follow their own planning.", choice: "" }
    : { value: "working days 07:00–19:00 CET; month-end is the peak; maintenance outside office hours", reason: "The team works office hours; month-end brings the most work.", choice: "" };

  return { outcome, users, responseTime, dataVolume, availability };
}

/** The facts of the project the proposals are made from. */
export function factsOf(run: JobRun, version: number): SuccessFacts {
  const p = run.p;
  const pr = p.project;
  const features = p.includedFeatures(version);
  const about = briefFactsOf(p);
  return {
    name: p.name,
    goal: about.goal,
    targetUsers: about.targetUsers,
    brief: `${about.description} ${str(pr.Description)} ${strs(pr.MustHaves).join(" ")}`.trim(),
    industry: p.industry,
    existingProduct: p.existingProduct,
    featureText: features.map((r) => `${str(r.Title)} ${str(r.Description)}`).join(" "),
    featureCount: features.length,
  };
}

/** The targets after the product manager's work (pure, so the tests can check it). */
export function applyProposals(t: SuccessTargets, mode: "propose" | "answer", props: Record<SuccessKey, Proposal>, keys: readonly SuccessKey[], at: string): { targets: SuccessTargets; changed: SuccessKey[] } {
  const out = parseSuccessTargets(serializeSuccessTargets(t));
  const changed: SuccessKey[] = [];
  for (const k of SUCCESS_KEYS) {
    if (keys.length && !keys.includes(k)) continue;
    const cur = out[k];
    const pr = props[k];
    if (mode === "propose") {
      if (cur.unsure || cur.value.trim()) continue;
      out[k] = { ...cur, value: pr.value, choice: pr.choice, suggested: true };
      changed.push(k);
    } else {
      const q = cur.question;
      if (!cur.unsure || !q || (q.status !== "open" && q.status !== "proposed")) continue;
      out[k] = { ...cur, question: { ...q, status: "proposed", answer: pr.value, reason: pr.reason, answeredAt: at } };
      changed.push(k);
    }
  }
  return { targets: out, changed };
}

const LABEL: Record<SuccessKey, string> = {
  outcome: "the success outcome", users: "the expected users", responseTime: "the response time", dataVolume: "the data volume", availability: "the peak times",
};

export async function scopeSuccess(run: JobRun): Promise<KindResult> {
  const p = run.p;
  const versionNumber = num(run.input.scopeVersion, p.scopeVersion) || p.scopeVersion;
  const mode = run.input.mode === "answer" ? "answer" : "propose";
  const keys = strs(run.input.keys).filter((k): k is SuccessKey => (SUCCESS_KEYS as readonly string[]).includes(k));
  const versionRow = (): Row | undefined => {
    const id = str(run.input.scopeVersionId);
    return (id ? p.row("ScopeVersion", id) : undefined) ?? p.rows("ScopeVersion").find((r) => num(r.Number) === versionNumber);
  };
  if (!versionRow()) return { outputs: [], message: `Scope v${versionNumber} was not found.` };

  const facts = factsOf(run, versionNumber);
  // the questions the team asked (answer mode), for Claude's answers; started now, read when the step gets there
  const open = parseSuccessTargets(versionRow()!.SuccessTargets);
  const questions: Partial<Record<SuccessKey, string>> = {};
  if (mode === "answer") for (const k of SUCCESS_KEYS) if ((!keys.length || keys.includes(k)) && open[k].unsure && open[k].question) questions[k] = open[k].question!.text;
  const fromAi = early(aiTargets(run, facts, questions));
  await run.step(10, mode === "answer" ? "Reading the open questions on success & performance." : `Reading the goal and target users of ${facts.name}.`);
  await run.wait(2);
  await run.step(45, `Comparing with ${plural(facts.featureCount, "feature")} in scope v${versionNumber}.`);
  await run.wait(2.5);
  const props = (await fromAi) ?? proposeTargets(facts);
  await run.step(80, mode === "answer" ? "Writing the answers." : "Writing the proposals.");
  await run.wait(1.2);

  // merged into the row as it stands now: the team may have changed other values meanwhile
  const row = versionRow()!;
  if (row.Status === "locked") return { outputs: [], message: "The scope was locked meanwhile; nothing was changed." };
  const { targets, changed } = applyProposals(parseSuccessTargets(row.SuccessTargets), mode, props, keys, run.iso());
  if (!changed.length) {
    return { outputs: [], message: mode === "answer" ? "There were no open questions to answer." : "Every value is already set." };
  }
  await run.update("ScopeVersion", str(row.ItemId), { SuccessTargets: serializeSuccessTargets(targets) });
  const list = changed.map((k) => LABEL[k]);
  const named = list.length <= 2 ? list.join(" and ") : `${list.slice(0, -1).join(", ")} and ${list[list.length - 1]}`;
  return {
    outputs: [`ScopeVersion:${str(row.ItemId)}`],
    message: mode === "answer" ? `Answered ${plural(changed.length, "question")}: ${named}.` : `Proposed ${named}.`,
  };
}
