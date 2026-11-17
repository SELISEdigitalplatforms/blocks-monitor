// The screen designs of a project: which screens (from the scope features, else the requirements), on which device
// (from the design brief and who uses the screen), in which colours, and what each screen shows (the project's own
// titles and criteria plus believable entries from its line of business). Pure: no I/O.
import type { ScreenBlock, ScreenImage } from "../../../../../seed/core/draw.ts";
import { cap, clip, hashOf, overlap, slugOf, statementsOf, wordsOf } from "../../text.ts";
import { WORDS, mentions, thirdPerson, type FeatureInfo } from "./common.ts";
import { isScreenWorthy, screenNameOf } from "./naming.ts";
import { currencyOfCode, money } from "../../../../engine-context/currency.ts";
import type { ProjectFacts } from "../../../../engine-context/facts.ts";

export type ScreenKind = "signin" | "list" | "form" | "upload" | "status" | "map" | "desk" | "dashboard" | "detail";

export interface ScreenPlan {
  key: string;
  name: string;
  device: "mobile" | "desktop";
  kind: ScreenKind;
  feature?: FeatureInfo;
  /** A requirement the screen stands for when the scope has no features yet. */
  basis?: { title: string; text: string; criteria: string[] };
}

export interface DesignInput {
  projectName: string;
  client: string;
  clientContact: string;
  industry: string;
  brief: string;
  instructions: string;
  features: FeatureInfo[];
  requirements: { key: string; title: string; text: string; category: string; criteria: string[] }[];
  /** Screens of this brief that already exist (latest version per key, not superseded). */
  existing: { key: string; name: string; width: number; height: number; status: string }[];
  /** The currency the project's material names ("EUR"); "" or absent: amounts stay plain (engine-context/currency.ts). */
  currency?: string;
  /** The project's facts (tax rate, payout schedule, country: engine-context/facts.ts), the same ones the build uses. */
  facts?: ProjectFacts;
}

// ── colours and names ───────────────────────────────────────────────────────────────────────────────────────────

const COLOUR_WORDS: [RegExp, string][] = [
  [/\bnavy\b/, "1e3a6e"],
  [/\bblue\b/, "1f5fae"],
  [/\bteal|petrol\b/, "0f766e"],
  [/\bgreen\b/, "2f7d4f"],
  [/\bred\b/, "b42318"],
  [/\borange\b/, "c2410c"],
  [/\byellow|gold\b/, "a16207"],
  [/\bbrown\b/, "7a4b2a"],
  [/\bsand\b/, "a8865a"],
  [/\bpurple|violet\b/, "6d28d9"],
  [/\bpink\b/, "be185d"],
  [/\bgr[ae]y|anthracite|graphite\b/, "374151"],
  [/\bblack\b/, "1f2933"],
];
const PALETTE = ["1f5fae", "2f7d4f", "0f766e", "7a4b2a", "6d28d9", "b42318", "c2410c", "374151"];

/** The colour the instructions name: a hex code, else the first colour word; null when they name none. */
export function explicitBrandOf(instructions: string): string | null {
  const hex = /#([0-9a-f]{6})\b/i.exec(instructions);
  if (hex) return hex[1]!.toLowerCase();
  const t = instructions.toLowerCase();
  let best: { at: number; c: string } | null = null;
  for (const [re, c] of COLOUR_WORDS) {
    const m = re.exec(t);
    if (m && (!best || m.index < best.at)) best = { at: m.index, c };
  }
  return best?.c ?? null;
}

/** The brand colour: the one the instructions name, else one chosen for the client. */
export function brandOf(instructions: string, client: string, projectName: string): string {
  return explicitBrandOf(instructions) ?? PALETTE[hashOf(`brand:${client || projectName}`) % PALETTE.length]!;
}

export const shortClient = (name: string): string => name.replace(/\s+(AG|GmbH|SA|Sàrl|SARL|Ltd\.?|Inc\.?|KG|AB|S\.A\.)$/i, "").trim();

