// What the code writer is asked: the product (brief, objective, locked scope, requirements, design brief, success
// targets), the tickets of this build with their acceptance criteria, what earlier builds made and what comes later.
// Read from the project's rows (ProjectView), so the same records the people confirmed drive the code. No I/O.
import type { Row } from "../../../../functions/_lib/gateway";
import { num, str, strs, type ProjectView } from "../context.ts";
import { parseProductPrototype } from "../../../../src/domain/factoryDesign";
import { briefFactsOf } from "../../../../src/domain/projectBrief";

export interface BuildTicket {
  id: string;
  number: number;
  title: string;
  description: string;
  acceptance: string[];
  feature: string;
  done: boolean;
  /** What people wrote on the ticket (board comments, oldest first): the build follows them. */
  comments?: string[];
}

/** The people's comments on a ticket (TicketEvent Kind "comment", not the engine's own remarks), oldest first. */
export function ticketComments(p: ProjectView, ticketId: string): string[] {
  return p
    .rows("TicketEvent")
    .filter((e) => str(e.TicketId) === ticketId && str(e.Kind) === "comment" && e.IsAuto !== true && str(e.AuthorUserId) && str(e.Text).trim())
    .sort((a, b) => str(a.At).localeCompare(str(b.At)))
    .map((e) => str(e.Text).trim().slice(0, 1500))
    .slice(-8);
}

export function buildTicketOf(r: Row, p: ProjectView): BuildTicket {
  const ref = str(r.FeatureRef).replace(/^feature:/, "");
  const f = ref ? p.features().find((x) => str(x.Key) === ref) : undefined;
  return {
    id: str(r.ItemId),
    number: num(r.Number),
    title: str(r.Title) || "the ticket",
    description: str(r.Description),
    acceptance: strs(r.Acceptance).filter((a) => a.trim() !== ""),
    feature: str(f?.Title),
    done: r.Column === "done",
    comments: ticketComments(p, str(r.ItemId)),
  };
}

const bullets = (xs: readonly string[], indent = ""): string => xs.filter((x) => x.trim()).map((x) => `${indent}- ${x.trim()}`).join("\n");

