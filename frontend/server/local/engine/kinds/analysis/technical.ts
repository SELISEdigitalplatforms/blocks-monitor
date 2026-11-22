// sanitization.assist, focus "technical": proposed technical decisions for the areas nobody has decided yet: the
// stack, integrations, the main quality target, hosting, security and data. For an existing product the proposals
// are the findings of reading its repository together with the notes: extend what is there instead of rebuilding.
import type { Row } from "../../../../../functions/_lib/gateway";
import type { JobRun } from "../../run.ts";
import { str } from "../../context.ts";
import { cap, clip, hashOf, listOf, sentence } from "../../text.ts";
import { actorLabel, mainActor, readFacts, type Facts } from "./facts.ts";
import { thingsIn } from "./grammar.ts";
import { before } from "./own.ts";
import { productNounOf } from "./topics.ts";

export type Area = "stack" | "architecture" | "integration" | "nfr" | "security" | "data" | "hosting" | "other";

export interface PlannedTech {
  local: string;
  Area: Area;
  Title: string;
  Choice: string;
  Rationale: string;
  Alternatives: string[];
  NfrCategory: string;
  NfrTarget: string;
  IntegrationSystem: string;
}

const lineWith = (f: Facts, re: RegExp): string | null => f.lines.find((l) => re.test(l.text))?.text ?? null;

function proposal(p: Omit<PlannedTech, "NfrCategory" | "NfrTarget" | "IntegrationSystem"> & Partial<PlannedTech>): PlannedTech {
  return {
    NfrCategory: "",
    NfrTarget: "",
    IntegrationSystem: "",
    ...p,
    Title: clip(p.Title, 200),
    Choice: clip(p.Choice, 500),
    Rationale: clip(p.Rationale, 2000),
  };
}

function backEnd(stack: string[]): string | null {
  return stack.find((s) => /laravel|spring|\.net|django|rails|node|java/i.test(s)) ?? stack.find((s) => /php/i.test(s)) ?? null;
}
function frontEnd(stack: string[]): string | null {
  return stack.find((s) => /angular|react|vue|blade|jquery/i.test(s)) ?? null;
}
function database(stack: string[]): string | null {
  return stack.find((s) => /mysql|postgres|sql server|oracle|mongo/i.test(s)) ?? null;
}