/** The name in the app's header: the client's short name, else the project's (at most 22 characters, on a word). */
export function appLabel(client: string, projectName: string): string {
  const s = (shortClient(client) || projectName).trim();
  if (s.length <= 22) return s;
  let out = "";
  for (const w of s.split(/\s+/)) {
    if ((out ? `${out} ${w}` : w).length > 22) break;
    out = out ? `${out} ${w}` : w;
  }
  return out || s.slice(0, 22);
}

const ascii = (s: string): string =>
  s
    .replace(/ä/g, "ae")
    .replace(/ö/g, "oe")
    .replace(/ü/g, "ue")
    .replace(/Ä/g, "Ae")
    .replace(/Ö/g, "Oe")
    .replace(/Ü/g, "Ue")
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "");

export function emailOf(contact: string, client: string): string {
  const domain = `${slugOf(ascii(shortClient(client) || "company")).replace(/-/g, "")}.com`;
  const parts = ascii(contact).toLowerCase().split(/\s+/).filter(Boolean);
  const local = parts.length >= 2 ? `${parts[0]}.${parts[parts.length - 1]}` : parts[0] ?? "anna.meier";
  return `${local.replace(/[^a-z.]/g, "")}@${domain}`;
}

// ── the line of business: believable entries ────────────────────────────────────────────────────────────────────

interface Domain {
  key: string;
  test: RegExp;
  search: string;
  items: [string, string][];
  /** Who the rows of a desk table are about. */
  people: string[];
  steps: string[];
  /** "money": the item values that are plain amounts are shown in the project's currency; "" for other values. */
  unit: "money" | "";
}