/** The product part: the same for every build of the project. */
export function productBrief(p: ProjectView): string {
  const pr = p.project;
  const out: string[] = [];
  out.push(`# Product: ${p.name}`);
  if (str(pr.BlocksProjectRef)) {
    out.push(`## Blocks OS project identity\nActual product project ID (SDK projectKey and CLI --project): ${str(pr.BlocksProjectRef)}.\nFactory record ID (internal references only, never a Blocks tenant): ${p.id}.\nUse the root blocks-project.json identity for the generated app. Never use the Factory tenant, a cached CLI selection, a made-up ID, or the Factory record ID for product schemas, services or deployment. Use the Blocks SDK for app calls and the Blocks CLI for admin work; explicit --account and --project are required. Cloud mutations require dry-run and approval.`);
  }
  const about = briefFactsOf(p);
  const facts = [
    p.client && `Client: ${p.client}${str(pr.ClientRegion) ? ` (${str(pr.ClientRegion)})` : ""}`,
    p.industry && `Industry: ${p.industry}`,
    about.targetUsers && `Users: ${about.targetUsers}`,
  ].filter(Boolean) as string[];
  if (facts.length) out.push(bullets(facts));
  if (about.description) out.push(`## Brief\n${about.description}`);
  const obj = p.objective();
  if (obj && (str(obj.Statement) || strs(obj.AcceptanceCriteria).length)) {
    out.push(`## Objective\n${str(obj.Statement).trim()}${strs(obj.AcceptanceCriteria).length ? `\n${bullets(strs(obj.AcceptanceCriteria))}` : ""}`);
    if (str(obj.HighLevelMd).trim()) out.push(`### High-level solution\n${str(obj.HighLevelMd).trim().slice(0, 3000)}`);
  }
  const features = p.includedFeatures();
  if (features.length) {
    const parts = features.map((f) => {
      const stories = p.storiesOf(str(f.Key)).map((s) => {
        const ac = strs(s.AcceptanceCriteria);
        return `  - ${str(s.Title)}${str(s.Text) ? `: ${str(s.Text)}` : ""}${ac.length ? `\n${bullets(ac, "    ")}` : ""}`;
      });
      return `### ${str(f.Title)}${str(f.Priority) ? ` (${str(f.Priority)})` : ""}\n${str(f.Description).trim()}${stories.length ? `\n${stories.join("\n")}` : ""}`;
    });
    out.push(`## Locked scope (version ${p.scopeVersion})\n${parts.join("\n\n")}`);
  }
  const dropped = p.features().filter((f) => f.Status === "dropped").map((f) => str(f.Title)).filter(Boolean);
  if (dropped.length) out.push(`## Not included (do not build)\n${bullets(dropped)}`);
  const reqs = p.requirements().filter((r) => r.Status !== "dropped");
  if (reqs.length) {
    out.push(`## Requirements\n${reqs.slice(0, 60).map((r) => `- ${str(r.Title)}${str(r.Priority) ? ` [${str(r.Priority)}]` : ""}${str(r.Text) ? `: ${str(r.Text).trim().slice(0, 400)}` : ""}`).join("\n")}`);
  }
  const tech = p.techDecisions().filter((t) => str(t.Choice));
  if (tech.length) out.push(`## Decisions\n${bullets(tech.slice(0, 20).map((t) => `${str(t.Title) || str(t.Area)}: ${str(t.Choice)}`))}`);
  const design = p.designBrief();
  if (design && str(design.Instructions).trim()) {
    out.push(`## Design brief\n${str(design.Instructions).trim().slice(0, 2500)}`);
    const proto = parseProductPrototype((design as { PrototypeJson?: unknown }).PrototypeJson);
    if (proto) out.push(`The look follows the client-approved ${proto.provider === "factory" ? "Factory interactive" : proto.provider === "figma-design" ? "native Figma screen" : "Figma Make"} design (revision ${proto.revision}); its full handoff is named in the ask below. Keep its layout, hierarchy and visual direction; the design does not change the requirements.`);
  }
  const sv = p.scopeVersionRow();
  const targets = sv?.SuccessTargets;
  if (targets && (typeof targets === "string" ? targets.trim() : true)) {
    const t = typeof targets === "string" ? targets : JSON.stringify(targets);
    out.push(`## Success and performance targets\n${t.slice(0, 1500)}`);
  }
  return out.join("\n\n");
}

const ticketBlock = (t: BuildTicket): string =>
  [
    `### Ticket #${t.number}: ${t.title}${t.feature ? ` (feature: ${t.feature})` : ""}`,
    t.description.trim(),
    t.acceptance.length ? `Acceptance criteria:\n${bullets(t.acceptance)}` : "",
    t.comments?.length ? `What the client wrote on this ticket (follow it; it overrides the description where they differ):\n${bullets(t.comments)}` : "",
  ]
    .filter(Boolean)
    .join("\n");

/** An analysed and approved change request (ChangeRequest.Analysis, src/domain/changeAnalysis.ts), for change.build. */
export interface ChangeBrief {
  kind: string;
  summary: string;
  /** "Features: Checkout; Screens: Cart" (the names the analysis found). */
  touches: string[];
  acceptanceCriteria: string[];
  /** The questions the analysis asked and what the person answered. */
  answers: { question: string; answer: string }[];
  risks: string[];
  conflicts: string[];
  /** A new feature on an existing product (no Factory scope), built in increments: the one this build makes. */
  feature?: FeatureBuildBrief;
}

/** One build (increment) of a feature on an existing product. */
export interface FeatureBuildBrief {
  increment: number;
  of: number;
  title: string;
  goal: string;
  /** "API", "web app", "data" */
  parts: string[];
  /** "<repo key>: <path>" from the analysis (checked against the product's file map). */
  codeAreas: string[];
  /** The increments built before this one, and those after it ("Increment 3: Title: goal"). */
  earlier: string[];
  later: string[];
}