/** Every proposal the project's facts support, best first per area. */
export function techCandidates(run: JobRun, facts: Facts): PlannedTech[] {
  const p = run.p;
  const out: PlannedTech[] = [];
  const actor = actorLabel(mainActor(facts).name);
  const things = thingsIn(facts.all, 2);
  const mobile = /\b(phone|mobile|app|tablet|on the road|at the customer|driver|technician|camera)\b/i.test(`${p.name} ${facts.all}`);
  const noun = productNounOf(p.name, p.brief);
  const repo = p.repo;
  const repoLabel = repo.owner && repo.name ? `${repo.owner}/${repo.name}` : repo.name || "the existing repository";

  // Stack.
  if (p.existingProduct) {
    const be = backEnd(facts.stack);
    const fe = frontEnd(facts.stack);
    const db = database(facts.stack);
    const found = facts.stack.length ? `${listOf(facts.stack)}` : "";
    out.push(
      proposal({
        local: "t-stack",
        Area: "stack",
        Title: be ? `Extend the existing ${be} application` : `Extend the existing application in ${repoLabel}`,
        Choice: be
          ? `Keep the ${be} back end${db ? ` and the ${db} data` : ""}; build the new ${mobile ? "mobile-first screens" : "screens"} on top of it${fe ? ` and replace the ${fe} pages step by step` : ""}, with an API where the new front end needs one`
          : `Keep the code base on ${repo.branch} and add the new functions as modules of it, behind the existing sign-in`,
        Rationale: `Read ${repoLabel} (${repo.branch})${found ? `: ${found}` : ""}. The code is in use and maintained, so extending it keeps logins, data and deployments as they are and is a smaller step than a rebuild.`,
        Alternatives: ["Rebuild on SELISE Blocks and migrate the data", be ? `Modernise only the ${fe ?? "existing"} pages and leave the rest` : "Replace the application with a standard product"],
      }),
    );
  } else {
    out.push(
      proposal({
        local: "t-stack",
        Area: "stack",
        Title: mobile ? "Installable web app on SELISE Blocks" : `Web ${noun === "webshop" ? "shop" : "portal"} on SELISE Blocks`,
        Choice: mobile
          ? "Installable web app (PWA) on SELISE Blocks: one code base for phones and desktop, IAM sign-in, Data Gateway and Storage"
          : `React web ${noun === "webshop" ? "shop" : "portal"} on SELISE Blocks: IAM sign-in, Data Gateway with row-level access, Storage for files and Mail for notifications`,
        Rationale: mobile
          ? `${cap(actor)} work on the phone; an installable web app needs no app store and serves the office screens from the same code.`
          : `${cap(actor)} and the internal team use it in the browser; the platform covers sign-in, access per company, files and e-mail, so the work goes into the ${noun} itself.`,
        Alternatives: mobile ? ["Native iOS and Android apps", "A form tool on the phone"] : ["A standard product with customising", "Low-code forms on SharePoint"],
      }),
    );
  }

  // Integrations: one per system the notes name.
  for (const sys of facts.systems.filter((s) => !/gitlab/i.test(s)).slice(0, 2)) {
    const line = lineWith(facts, new RegExp(sys.replace(/[/]/g, "\\/"), "i"));
    const noApi = /\bno api\b|by hand|filled by hand/i.test(line ?? facts.all);
    const isSign = /signature/i.test(sys);
    out.push(
      proposal({
        local: `t-int-${out.length}`,
        Area: "integration",
        Title: isSign ? "E-signature through the existing provider" : `Connection to ${/^(erp|crm)$/i.test(sys) ? `the ${sys}` : sys}`,
        Choice: isSign
          ? "Use the existing Swiss e-signature provider through its API; signed documents come back into the file store"
          : noApi
            ? `Scheduled CSV export to ${/^(erp|crm)$/i.test(sys) ? `the ${sys}` : sys} in the first phase; a live interface once ${/^(erp|crm)$/i.test(sys) ? "it" : sys} offers one`
            : `REST interface to ${/^(erp|crm)$/i.test(sys) ? `the ${sys}` : sys} for ${things.length ? listOf(things) : "the shared records"}, called when a record changes`,
        Rationale: line ? sentence(line) : `${sys} holds data the ${noun} needs; entering it twice is what the project is meant to end.`,
        Alternatives: isSign ? ["A new provider", "Print, sign and scan"] : noApi ? ["Live interface from the start", "Manual entry in the first phase"] : ["Nightly file export", "Manual entry in the first phase"],
        IntegrationSystem: isSign ? "Swiss e-signature provider (existing contract)" : sys,
      }),
    );
  }

  // The main quality target.
  const sizeMb = /\b(\d{1,3})\s*MB\b/i.exec(facts.all)?.[1];
  const peak = lineWith(facts, /\bpeak\b/i);
  const counted = facts.actors.find((a) => a.count);
  if (/\bupload|photo|camera\b/i.test(facts.all)) {
    out.push(
      proposal({
        local: "t-nfr",
        Area: "nfr",
        Title: "Uploads from the phone",
        Choice: `Resize photos on the phone and upload in chunks${sizeMb ? `, files up to ${Math.max(20, Number(sizeMb) * 4)} MB` : ", files up to 20 MB"}`,
        Rationale: sizeMb ? `Uploads above ${sizeMb} MB fail today; phone photos are often larger.` : "Phone photos are large and mobile connections drop; chunked uploads resume instead of starting again.",
        Alternatives: ["Raise the server limit only", "Upload only from the desktop"],
        NfrCategory: "performance",
        NfrTarget: `A ${sizeMb ? Math.max(20, Number(sizeMb) * 4) : 20} MB upload succeeds on a 4G phone within 30 seconds`,
      }),
    );
  } else if (/\boffline|reception|cellar|basement|plant room/i.test(facts.all)) {
    out.push(
      proposal({
        local: "t-nfr",
        Area: "nfr",
        Title: "Working without reception",
        Choice: "Offline queue on the device: entries are stored locally and sent in order once the connection is back",
        Rationale: sentence(lineWith(facts, /offline|reception|cellar|basement|plant room/i) ?? "Work happens where the mobile network is weak"),
        Alternatives: ["Online only, with a retry button", "Paper fallback"],
        NfrCategory: "availability",
        NfrTarget: "A full day of entries is kept without reception and sent within 5 minutes of reconnecting",
      }),
    );
  } else if (counted || peak) {
    out.push(
      proposal({
        local: "t-nfr",
        Area: "nfr",
        Title: "Response times at peak",
        Choice: "Lists are paged and filtered on the server; files are served from Storage, not through the application",
        Rationale: peak ? sentence(peak) : `About ${counted!.count} ${actorLabel(counted!.name)} use it, many at the same times of day.`,
        Alternatives: ["Load everything in the browser"],
        NfrCategory: "performance",
        NfrTarget: `Pages answer within 2 seconds with ${counted ? `${counted.count} ${actorLabel(counted.name)}` : "all users"} active${peak ? " in the peak season" : ""}`,
      }),
    );
  }

  // Security.
  const login = lineWith(facts, /\b(login|log in|sign in|account|password|link per)\b/i);
  const bank = lineWith(facts, /\bbank details|iban\b/i);
  if (bank) {
    out.push(
      proposal({
        local: "t-security",
        Area: "security",
        Title: "Four-eyes check of bank details",
        Choice: "New or changed bank details take effect only after a second person approves them; every change is logged",
        Rationale: sentence(bank),
        Alternatives: ["Call-back only, recorded by hand"],
      }),
    );
  } else if (p.existingProduct && login) {
    out.push(
      proposal({
        local: "t-security",
        Area: "security",
        Title: "Reuse the existing accounts",
        Choice: `Keep the user accounts and sign-in of ${repoLabel}; the new screens use the same session`,
        Rationale: sentence(login),
        Alternatives: ["New accounts with an invitation to every user"],
      }),
    );
  } else {
    const external = /\b(suppliers|clients|customers|partners|dealers|employees)\b/i.exec(facts.all)?.[1];
    out.push(
      proposal({
        local: "t-security",
        Area: "security",
        Title: external ? `Sign-in for ${external.toLowerCase()}` : "Sign-in and roles",
        Choice: external
          ? `Own accounts for ${external.toLowerCase()} with e-mail, password and a one-time code; staff sign in with the company's single sign-on`
          : "IAM sign-in with roles per workspace; administrators get a second factor",
        Rationale: login
          ? /\?$/.test(login.trim())
            ? `The notes leave it open: "${cap(login.trim())}" Own accounts make every upload traceable to a person, which an audit asks for, and cannot be forwarded like a link.`
            : sentence(login)
          : "External users need their own accounts; staff should not manage another password.",
        Alternatives: ["A personal link per request, without an account", "Shared logins per company"],
      }),
    );
  }

  // Hosting.
  const hostedAt = facts.lines.map((l) => /\bhosted (?:at|in|by) [^,.;)\n]+/i.exec(l.text)?.[0]).find(Boolean) ?? null;
  const ownDc = /\b(own|our) data cent(?:re|er)\b/i.test(facts.all);
  const swiss = lineWith(facts, /\b(data must stay|secrecy|stay in switzerland)\b/i) ?? lineWith(facts, /\bswitzerland\b/i);
  const keepHosting = p.existingProduct && (hostedAt || ownDc);
  out.push(
    proposal({
      local: "t-hosting",
      Area: "hosting",
      Title: keepHosting ? "Stay in the current hosting" : "Hosting in Switzerland",
      Choice: keepHosting
        ? `Run the new parts next to the existing ${noun}${hostedAt ? `, ${hostedAt.replace(/^hosted/i, "hosted").trim()}` : " in the own data centre"}; no second hosting`
        : "SELISE Blocks in a Swiss data centre (Zurich region), backups in Switzerland",
      Rationale: swiss ? sentence(swiss) : keepHosting ? "Operations, backups and access rules stay as they are today." : "Business and personal data stay in Switzerland under the revised Data Protection Act (nFADP).",
      Alternatives: p.existingProduct ? ["Move everything to a Swiss cloud region"] : ["EU cloud region", "The client's own data centre"],
    }),
  );

  // Data.
  if (p.existingProduct) {
    out.push(
      proposal({
        local: "t-data",
        Area: "data",
        Title: "No migration in the first phase",
        Choice: "The new parts read and write the existing database; tables are added, none are changed or moved",
        Rationale: sentence(lineWith(facts, /\b(tables?|database|data model|migrat\w*)\b/i) ?? "The existing data stays the single source"),
        Alternatives: ["Migrate into a new data model first"],
      }),
    );
  } else if (/\b(certificate|audit|history|version|log)\w*/i.test(facts.all)) {
    out.push(
      proposal({
        local: "t-data",
        Area: "data",
        Title: "Full history of documents",
        Choice: `Keep every version of ${things.length ? listOf(things) : "each document"} with who uploaded it and when; nothing is overwritten`,
        Rationale: sentence(lineWith(facts, /\baudit\b/i) ?? "Audits ask what was valid at a given date"),
        Alternatives: ["Keep only the current version"],
      }),
    );
  }
  return out;
}