const DOMAINS: Domain[] = [
  {
    key: "marketplace",
    test: /marketplace|digital asset|\bassets?\b|template|icon set|\bfonts?\b|creator|seller|buyer|licen[cs]e|download|storefront/,
    search: "line icons",
    items: [["Line icon set, 240 icons", "24.00"], ["Brand kit template", "39.00"], ["Grotesk display font", "49.00"], ["Alpine photo pack", "19.00"], ["Pitch deck template", "29.00"]],
    people: ["Mira Okafor", "Jonas Keller", "Lea Brunner", "Tomas Ruiz", "Aiko Tanaka"],
    steps: ["Uploaded", "In review", "Approved", "Live"],
    unit: "money",
  },
  {
    key: "food",
    test: /food|fresh|restaurant|kitchen|produce|grocer|gastro|catering|wholesale/,
    search: "tomatoes",
    items: [["Cherry tomatoes 1 kg", "8.40"], ["Whole milk 1 l", "1.45"], ["Butter 1 kg", "11.90"], ["Iceberg lettuce", "1.35"], ["Arborio rice 5 kg", "17.50"]],
    people: ["Restaurant Lindenhof", "Hotel Seeblick", "Deli Fontana", "Cafe Rosengarten", "Kantine Sulzer"],
    steps: ["Received", "Picked", "On way", "Done"],
    unit: "money",
  },
  {
    key: "parts",
    test: /spare|parts|pump|industrial|machine|valve|serial number/,
    search: "SN 4471-220",
    items: [["Impeller 140 mm", "312.00"], ["Shaft seal kit", "86.50"], ["Bearing 6205-2RS", "24.80"], ["O-ring set NBR", "12.40"], ["Coupling half 28 mm", "64.00"]],
    people: ["Hydro Service AG", "Aqua Tec GmbH", "Termo SA", "Wasserwerk Uster", "Pumpen Frei"],
    steps: ["Ordered", "In ERP", "Shipped", "Done"],
    unit: "money",
  },
  {
    key: "quality",
    test: /certificate|audit|quality|temperature log/,
    search: "IFS",
    items: [["IFS Food - Moser", "45 days"], ["Bio Suisse - Brunner", "21 days"], ["BRCGS - Fleisch Thun", "12 days"], ["Temp. log 23.10", "OK"], ["Temp. log 24.10", "7.9 C"]],
    people: ["Bergkaeserei Moser", "Gemuesehof Brunner", "Fleisch AG Thun", "Beck Glatz", "Molkerei Gais"],
    steps: ["Uploaded", "Checked", "Approved", "Valid"],
    unit: "",
  },
  {
    key: "payroll",
    test: /payroll|payslip|salary|employer|absence/,
    search: "Payslip",
    items: [["Payslip September", "6240.00"], ["Payslip August", "6240.00"], ["Salary statement 2025", "PDF"], ["Hours October", "38.5 h"], ["Absence request", "3 days"]],
    people: ["Lea Brunner", "Marco Steiner", "Nina Graf", "Daniel Frei", "Sara Huber"],
    steps: ["Entered", "Checked", "Paid", "Done"],
    unit: "money",
  },
  {
    key: "receipts",
    test: /receipt|expense|booking|bookkeeping/,
    search: "Coop",
    items: [["Coop Pronto 23.10", "18.60"], ["SBB Zurich-Bern", "56.00"], ["Hotel Bern 1 night", "189.00"], ["Parking Bahnhof", "12.00"], ["Office supplies", "42.90"]],
    people: ["Schreinerei Graf", "Malerei Keller", "Studio Weber", "Garage Huber", "Velo Frei"],
    steps: ["Photographed", "Read", "Booked", "Done"],
    unit: "money",
  },
  {
    key: "service",
    test: /technician|service report|visit|maintenance|field service/,
    search: "Winterthur",
    items: [["09:00 Baeckerei Huber", "Boiler"], ["11:30 Hotel Krone", "Cooling"], ["14:00 Migros Oerlikon", "Pump"], ["16:15 Spital Buelach", "Filter"], ["17:30 Kantine ABB", "Valve"]],
    people: ["Baeckerei Huber", "Hotel Krone", "Migros Oerlikon", "Spital Buelach", "Kantine ABB"],
    steps: ["Planned", "On site", "Reported", "Invoiced"],
    unit: "",
  },
  {
    key: "delivery",
    test: /driver|delivery|route|logistic|pallet|tour|dispatch/,
    search: "Winterthur",
    items: [["Restaurant Lindenhof", "06:10"], ["Hotel Seeblick", "06:35"], ["Deli Fontana", "07:05"], ["Cafe Rosengarten", "07:30"], ["Kantine Sulzer", "08:00"]],
    people: ["Restaurant Lindenhof", "Hotel Seeblick", "Deli Fontana", "Cafe Rosengarten", "Kantine Sulzer"],
    steps: ["Loaded", "On way", "Delivered", "Signed"],
    unit: "",
  },
  {
    key: "documents",
    test: /tax|statement|document|fiduciar|client portal|trust/,
    search: "Receipts 2025",
    items: [["Receipts 2025", "14 files"], ["Annual statement", "Signed"], ["Bank statements Q3", "Missing"], ["Pension certificate", "Uploaded"], ["Tax return 2025", "Open"]],
    people: ["Familie Brunner", "Keller Treuhand", "Studio Weber", "Garage Huber", "Dr. Nina Graf"],
    steps: ["Requested", "Uploaded", "Checked", "Signed"],
    unit: "",
  },
  {
    key: "suppliers",
    test: /onboarding|purchasing|vendor|supplier/,
    search: "Holzbau",
    items: [["Holzbau Gerber AG", "Approved"], ["Metallwerk Sutter", "Bank details"], ["Print & Pack GmbH", "In review"], ["Elektro Buehler", "Expiring"], ["Logistik Frei", "New"]],
    people: ["Holzbau Gerber AG", "Metallwerk Sutter", "Print & Pack GmbH", "Elektro Buehler", "Logistik Frei"],
    steps: ["Registered", "Documents", "Approved", "Active"],
    unit: "",
  },
  {
    key: "leads",
    test: /lead|trade fair|crm|sales/,
    search: "Hydro",
    items: [["Martin Keller, Hydro AG", "Hot"], ["Sara Weber, Aqua Tec", "Warm"], ["Luca Rossi, Termo SA", "New"], ["Anna Frei, Pumpen Frei", "Follow-up"], ["Jan Huber, Wasserwerk", "Cold"]],
    people: ["Hydro AG", "Aqua Tec", "Termo SA", "Pumpen Frei", "Wasserwerk Uster"],
    steps: ["Captured", "In CRM", "Called", "Won"],
    unit: "",
  },
];