/** The feature part of a feature build's ask: built on the existing product, this increment only (pure). */
function featureBlock(f: FeatureBuildBrief): string {
  const out: string[] = [
    `### This build: increment ${f.increment} of ${f.of}: ${f.title.trim()}${f.goal.trim() ? `\n${f.goal.trim()}` : ""}`,
    "The feature is new work built on the existing, live product: extend its code, data and screens the way they are built today; do not rebuild or restructure what is there. Build only this increment's tickets; it is deployed to dev and tried by people before the next increment starts, so it must work on its own.",
  ];
  if (f.parts.length) out.push(`It changes: ${f.parts.join(", ")}. Keep the API, the web app and the data consistent with each other, and migrate stored data so existing records keep working.`);
  if (f.codeAreas.length) out.push(`Where it lands in the code (from the analysis):\n${bullets(f.codeAreas)}`);
  if (f.earlier.length) out.push(`Built in the earlier increments (on dev already, keep working):\n${bullets(f.earlier)}`);
  if (f.later.length) out.push(`Later increments (leave room, do not build now):\n${bullets(f.later)}`);
  return out.join("\n\n");
}

/** The change part of a change build's ask: what the analysis decided, its acceptance criteria, the answers (pure). */
export function changeBlock(c: ChangeBrief): string {
  const kindLine = c.kind === "fix" ? "a fix of something that does not work as agreed"
    : c.feature ? "a new feature built on the existing product, increment by increment"
    : "a change to what the product already does";
  const out: string[] = [`## The change (analysed and approved)\n${c.summary.trim()}${c.kind ? `\nKind: ${kindLine}.` : ""}`];
  if (c.feature) out.push(featureBlock(c.feature));
  if (c.touches.length) out.push(`It touches:\n${bullets(c.touches)}`);
  if (c.acceptanceCriteria.length) {
    out.push(`### Acceptance criteria of the change\nThe change is done only when every one of these holds in the built app. Check each one before you write the .done marker of the last ticket:\n${bullets(c.acceptanceCriteria)}`);
  }
  if (c.answers.length) out.push(`### What the client decided\n${c.answers.map((a) => `- ${a.question.trim()} → ${a.answer.trim()}`).join("\n")}`);
  const care = [...c.conflicts, ...c.risks];
  if (care.length) out.push(`### Take care\n${bullets(care)}`);
  out.push(c.feature
    ? "Build only what this increment's tickets and the criteria they cover need; everything else in the app keeps working as it does now."
    : "Change only what these tickets and criteria need; everything else in the app keeps working as it does now.");
  return out.join("\n\n");
}

export interface BuildAsk {
  /** "Milestone 1: Browse and buy" or "CR-3: …". */
  label: string;
  goal: string;
  tickets: BuildTicket[];
  /** Tickets an earlier build made (the app has them). */
  built: BuildTicket[];
  /** Titles of what later milestones add (leave room, do not build). */
  later: string[];
  /** True when the app folder holds an app from an earlier build. */
  existing: boolean;
  /** True when the project-context MCP tools are there. */
  contextTools?: boolean;
  /** The project's facts as rules (engine-context/facts.ts factsRules: currency, tax, payouts, country), the same
   *  lines the design screens follow. */
  facts?: string[];
  /** The short prefix of the app's references ("DAM" for Digital Asset Market). */
  referencePrefix?: string;
  /** Today's date (YYYY-MM-DD): the data's dates lie around it. */
  today?: string;
  /** The app's files now (an earlier build's app), so the writer need not search for them. */
  files?: string[];
  /** A change build of an analysed change request: its analysis (absent for requests made before the analysis). */
  change?: ChangeBrief;
}