/** The proposals to write: areas nobody decided yet, 2 to 4 of them. */
export function planTech(run: JobRun, o?: { area?: string; max?: number }): PlannedTech[] {
  const refs = (run.input.refs ?? undefined) as { docNoteIds?: unknown; docFileIds?: unknown } | undefined;
  const facts = readFacts(run.p, refs);
  const decided = new Set(before(run, "TechDecision").filter((t: Row) => t.Status !== "rejected").map((t: Row) => str(t.Area)));
  const all = techCandidates(run, facts);
  const fresh = all.filter((t) => !decided.has(t.Area) && (!o?.area || t.Area === o.area));
  // Integrations of a system nobody has decided yet still count when another integration exists.
  const integrationsLeft = all.filter(
    (t) => t.Area === "integration" && decided.has("integration") && !before(run, "TechDecision").some((d) => str(d.IntegrationSystem).toLowerCase().includes(t.IntegrationSystem.toLowerCase().split(" ")[0]!)),
  );
  const pool = [...fresh, ...(o?.area ? [] : integrationsLeft.filter((t) => !fresh.includes(t)))];
  const max = o?.max ?? (pool.length >= 4 && hashOf(`tech:${run.id}`) % 2 === 0 ? 4 : 3);
  // Keep one proposal per area where possible.
  const picked: PlannedTech[] = [];
  for (const t of pool) if (picked.length < max && !picked.some((x) => x.Area === t.Area)) picked.push(t);
  for (const t of pool) if (picked.length < Math.min(max, 2) && !picked.includes(t)) picked.push(t);
  return picked;
}