export function domainOf(text: string): Domain | null {
  const t = text.toLowerCase();
  let best: Domain | null = null;
  let score = 0;
  for (const d of DOMAINS) {
    const n = (t.match(new RegExp(d.test.source, "g")) ?? []).length;
    if (n > score) [best, score] = [d, n];
  }
  return best;
}

// ── which screens ───────────────────────────────────────────────────────────────────────────────────────────────

/** The kind of a screen: its name decides first, the feature's words next; desk work on a desktop is a table. */
export function kindOf(name: string, text: string, device: "mobile" | "desktop"): ScreenKind {
  const k = kindByWords(name.toLowerCase(), device) ?? kindByWords(text.toLowerCase(), device) ?? "detail";
  if (device === "desktop" && (k === "form" || k === "list" || k === "detail" || k === "dashboard")) return "desk";
  return k;
}

function kindByWords(t: string, device: "mobile" | "desktop"): ScreenKind | null {
  if (/\b(sign in|sign-in|login|log in)\b/.test(t)) return "signin";
  if (/status|track|follow|progress/.test(t)) return "status";
  if (/route|map|stops?\b|tour|location/.test(t)) return "map";
  if (/upload|photo|scan|capture|attach|receipt|signature/.test(t)) return "upload";
  if (/desk|admin|approv|overview|dashboard|report|export|erp|review|register|statistic/.test(t)) return device === "desktop" ? "desk" : "dashboard";
  if (/order|cart|basket|request|book|hours|absence|form|enter|repeat/.test(t)) return "form";
  if (/catalog|search|list|browse|price|parts|find|see |document|certificate|payslip|statement|files?\b/.test(t)) return "list";
  return null;
}

const isStaff = (f: FeatureInfo | undefined, text: string): boolean =>
  mentions(text, ["desk", "office", "back office", "admin", "approve", "approval", "dashboard", "overview", "export", "erp", "purchasing", "quality assurance", "dispatcher", "accountant", "payroll team", "employer"]) ||
  Boolean(f?.stories.some((s) => mentions(s.actor, WORDS.desk)));