const RULES = `## How to work
- The folder is a Vite 8 + React 18 + TypeScript + Tailwind CSS 3 app. src/main.tsx already wraps <App /> in a HashRouter; keep it.
- You cannot run commands. The packages are installed and the production build ("vite build") runs after you finish, so write code that compiles first time: every import must exist, every file you import must be written, named exports must match.
- Only these packages exist: react, react-dom, react-router-dom (v7: Routes, Route, Link, NavLink, useParams, useNavigate, useSearchParams), lucide-react (icons: import { Search, ShoppingCart, ... } from "lucide-react"; use common icon names only). Import nothing else from npm.
- Do not edit package.json, vite.config.js or postcss.config.js. You may edit index.html (title, fonts), tailwind.config.js (theme) and anything in src/.
- A static app: no server, no API keys, no network calls for data. Keep the records in src/data/*.json (rich and realistic: real-sounding names, prices, dates, numbers that add up). Keep what people do (cart, orders, uploads, settings) in React state with localStorage, every localStorage call inside try/catch.
- Browser storage: every app and every version runs on the same address, so keys must never collide. Use only getItem / setItem / removeItem of localStorage or sessionStorage (never property access such as localStorage.cart or localStorage["cart"], never cookies or IndexedDB for app data); the app's frame (vite.config.js) scopes every key to this app and version for you, so use short plain keys ("cart", "session").
- Images: ship no image files. Draw previews and illustrations in code (SVG or CSS: gradients, shapes, type specimens, icon grids, layout thumbnails), different per item and per category. Photographs may use https://picsum.photos/seed/<item-id>/<width>/<height> with an onError fallback to a drawn gradient.
- Drawn SVG must be valid for every item: a hash or seed used for variety is unsigned (hash >>> 0, or Math.abs), and every computed width, height, r, rx and ry is clamped with Math.max(0, ...) and never NaN; charts with no data draw nothing instead of negative bars. The console must stay free of errors.
- Keep the icon link and every reference in index.html pointing at files that exist (no /favicon.ico, no /vite.svg, no images that are not in the build).
- Wording: real product copy for the client's customers, in plain words. Never show the words demo, mock, sample, test, lorem, placeholder, dummy, fake or example anywhere in the interface, and no developer notes.
- Design: a professional, modern, production-quality product. A clear type scale (font-display for headings), generous whitespace, a restrained palette with one confident accent colour, soft shadows and rounded cards, crisp hover and focus states, skeleton-free instant screens. Responsive from 360 px phones to 1440 px desktops (no horizontal scroll), accessible (labels, alt text, focus rings, keyboard navigation, sufficient contrast). Every list has an empty state, every form validates with clear messages, every action gives feedback (toast or inline).
- Code: small files (one component or page per file under src/components and src/pages, data under src/data, state and helpers under src/lib), typed props, no unused code.
- Work in few turns: read the files you need together in one reply; when you know several files, write them in one reply (several Write calls); change a file you already wrote with Edit (a small change), never by writing the whole file again.`;

const MARKERS = `## Progress markers (required: the client watches the board move live)
The client's board moves only when you write these marker files, so write them as you go, one ticket at a time, never several at once and never all at the end:
1. Immediately before the FIRST file of a ticket, write .madp/progress/<ticket number>.start containing one line: what you are about to build.
2. Immediately after the LAST file of that ticket, and before you touch the next ticket, write .madp/progress/<ticket number>.done containing one plain sentence: what you built (no file names needed).
3. Then the next ticket: its .start, its files, its .done. Work through the tickets in the order listed.
Shared groundwork (layout, data, state, types) belongs to the first ticket that needs it and is written between that ticket's .start and .done; keep it small, and write each ticket's own pages and components inside its own .start and .done. Name pages and components after what they show (BrowsePage.tsx, OrderHistory.tsx).
When every ticket is done, write README.md as the user guide of the whole app as it is now: one paragraph on what the product is and who it is for, then one section per feature built so far (in this build and the earlier ones), each saying what it does and how to use it. Describe the app, not the work: never "this build", "this release adds", "milestone" or "ticket". Then reply with one line: DONE.`;

/** What the starter holds (starter.ts), so a new app's writer starts writing without reading it first. */
const STARTER_MAP = `## The starter (you know it from this list; no need to read it)
- index.html: the title, the icon and the Inter and Plus Jakarta Sans fonts.
- tailwind.config.js: font-sans is Inter, font-display is Plus Jakarta Sans; content covers index.html and src/**/*.{ts,tsx}.
- src/main.tsx: renders <App /> inside <StrictMode> and <HashRouter>, and imports ./index.css.
- src/index.css: the Tailwind layers and a white body with slate-900 text.
- src/App.tsx: a one-line page with the product's name: replace it with the app.
- README.md: the product's name only.`;