export function planScreens(x: DesignInput): ScreenPlan[] {
  const ins = `${x.instructions} ${x.brief}`.toLowerCase();
  const mobileWords = /mobile|phone|\bapp\b|touch|on the go|driver|technician|tablet|on site/.test(ins);
  const desktopFirst = /desktop first|desktop-first|laptop first/.test(ins);
  const desktopWords = /desktop|\bdesk\b|laptop|office|back office|admin|spreadsheet|dashboard/.test(ins);
  const primary: "mobile" | "desktop" = mobileWords && !desktopFirst ? "mobile" : "desktop";
  const staffDevice: "mobile" | "desktop" = desktopWords || primary === "desktop" ? "desktop" : "mobile";

  // A re-generation keeps the screen set: every screen not yet accepted gets a new version.
  if (x.existing.length > 0) {
    const open = x.existing.filter((s) => s.status !== "accepted");
    const list = open.length > 0 ? open : x.existing;
    return list.map((s) => {
      const device = s.width < s.height && s.width <= 768 ? "mobile" : "desktop";
      const feature = bestFeature(x.features, s.name);
      return { key: s.key, name: s.name, device, kind: kindOf(s.name, `${feature?.title ?? ""} ${feature?.description ?? ""}`, device), feature };
    });
  }

  const taken = new Set<string>(["sign-in"]);
  const out: ScreenPlan[] = [{ key: "sign-in", name: "Sign in", device: primary, kind: "signin" }];
  const candidates: { name: string; feature?: FeatureInfo; basis?: ScreenPlan["basis"]; text: string }[] =
    x.features.length > 0
      ? [...x.features]
          .sort((a, b) => (a.priority === "must" ? 0 : a.priority === "nice" ? 1 : 2) - (b.priority === "must" ? 0 : b.priority === "nice" ? 1 : 2) || a.sortOrder - b.sortOrder)
          .filter((f) => !/\b(sign in|sign-in|login)\b/i.test(f.title))
          .map((f) => ({ name: screenTitleOf(f.title), feature: f, text: `${f.title} ${f.description} ${f.stories.map((s) => s.title).join(" ")}` }))
      : x.requirements
          .filter((r) => (r.category === "functional" || r.category === "integration" || r.category === "") && isScreenWorthy(r.title))
          .map((r) => ({ name: screenNameOf(r.title || r.key.replace(/-/g, " ")), basis: { title: r.title, text: r.text, criteria: r.criteria }, text: `${r.title} ${r.text}` }))
          // the sign-in screen is always the first one
          .filter((c) => !/^sign in$/i.test(c.name));
  if (candidates.length === 0) {
    for (const s of statementsOf(x.brief).slice(0, 3)) candidates.push({ name: screenNameOf(s), basis: { title: s, text: s, criteria: [] }, text: s });
  }
  const main = candidates.filter((c) => !isStaff(c.feature, c.text));
  const staff = candidates.filter((c) => isStaff(c.feature, c.text));
  const chosen = [...main.slice(0, staff.length > 0 ? 3 : 4), ...staff.slice(0, 2)];
  for (const c of [...main, ...staff]) if (chosen.length < 4 && !chosen.includes(c)) chosen.push(c);
  const usedNames = new Set<string>(["sign in"]);
  for (const c of chosen.slice(0, 5)) {
    if (usedNames.has(c.name.toLowerCase())) continue;
    usedNames.add(c.name.toLowerCase());
    const device = isStaff(c.feature, c.text) ? staffDevice : primary;
    const name = clip(c.name, 40);
    let key = slugOf(name, 40);
    for (let i = 2; taken.has(key); i++) key = `${slugOf(name, 36)}-${i}`;
    taken.add(key);
    out.push({ key, name, device, kind: kindOf(name, c.text, device), feature: c.feature, basis: c.basis });
  }
  return out;
}

/** A feature's title is its screen's name when it is short ("Repeat order"); a sentence gets a short name instead. */
function screenTitleOf(title: string): string {
  const t = title.trim();
  return t.split(/\s+/).length <= 4 && !/[.:;]/.test(t) ? t : screenNameOf(t);
}

/** The same screen on the other device (its kind follows the device: desk work on a desktop is a table). */
export function onDevice(plan: ScreenPlan, device: "mobile" | "desktop"): ScreenPlan {
  if (plan.device === device) return plan;
  const text = `${plan.feature?.title ?? plan.basis?.title ?? ""} ${plan.feature?.description ?? plan.basis?.text ?? ""}`;
  return { ...plan, device, kind: plan.kind === "signin" ? "signin" : kindOf(plan.name, text, device) };
}

function bestFeature(features: readonly FeatureInfo[], name: string): FeatureInfo | undefined {
  const w = wordsOf(name);
  let best: FeatureInfo | undefined;
  let score = 0;
  for (const f of features) {
    const s = overlap(w, wordsOf(f.title)) * 2 + overlap(w, f.words);
    if (s > score) [best, score] = [f, s];
  }
  return best;
}

// ── what a screen shows ─────────────────────────────────────────────────────────────────────────────────────────

const VERB: [RegExp, string][] = [
  [/order/, "Send order"],
  [/request|absence/, "Send request"],
  [/report/, "Send report"],
  [/hours/, "Submit hours"],
  [/book/, "Book"],
  [/register|onboard/, "Register"],
  [/repeat/, "Repeat this order"],
];

/** Clipped for a screen (the screen font has no ellipsis sign). */
const short = (s: string, n: number): string => clip(s.replace(/[.]+$/, ""), n).replace(/…$/, "...");

const NAV_SKIP = new Set(["my", "the", "a", "an", "see", "your", "our", "new", "all"]);

/** Short tab labels: the first telling word of each name, each label once. */
function navLabels(names: readonly string[]): string[] {
  const used = new Set<string>();
  return names.map((n) => {
    const words = n.split(/\s+/).filter((w) => w && !NAV_SKIP.has(w.toLowerCase()));
    const pick = words.find((w) => !used.has(w.toLowerCase())) ?? words[0] ?? n;
    used.add(pick.toLowerCase());
    return cap(pick.slice(0, 9));
  });
}

export function screenImage(plan: ScreenPlan, all: readonly ScreenPlan[], x: DesignInput): ScreenImage {
  const brand = brandOf(x.instructions, x.client, x.projectName);
  const app = appLabel(x.client, x.projectName);
  const text = `${x.projectName} ${x.brief} ${x.industry} ${x.features.map((f) => f.title).join(" ")}`;
  const d = domainOf(text);
  const f = plan.feature;
  const story = f?.stories[0];
  const criteria = f ? f.stories.flatMap((s) => s.criteria) : plan.basis?.criteria ?? [];
  const lineOf = f?.description || story?.text || plan.basis?.text || "";
  const states = d?.steps ?? ["New", "In progress", "Done"];
  const cur = x.currency ? currencyOfCode(x.currency) : null;
  const amount = (v: string): string => (d?.unit === "money" && /^\d+(?:\.\d+)?$/.test(v) ? money(Number(v), cur) : v);
  const items: [string, string][] = d ? d.items.map(([t, v]): [string, string] => [t, amount(v)]) : (f?.stories ?? []).slice(0, 5).map((s, i): [string, string] => [short(s.title, 28), states[i % states.length]!]);
  // without a line of business or stories: the screen's own checks and the project's requirements as its entries
  const own = [...criteria, ...x.requirements.map((r) => r.title)].filter((t) => t.trim().length > 3);
  const fallback: [string, string][] = items.length
    ? items
    : own.length
      ? own.slice(0, 5).map((t, i): [string, string] => [short(t, 28), states[i % states.length]!])
      : [[short(plan.name, 28), states[0]!]];

  const sameDevice = all.filter((s) => s.device === plan.device && s.kind !== "signin");
  const tabs = plan.device === "mobile" ? sameDevice.slice(0, 3) : sameDevice.slice(0, 6);
  const labels = plan.device === "mobile" ? ["Home", ...navLabels(tabs.map((s) => s.name))] : tabs.map((s) => short(s.name, 17));
  const nav = plan.kind === "signin" ? undefined : labels;
  const at = tabs.findIndex((s) => s.key === plan.key);
  const activeNav = nav ? (at < 0 ? 0 : plan.device === "mobile" ? at + 1 : at) : undefined;
  const blocks: ScreenBlock[] = [];

  switch (plan.kind) {
    case "signin": {
      const first = statementsOf(x.brief)[0];
      blocks.push({ k: "hero", title: "Welcome back", text: first ? short(first, 70) : `Sign in to ${x.projectName}.` });
      blocks.push({ k: "field", label: "E-mail", value: emailOf(x.clientContact, x.client) });
      blocks.push({ k: "field", label: "Password", value: "********" });
      blocks.push({ k: "button", text: "Sign in" });
      blocks.push({ k: "button", text: "Forgot password", secondary: true });
      break;
    }
    case "list":
      blocks.push({ k: "field", label: "Search", value: d?.search ?? "" });
      blocks.push({ k: "list", items: fallback.slice(0, 5) });
      if (criteria[0]) blocks.push({ k: "note", text: short(criteria[0], 90) });
      break;
    case "form": {
      const verb = VERB.find(([re]) => re.test(`${plan.name} ${lineOf}`.toLowerCase()))?.[1] ?? "Save";
      blocks.push({ k: "card", title: short(d?.people[0] ?? plan.name, 30), lines: [short(criteria[0] || lineOf || plan.name, 80)], badge: "Draft", tone: "info" });
      blocks.push({ k: "list", items: fallback.slice(0, 3) });
      const total = d?.unit === "money" ? fallback.slice(0, 3).reduce((s, [, v]) => s + (Number.parseFloat(v.replace(/[^\d.]/g, "")) || 0), 0) : 0;
      blocks.push({ k: "stats", items: [["Items", String(Math.min(3, fallback.length))], ["Total", total > 0 ? money(total, cur) : "-"]] });
      blocks.push({ k: "button", text: verb });
      if (criteria[1]) blocks.push({ k: "note", text: short(criteria[1], 90) });
      break;
    }
    case "upload":
      blocks.push({ k: "card", title: short(plan.name, 30), lines: [short(criteria[0] || lineOf || "Add a photo or a file.", 80)], badge: "2 missing", tone: "warn" });
      blocks.push({ k: "button", text: plan.device === "mobile" ? "Take photo" : "Upload file" });
      blocks.push({ k: "button", text: plan.device === "mobile" ? "Choose file" : "Download all", secondary: true });
      blocks.push({ k: "list", items: fallback.slice(0, 4) });
      break;
    case "status": {
      const steps = d?.steps ?? ["Received", "In progress", "Checked", "Done"];
      blocks.push({ k: "steps", items: steps, active: 2 });
      const head = plan.name.split(/\s+/).find((w) => !NAV_SKIP.has(w.toLowerCase())) ?? "Order";
      blocks.push({ k: "card", title: `${cap(head)} 4712`, lines: [d?.people[1] ?? short(lineOf || plan.name, 60), "Updated 10 minutes ago"], badge: steps[2]!, tone: "info" });
      if (d?.key === "delivery" || d?.key === "food" || d?.key === "service") blocks.push({ k: "map", pins: 3 });
      else blocks.push({ k: "list", items: fallback.slice(0, 3) });
      break;
    }
    case "map":
      blocks.push({ k: "card", title: `${fallback.length} stops today`, lines: [short(lineOf || plan.name, 80)], badge: "Next 06:10", tone: "info" });
      blocks.push({ k: "map", pins: 4 });
      blocks.push({ k: "list", items: fallback.slice(0, 3) });
      break;
    case "dashboard":
      blocks.push({ k: "stats", items: [["Open", "12"], ["Today", "5"], ["Late", "2"]] });
      blocks.push({ k: "chart", values: [4, 6, 5, 8, 7, 9, 6] });
      blocks.push({ k: "list", items: fallback.slice(0, 3) });
      break;
    case "desk": {
      const people = d?.people ?? ["North", "East", "South", "West", "Central"];
      const states = d?.steps ?? ["New", "In progress", "Checked", "Done"];
      blocks.push({ k: "stats", items: [["Open", "18"], ["Today", "7"], ["Needs action", "3"], ["Done this week", "42"]] });
      blocks.push({
        k: "table",
        head: ["No.", "Who", "Item", "Status", "Updated"],
        rows: fallback.slice(0, 5).map(([title], i) => [String(4711 + i), people[i % people.length]!, title, states[i % states.length]!, `${8 + i}:${i % 2 ? "15" : "40"}`]),
      });
      if (criteria[0]) blocks.push({ k: "note", text: short(criteria[0], 120) });
      break;
    }
    case "detail":
    default:
      blocks.push({ k: "hero", title: short(plan.name, 28), text: short(lineOf || (story ? cap(thirdPerson(story.title)) : plan.name), 90) });
      for (const s of (f?.stories ?? []).slice(0, 2)) blocks.push({ k: "card", title: short(s.title, 30), lines: s.criteria.slice(0, 2).map((c) => short(c, 70)) });
      if (!f) blocks.push({ k: "list", items: fallback.slice(0, 3) });
      blocks.push({ k: "button", text: "Continue" });
      break;
  }
  return { type: "screen", device: plan.device, brand, app, title: short(plan.name, plan.device === "mobile" ? 22 : 40), nav, activeNav, blocks };
}