/** The initials of a name, for references ("Digital Asset Market" -> "DAM"); 2 to 4 letters. */
export function referencePrefixOf(name: string): string {
  const words = name.normalize("NFKD").replace(/[^A-Za-z0-9 ]+/g, " ").split(/\s+/).filter(Boolean);
  const initials = words.map((w) => w[0]!.toUpperCase()).join("").slice(0, 4);
  if (initials.length >= 2) return initials;
  return (words[0] ?? "APP").slice(0, 3).toUpperCase();
}

/** The facts every screen, record and text of the app agrees on (the same the design screens follow). */
function factsBlock(p: ProjectView, ask: BuildAsk): string {
  const prefix = ask.referencePrefix || referencePrefixOf(p.name);
  const lines = [
    ...(ask.facts ?? []),
    `- References (orders, invoices, payouts, licences): "${prefix}-" and a number (${prefix}-10428), the same pattern everywhere; never a country code such as "CH-" or "DE-" unless the country above says so.`,
    ask.today ? `- Today is ${ask.today}. Past records (orders, payouts, reviews) are dated before today, scheduled ones (the next payout) after it, and every date follows the rules above.` : "",
    "- Keep these facts in one module (src/lib/facts.ts: currency, tax, payout schedule, reference prefix) and take every price, tax line, payout date and reference from it, so screens, data, e-mails and the README never disagree.",
  ].filter(Boolean);
  return `## Facts of this product (the client's answers first, then the client's material; the same in every screen, record, e-mail and the README)\n${lines.join("\n")}`;
}

/** The full ask for a build. */
export function buildPrompt(p: ProjectView, ask: BuildAsk): string {
  const out: string[] = [];
  out.push(
    ask.existing
      ? `You are the development team extending the web app "${p.name}" in this folder. Read src/App.tsx and the files you change before you edit them; keep everything that works.`
      : `You are the development team writing the web app "${p.name}" in this folder, from the starter that is here.`,
  );
  out.push(RULES);
  if (!ask.existing) out.push(STARTER_MAP);
  else if (ask.files?.length) out.push(`## The app's files now (read the ones you need; no need to search for them)\n${ask.files.slice(0, 200).join("\n")}`);
  out.push(factsBlock(p, ask));
  if (ask.contextTools) {
    out.push("## Project context\nThe project-context tools (get_requirements, get_scope, get_tickets, trace and the brief tools) answer the full, current records of this project. Call them when you need more detail than this brief (exact wording of a requirement, a story's acceptance criteria, an answer the client gave). They only read.");
  }
  out.push(MARKERS);
  out.push(`# This build: ${ask.label}${ask.goal ? `\nGoal: ${ask.goal}` : ""}\n\n${ask.tickets.map(ticketBlock).join("\n\n")}`);
  if (ask.change) out.push(changeBlock(ask.change));
  if (ask.built.length) out.push(`## Already built (keep working)\n${bullets(ask.built.map((t) => `#${t.number} ${t.title}`))}`);
  if (ask.later.length) out.push(`## Later builds (do not build yet; leave room in the navigation and layout)\n${bullets(ask.later)}`);
  out.push(productBrief(p));
  return out.join("\n\n");
}

/** The ask after a failed production build: fix the code, nothing else. */
export function repairPrompt(errors: string): string {
  return [
    "The production build of this Vite + React + TypeScript app failed. Fix the code so the build passes. Change only what the errors need; keep the features, design and wording as they are.",
    "Only react, react-dom, react-router-dom and lucide-react exist; replace any other import. Do not edit package.json, vite.config.js or postcss.config.js. You cannot run commands.",
    "When the fix is written, reply with one line: FIXED.",
    "## Build output",
    "```",
    errors.slice(-6000),
    "```",
  ].join("\n\n");
}
