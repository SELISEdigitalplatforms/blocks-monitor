// Everything the MADP engine produced for ONE project, organised the way the official MADP engine lays out a project
// (engine/selise-madp/MADP-FULL-FLOW.md, MADP/schemas/all-artifacts.md) and indexed for people:
//
//   <project folder>/artifacts/
//     README.md, index.html        the index: the project, its state and every output with one line (index.html opens
//                                  offline in a browser); outputs.json is the same list for the app's "What MADP produced"
//     requirements/BRD.md, PRD.md  the requirement phase (R1 BRD, R2 PRD) from the project's own records; QUESTIONS.md
//     REQ-<PID>-v<n>.yaml          01-planner: requirements, scope, module map (milestones -> features -> tickets)
//     plan/PLAN.md                 the work plan: milestones and their tickets, as the planner wrote them
//     design/                      the screen designs of each design job (HTML, rendered from the job's design.json)
//     figma-screens/<job>/, design-ref/<job>/   a design job's own files; its design-brief.md (the business analyst's
//                                  brief for the designer, with the chosen style direction) is listed as "Design brief"
//     specs/<MOD>-<slug>/          one module per milestone (M01…) or change (CR…): its spec and, per build, the agents'
//                                  artifacts CODE (02-dev) REVIEW (03-review) TEST (04-test) SEC (05-secops) DOCS (06-docs)
//                                  from the gates' real results (jobs/<id>/gates.json; older builds: build.json)
//     RELEASE-<ENV>-<PID>-<ver>.yaml  07-release: the environment gate (OPEN / HOLD) with its smoke tests
//     docs/                        the app's user guide and release notes as on main, the business overview
//     TRACE-<PID>.md / .json       requirement -> feature -> story -> ticket -> commit -> build -> release
//     PIPELINE-SUMMARY.md, runs/RUNS.md   every engine job of the project (agent, status, result, its folder)
//     memory/ context.md decisions.md gaps.md risks.md     knowledge/ dependencies.md risks.md tech-debt.md
//
// Reads only this project's folder (project.json, artifacts/brief/context.json + ledger.jsonl, jobs/, the repository's
// main branch) and writes only under its artifacts/: the files it writes are its own (listed in outputs.json) and are
// rewritten each time; nothing else is moved or removed. Pure of the Data Gateway, so the same code runs after every job
// (hooks.ts) and over existing folders (scripts/engine-outputs.ts). Never invents a result: a check that did not run
// says so.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { plainFailureMessage } from "../../src/domain/jobMessage";
import { readReport, reportMarkdown } from "../local/engine/official/onboarding.ts";

type J = Record<string, unknown>;
const str = (v: unknown): string => (typeof v === "string" ? v : typeof v === "number" ? String(v) : "");
const num = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : 0);
const arr = (v: unknown): J[] => (Array.isArray(v) ? (v.filter((x) => x && typeof x === "object") as J[]) : []);
const strs = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);
const obj = (v: unknown): J => (v && typeof v === "object" && !Array.isArray(v) ? (v as J) : {});

function readJson(file: string): J | null {
  try {
    const v = JSON.parse(fs.readFileSync(file, "utf8")) as unknown;
    return v && typeof v === "object" ? (v as J) : null;
  } catch {
    return null;
  }
}
function readText(file: string): string {
  try {
    return fs.readFileSync(file, "utf8");
  } catch {
    return "";
  }
}

// ------------------------------------------------------------------------------------------------- YAML

const PLAIN = /^[A-Za-z0-9][A-Za-z0-9 ._/@()+,-]*$/;
const RESERVED = /^(true|false|yes|no|on|off|null|~|y|n)$/i;
function scalar(v: unknown): string {
  if (v === null || v === undefined) return "null";
  if (typeof v === "number") return Number.isFinite(v) ? String(v) : "null";
  if (typeof v === "boolean") return v ? "true" : "false";
  const s = String(v);
  return PLAIN.test(s) && !RESERVED.test(s) && !/^[\d.]+$/.test(s) && !s.endsWith(" ") && !/: | #/.test(s) ? s : JSON.stringify(s);
}
/** A ticket's stored EstimateHours in its unit: the real estimates are the build time a ticket adds on MADP, a fraction
 *  of an hour (src/domain/engineEstimate.ts), so under an hour it reads in minutes; none reads "—". */
export function estimateCell(hours: number): string {
  if (!(hours > 0)) return "—";
  return hours < 1 ? `${Math.max(1, Math.round(hours * 60))} min` : `${Math.round(hours * 10) / 10} h`;
}

/** A small YAML writer (block style; strings JSON-quoted when they need it, which YAML reads as double-quoted). */
export function toYaml(v: unknown, indent = 0): string {
  const pad = " ".repeat(indent);
  if (Array.isArray(v)) {
    if (v.length === 0) return `${pad}[]\n`;
    return v
      .map((x) => {
        if (x && typeof x === "object" && !Array.isArray(x) && Object.keys(x).length) {
          const body = toYaml(x, indent + 2).slice(indent + 2);
          return `${pad}- ${body}`;
        }
        if (Array.isArray(x) && x.length) return `${pad}-\n${toYaml(x, indent + 2)}`;
        return `${pad}- ${Array.isArray(x) ? "[]" : x && typeof x === "object" ? "{}" : scalar(x)}\n`;
      })
      .join("");
  }
  if (v && typeof v === "object") {
    const entries = Object.entries(v as J).filter(([, x]) => x !== undefined);
    if (entries.length === 0) return `${pad}{}\n`;
    return entries
      .map(([k, x]) => {
        const key = PLAIN.test(k) ? k : JSON.stringify(k);
        if (Array.isArray(x)) return x.length ? `${pad}${key}:\n${toYaml(x, indent + 2)}` : `${pad}${key}: []\n`;
        if (x && typeof x === "object") return Object.keys(x).length ? `${pad}${key}:\n${toYaml(x, indent + 2)}` : `${pad}${key}: {}\n`;
        return `${pad}${key}: ${scalar(x)}\n`;
      })
      .join("");
  }
  return `${pad}${scalar(v)}\n`;
}

// ------------------------------------------------------------------------------------------------- the manifest

export type OutputKind = "md" | "yaml" | "json" | "html" | "png" | "log" | "txt";
export interface OutputItem {
  path: string;
  title: string;
  summary: string;
  kind: OutputKind;
  bytes: number;
  updatedAt: string;
  status?: "pass" | "fail" | "hold" | "open" | "info";
  group?: string;
}
export interface OutputSection {
  id: string;
  title: string;
  summary: string;
  items: OutputItem[];
}
export interface OutputsManifest {
  schema: "madp-outputs/1";
  projectId: string;
  workspaceId: string;
  name: string;
  /** The project id the official engine's file names use (REQ-<PID>-v1.yaml). */
  pid: string;
  generatedAt: string;
  summary: string;
  facts: { label: string; value: string }[];
  sections: OutputSection[];
  /** Every file this generator wrote (relative to artifacts/). */
  generated: string[];
}

const KIND: Record<string, OutputKind> = { ".md": "md", ".yaml": "yaml", ".yml": "yaml", ".json": "json", ".jsonl": "json", ".html": "html", ".png": "png", ".log": "log", ".txt": "txt" };
export const kindOf = (file: string): OutputKind => KIND[path.extname(file).toLowerCase()] ?? "txt";

// ------------------------------------------------------------------------------------------------- helpers

const slug = (s: string, max = 40): string =>
  s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, max)
    .replace(/-+$/g, "");
/** The project id of the engine's file names: the project's name in capitals (REQ-DIGITAL-ASSET-MARKET-v1.yaml). */
export const pidOf = (name: string, projectId: string): string => (slug(name, 40).toUpperCase() || projectId.slice(0, 8).toUpperCase());
const day = (iso: string): string => (iso ? iso.replace("T", " ").slice(0, 16) + " UTC" : "");
const ENV_NAME: Record<string, string> = { dev: "DEV", stage: "STAGING", staging: "STAGING", production: "PROD", prod: "PROD", qa: "QA", uat: "UAT" };
const ENV_LABEL: Record<string, string> = { dev: "development", stage: "staging", production: "production" };

/** Which official MADP role a Factory job kind plays. */
const ROLE: Record<string, string> = {
  "setup.assist": "Business analyst (project setup)",
  "sanitization.assist": "Business analyst (questions, R1 BRD input)",
  "requirements.draft": "Requirement generator (R1 BRD / R2 PRD)",
  "scope.draft": "Requirement generator (R2 PRD: features and stories)",
  "milestones.suggest": "Requirement generator (R2 PRD: implementation slices)",
  "scope.grill": "Second opinion on the scope",
  "scope.success": "Success targets",
  "design.generate": "Designer (screens)",
  "board.plan": "01 Planner",
  "build.run": "02 Dev, 03 Review, 04 Test, 05 SecOps (build gates)",
  "change.build": "02 Dev … 05 SecOps for a change request",
  "preview.deploy": "07 Release (environment gate)",
  "change.analyse": "Change request analysis",
  "chat.reply": "Agent chat",
  "fix.analyse": "Fix analysis",
  "wiki.generate": "Docs (project wiki)",
  "feedback.apply": "Feedback",
};

interface Job {
  dir: string;
  folder: string;
  jobId: string;
  attempt: number;
  kind: string;
  startedAt: string;
  status: string;
  message: string;
  finishedAt: string;
  input: J;
}

function jobsOf(projectDir: string): Job[] {
  const base = path.join(projectDir, "jobs");
  let names: string[] = [];
  try {
    names = fs.readdirSync(base);
  } catch {
    return [];
  }
  const out: Job[] = [];
  for (const n of names) {
    const dir = path.join(base, n);
    const j = readJson(path.join(dir, "job.json"));
    if (!j) continue;
    const r = readJson(path.join(dir, "result.json")) ?? {};
    const stopped = fs.existsSync(path.join(dir, "stopped.json"));
    // people read the job's plain line (result.json "message"); an older failed result has only the raw error
    const raw = str(r.error).split("\n")[0]!.replace(/^(?:JobFailure|BuildFailed): /, "");
    out.push({
      dir, folder: n, jobId: str(j.jobId), attempt: num(j.attempt) || 1, kind: str(j.kind), startedAt: str(j.startedAt), input: obj(j.input),
      status: str(r.status) || (stopped ? "stopped" : "running or not recorded"), message: str(r.message) || (raw ? plainFailureMessage(str(j.kind), raw) : ""), finishedAt: str(r.finishedAt),
    });
  }
  return out.sort((a, b) => a.startedAt.localeCompare(b.startedAt));
}

function git(repo: string, args: string[]): string {
  try {
    return execFileSync("git", args, { cwd: repo, stdio: ["ignore", "pipe", "ignore"], timeout: 15_000, maxBuffer: 16 * 1024 * 1024 }).toString("utf8");
  } catch {
    return "";
  }
}

// ------------------------------------------------------------------------------------------------- the writer

interface Writer {
  write(rel: string, body: string | Buffer): void;
  copy(fromAbs: string, rel: string, maxBytes?: number): boolean;
  written: string[];
}

function writerAt(artifacts: string): Writer {
  const written: string[] = [];
  const safe = (rel: string): string => {
    const abs = path.resolve(artifacts, rel);
    if (!abs.startsWith(path.resolve(artifacts) + path.sep)) throw new Error("an output path left the artifacts folder");
    return abs;
  };
  return {
    written,
    write(rel, body) {
      const abs = safe(rel);
      fs.mkdirSync(path.dirname(abs), { recursive: true });
      let same = false;
      try {
        same = fs.readFileSync(abs).equals(Buffer.isBuffer(body) ? body : Buffer.from(body));
      } catch {
        same = false;
      }
      if (!same) {
        const tmp = `${abs}.${process.pid}.tmp`;
        fs.writeFileSync(tmp, body);
        fs.renameSync(tmp, abs);
      }
      written.push(rel);
    },
    copy(fromAbs, rel, maxBytes = 2 * 1024 * 1024) {
      try {
        const st = fs.statSync(fromAbs);
        if (!st.isFile() || st.size > maxBytes) return false;
        this.write(rel, fs.readFileSync(fromAbs));
        return true;
      } catch {
        return false;
      }
    },
  };
}

// ------------------------------------------------------------------------------------------------- design briefs

/** The design brief of each screen design job (kinds/scope/designerBrief.ts writes design-brief.md and the chosen style
 *  direction, design-style.json, into the job's folder under artifacts/), oldest first. */
function designBriefsOf(artifacts: string): { rel: string; summary: string }[] {
  const out: { rel: string; summary: string; at: number }[] = [];
  for (const kind of ["figma-screens", "design-ref"]) {
    let jobs: string[] = [];
    try {
      jobs = fs.readdirSync(path.join(artifacts, kind));
    } catch {
      continue;
    }
    for (const job of jobs) {
      if (!/^[A-Za-z0-9_-]{1,128}$/.test(job)) continue;
      const rel = `${kind}/${job}/design-brief.md`;
      let st: fs.Stats;
      try {
        st = fs.statSync(path.join(artifacts, rel));
      } catch {
        continue;
      }
      if (!st.isFile()) continue;
      const style = str(readJson(path.join(artifacts, kind, job, "design-style.json"))?.styleName);
      out.push({ rel, at: st.mtimeMs, summary: `What the business analyst gave the designer: the product, its users, every requirement and the style direction${style ? ` (${style})` : ""}.` });
    }
  }
  return out.sort((a, b) => a.at - b.at).map(({ rel, summary }) => ({ rel, summary }));
}

// ------------------------------------------------------------------------------------------------- gates

interface Gate {
  checks: { id: string; title: string; result: string; detail: string; log?: string }[];
  findings: { severity: string; file?: string; what: string }[];
  notChecked: string[];
}
interface Gates {
  status: string;
  failure?: { code: string; message: string };
  commit?: string;
  base?: string;
  changes?: { files: number; insertions: number; deletions: number; list: { file: string; added: number; removed: number }[] };
  review?: Gate;
  test?: Gate;
  security?: Gate;
  docs?: Gate;
  reconstructed?: boolean;
  finishedAt?: string;
}

/** The gates of one build job: its gates.json, else (a build made before gates.json) what build.json recorded. */
function gatesOf(job: Job, repo: string): Gates | null {
  const g = readJson(path.join(job.dir, "gates.json"));
  if (g) return g as unknown as Gates;
  const b = readJson(path.join(job.dir, "build.json"));
  if (!b) return job.status === "failed" ? { status: "failed", failure: { code: "build.failed", message: job.message }, reconstructed: true } : null;
  const wording = arr(b.wording);
  const security = strs(b.security);
  const commit = str(b.commit);
  const pkg = commit ? git(repo, ["show", `${commit}:package.json`]) : "";
  const hasTests = /"test"\s*:/.test(pkg);
  const files = num(b.files);
  const older = "Not run: this build was made before the dependency audit was added to the Factory's security gate (31.10).";
  let changes: Gates["changes"];
  const parent = commit ? git(repo, ["rev-parse", `${commit}^1`]).trim() : "";
  if (parent) {
    const list = git(repo, ["diff", "--numstat", parent, commit])
      .split("\n")
      .filter(Boolean)
      .map((l) => l.split("\t"))
      .map(([a, r, f]) => ({ file: f ?? "", added: Number(a) || 0, removed: Number(r) || 0 }))
      .filter((x) => x.file && !x.file.startsWith(".madp/"));
    changes = { files: list.length, insertions: list.reduce((n, x) => n + x.added, 0), deletions: list.reduce((n, x) => n + x.removed, 0), list: list.slice(0, 400) };
  }
  return {
    status: b.ok === false ? "failed" : "passed",
    commit,
    ...(parent ? { base: parent } : {}),
    ...(changes ? { changes } : {}),
    reconstructed: true,
    finishedAt: job.finishedAt,
    review: {
      checks: [
        { id: "source-files", title: "Source files in place", result: files > 0 ? "PASS" : "FAIL", detail: `${files} source files of the app reviewed.` },
        { id: "wording", title: "Wording people read (no placeholder or test words)", result: wording.length ? "FAIL" : "PASS", detail: wording.length ? `${wording.length} file(s) hold words people should never read.` : "No placeholder, test or sample words in the screens." },
      ],
      findings: wording.map((w) => ({ severity: "MEDIUM", file: str(w.file), what: `Wording: "${str(w.word)}" is shown to people.` })),
      notChecked: ["Leftover TODO / FIXME notes (checked from 31.10 on).", "A line-by-line review of the code against every acceptance criterion by a second AI reviewer (the official 03-review agent)."],
    },
    test: {
      checks: [
        { id: "production-build", title: "Production build (vite build)", result: "PASS", detail: `The production build passed: ${num(b.jsKb)} kB JavaScript, ${num(b.cssKb)} kB CSS.`, log: fs.existsSync(path.join(job.dir, "vite-build-2.log")) ? "vite-build-2.log" : "vite-build.log" },
        { id: "app-tests", title: "The app's automated tests (npm test)", result: hasTests ? "NOT-RUN" : "N/A", detail: hasTests ? "The app has a test script; this older build did not run it." : "The app has no automated tests yet (no test script in package.json)." },
      ],
      findings: [],
      notChecked: ["Unit tests per acceptance criterion and end-to-end browser tests (the official 04-test agent writes and runs them); the Factory's build has none yet.", "Accessibility, performance and contract tests."],
    },
    security: {
      checks: [
        { id: "secret-scan", title: "Secrets, tokens, private keys and eval() in the source; scripts from other sites", result: security.length ? "FAIL" : "PASS", detail: security.length ? `${security.length} finding(s).` : `${files} source files scanned, nothing found.` },
        { id: "dependency-audit", title: "Dependency audit of the app's runtime packages (npm audit)", result: "NOT-RUN", detail: older },
      ],
      findings: security.map((s) => ({ severity: "CRITICAL", what: s })),
      notChecked: ["Penetration testing and the server-side checks of the official 05-secops agent (sign-in, roles, rate limits, injection); the Factory's apps run in the browser only and have no server of their own yet."],
    },
    docs: {
      checks: [{ id: "user-guide", title: "User guide (README.md) written in this build", result: b.readme ? "PASS" : "FAIL", detail: b.readme ? "README.md written in this build." : "README.md not updated by this build." }],
      findings: [],
      notChecked: ["API reference and data-model documents (the official 06-docs agent); the Factory's apps have no API of their own yet."],
    },
  };
}

const serious = (g?: Gate, levels = ["CRITICAL", "HIGH"]): number => (g?.findings ?? []).filter((f) => levels.includes(f.severity)).length;
/** The official decision of a gate: SEND-BACK on a failed required check or a CRITICAL / HIGH (review: also MEDIUM) finding. */
function decisionOf(g: Gate | undefined, levels: string[], advisory: string[] = []): "PASS" | "SEND-BACK" | "NOT-RUN" {
  if (!g || g.checks.length === 0) return "NOT-RUN";
  const required = g.checks.filter((c) => !advisory.includes(c.id));
  return required.some((c) => c.result === "FAIL") || serious(g, levels) > 0 ? "SEND-BACK" : "PASS";
}
const statusOf = (d: string): OutputItem["status"] => (d === "PASS" || d === "OPEN" ? "pass" : d === "SEND-BACK" || d === "FAIL" ? "fail" : d === "HOLD" ? "hold" : "info");

// ------------------------------------------------------------------------------------------------- the generator

export interface GenerateOptions {
  now?: Date;
}

/** Writes the project's outputs under <projectDir>/artifacts/ and answers the manifest (also in outputs.json). */
export async function writeProjectOutputs(projectDir: string, o: GenerateOptions = {}): Promise<OutputsManifest> {
  const now = (o.now ?? new Date()).toISOString();
  const artifacts = path.join(projectDir, "artifacts");
  fs.mkdirSync(artifacts, { recursive: true });
  const w = writerAt(artifacts);
  const pj = readJson(path.join(projectDir, "project.json")) ?? {};
  const projectId = str(pj.projectId) || path.basename(projectDir);
  const workspaceId = str(pj.workspaceId) || path.basename(path.dirname(projectDir));
  const ctx = readJson(path.join(artifacts, "brief", "context.json"));
  const s = obj(ctx?.sections);
  const basics = obj(s.basics);
  const name = str(pj.name) || str(basics.name) || projectId;
  const PID = pidOf(name, projectId);
  const repo = path.join(projectDir, "repo");
  const jobs = jobsOf(projectDir);
  const req = obj(s.requirements);
  const reqItems = arr(req.items);
  const objective = obj(req.objective);
  const scope = obj(s.scope);
  const versions = arr(scope.versions);
  const lockedN = num(scope.locked) || num(scope.current) || (versions.length ? num(versions[versions.length - 1]!.number) : 0);
  const sv = versions.find((v) => num(v.number) === lockedN) ?? versions[versions.length - 1] ?? {};
  // The locked scope's features; the ones set aside ("Not included", status dropped) are listed apart, never counted
  // or described as what the product does.
  const allFeatures = arr(sv.features);
  const features = allFeatures.filter((f) => str(f.status) !== "dropped");
  const notIncluded = allFeatures.filter((f) => str(f.status) === "dropped");
  const milestones = arr(s.milestones).filter((m) => !lockedN || num(m.scopeVersion) === lockedN || !m.scopeVersion);
  const tickets = arr(s.tickets);
  const clar = arr(s.clarifications);
  const decisions = obj(s.decisions);
  const tech = arr(decisions.tech);
  const crs = arr(decisions.changeRequests);
  const brief = obj(obj(s.sources).brief);
  const releases = arr(s.releases);
  const builds = obj(pj.builds);
  const envs = obj(pj.environments);
  const ref = (r: unknown) => str(r);
  // people by name (the ledger's user events carry the name next to the id): files people read show names, not ids
  const names = new Map<string, string>();
  for (const line of readText(path.join(artifacts, "brief", "ledger.jsonl")).split("\n")) {
    if (!line.includes('"byName"')) continue;
    try {
      const e = JSON.parse(line) as J;
      if (str(e.by) && str(e.byName)) names.set(str(e.by), str(e.byName));
    } catch {
      /* a torn line */
    }
  }
  const who = (id: unknown): string => names.get(str(id)) ?? (str(id) ? "a project member" : "");
  const featureByKey = new Map(allFeatures.map((f) => [str(f.key), f]));
  const featureOfRef = (r: string) => featureByKey.get(r.replace(/^feature:/i, "")) ?? allFeatures.find((f) => str(f.ref) === r);
  const reqByKey = new Map(reqItems.map((r) => [str(r.key), r]));
  const reqOfRef = (r: string) => reqByKey.get(r.replace(/^requirement:/i, "")) ?? reqItems.find((x) => str(x.ref) === r);
  const msByRef = new Map(arr(s.milestones).map((m) => [str(m.ref), m]));
  let successTargets: J = {};
  try {
    successTargets = obj(JSON.parse(str(sv.successTargets) || "{}"));
  } catch {
    successTargets = {};
  }
  const targetLines = Object.entries(successTargets)
    .map(([k, v]) => ({ k, v: str(obj(v).value) }))
    .filter((x) => x.v)
    .map((x) => `- **${x.k.replace(/([A-Z])/g, " $1").replace(/^./, (c) => c.toUpperCase())}:** ${x.v}`);

  // ---------------------------------------------------------------- requirements: BRD, PRD, questions
  const brd: string[] = [`# Business Requirements Document — ${name}`, "", `_R1 BRD of the MADP requirement phase, written from the project's records (context version ${num(ctx?.version)}, ${day(str(ctx?.updatedAt))})._`, ""];
  brd.push("## Business objective", "", str(objective.statement) || str(basics.goal) || "_Not written yet._", "");
  if (strs(objective.acceptance).length) brd.push("### How we know it works (KPIs)", "", ...strs(objective.acceptance).map((a) => `- ${a}`), "");
  if (targetLines.length) brd.push("### Success targets", "", ...targetLines, "");
  brd.push("## Stakeholders and users", "", str(basics.targetUsers) || "_Not named yet._", "");
  const cats = new Map<string, J[]>();
  for (const r of reqItems) cats.set(str(r.category) || "functional", [...(cats.get(str(r.category) || "functional") ?? []), r]);
  for (const [cat, list] of cats) {
    brd.push(`## ${cat === "functional" ? "Functional" : cat === "non-functional" || cat === "nonfunctional" ? "Non-functional" : cat.charAt(0).toUpperCase() + cat.slice(1)} requirements`, "");
    for (const r of list) {
      brd.push(`### R${num(r.number)}. ${str(r.title)} _(${str(r.priority) || "should"}, ${str(r.status) || "draft"})_`, "", str(r.text), "");
      if (strs(r.acceptance).length) brd.push(...strs(r.acceptance).map((a) => `- ${a}`), "");
    }
  }
  const extras = arr(req.extras);
  if (extras.length) brd.push("## Workflows, rules and other needs", "", ...extras.map((x) => `- **${str(x.kind)}:** ${str(x.title)}${str(x.status) && str(x.status) !== "active" ? ` (${str(x.status)})` : ""}`), "");
  const outOfScope = strs(basics.exclusions).concat(strs(brief.outOfScope));
  if (outOfScope.length) brd.push("## Out of scope", "", ...outOfScope.map((x) => `- ${x}`), "");
  const openQ = clar.filter((c) => str(c.status) !== "answered");
  brd.push("## Open questions and business decisions", "");
  brd.push(clar.length ? `${clar.length - openQ.length} of ${clar.length} questions answered (see QUESTIONS.md).` : "No questions were raised.", "");
  for (const c of openQ) brd.push(`- Q${num(c.number)} ${str(c.question)} — _${str(c.status) || "open"}${str(c.deferReason) ? `: ${str(c.deferReason)}` : ""}_`);
  if (openQ.length) brd.push("");
  w.write("requirements/BRD.md", `${brd.join("\n")}\n`);

  const q: string[] = [`# Questions and answers — ${name}`, "", "_What the business analyst asked, and what the client answered._", ""];
  for (const c of clar) q.push(`## Q${num(c.number)}. ${str(c.question)}`, "", str(c.answer) ? `**Answer:** ${str(c.answer)}` : `_${str(c.status) || "open"}_`, ...(str(c.answeredAt) ? ["", `_Answered ${day(str(c.answeredAt))}_`] : []), ...(str(c.source) ? ["", `_Raised from ${str(c.source)}_`] : []), "");
  const briefQ = strs(brief.openQuestions);
  if (briefQ.length) q.push("## Questions the brief left for the product manager", "", ...briefQ.map((x) => `- ${x}`), "");
  w.write("requirements/QUESTIONS.md", `${q.join("\n")}\n`);

  const prd: string[] = [`# Product Requirements Document — ${name}`, "", `_R2 PRD of the MADP requirement phase: scope version ${lockedN || "—"}${str(sv.status) ? ` (${str(sv.status)}${str(sv.lockedAt) ? ` ${day(str(sv.lockedAt))}` : ""})` : ""}._`, ""];
  prd.push("## Features and user stories", "");
  for (const f of features) {
    prd.push(`### ${str(f.title)} _(${str(f.priority) || "should"})_`, "", str(f.description), "");
    const rs = strs(f.requirementRefs).map(reqOfRef).filter(Boolean) as J[];
    if (rs.length) prd.push(`Covers: ${rs.map((r) => `R${num(r.number)} ${str(r.title)}`).join("; ")}`, "");
    for (const st of arr(f.stories)) {
      prd.push(`- **${str(st.title)}** (${str(st.actor) || "user"}, ${num(st.hours)} h)`);
      for (const a of strs(st.acceptance)) prd.push(`  - ${a}`);
    }
    prd.push("");
  }
  if (notIncluded.length) prd.push("## Not included", "", ...notIncluded.map((f) => `- **${str(f.title)}**${str(f.description) ? ` — ${str(f.description)}` : ""}`), "");
  prd.push("## Implementation slices (milestones)", "");
  for (const m of milestones) {
    prd.push(`### Milestone ${num(m.number)}: ${str(m.name)}${str(m.status) ? ` _(${str(m.status)})_` : ""}`, "", str(m.goal), "");
    const fs2 = strs(m.featureRefs).map(featureOfRef).filter(Boolean) as J[];
    if (fs2.length) prd.push(`Features: ${fs2.map((f) => str(f.title)).join(", ")}`, "");
    if (str(m.previewPoint)) prd.push(`What to try in the preview: ${str(m.previewPoint)}`, "");
  }
  if (tech.length) {
    prd.push("## Technical decisions", "");
    for (const t of tech) prd.push(`### ${num(t.number)}. ${str(t.title)} _(${str(t.area)}, ${str(t.status)})_`, "", str(t.choice), "", ...(str(t.rationale) ? [`_Why:_ ${str(t.rationale)}`, ""] : []));
  }
  if (targetLines.length) prd.push("## Non-functional targets", "", ...targetLines, "");
  w.write("requirements/PRD.md", `${prd.join("\n")}\n`);

  // ---------------------------------------------------------------- 01-planner: REQ yaml + plan
  const ticketsOf = (m: J) => tickets.filter((t) => str(t.milestone) === str(m.ref));
  const planner = jobs.filter((j) => j.kind === "board.plan" && j.status === "succeeded").pop();
  const reqYaml = {
    id: `REQ-${PID}-v${lockedN || 1}`,
    title: name,
    revision: lockedN || 1,
    status: tickets.length ? "PASS" : "BLOCKED",
    source: { "project-id": projectId, "workspace-id": workspaceId, "context-version": num(ctx?.version), "scope-version": lockedN, "planned-by-job": planner ? `${planner.jobId} (attempt ${planner.attempt})` : "not planned yet" },
    "repository-layout": "single",
    repositories: [{ id: "app", path: "repo/", "main-branch": "main" }],
    requirements: reqItems.map((r) => ({ id: `R${num(r.number)}`, ref: ref(r.ref), title: str(r.title), category: str(r.category), priority: str(r.priority), status: str(r.status), acceptance: strs(r.acceptance) })),
    scope: { version: lockedN, status: str(sv.status), features: features.map((f) => ({ key: str(f.key), title: str(f.title), priority: str(f.priority), requirements: strs(f.requirementRefs), stories: arr(f.stories).map((x) => str(x.title)) })), "not-included": notIncluded.map((f) => str(f.title)) },
    "module-map": milestones.map((m) => ({
      id: `M${String(num(m.number)).padStart(2, "0")}`,
      title: str(m.name),
      goal: str(m.goal),
      features: strs(m.featureRefs),
      tickets: ticketsOf(m).map((t) => ({ number: num(t.number), title: str(t.title), type: str(t.type), hours: num(t.hours), column: str(t.column), acceptance: strs(t.acceptance) })),
    })),
    "technical-architecture": tech.map((t) => ({ area: str(t.area), decision: str(t.title), choice: str(t.choice), status: str(t.status) })),
    blockers: openQ.map((c) => `Q${num(c.number)} ${str(c.question)}`),
    "human-review-required": openQ.length > 0,
    "human-review-reason": openQ.length ? `${openQ.length} question(s) still open.` : "",
  };
  w.write(`REQ-${PID}-v${lockedN || 1}.yaml`, toYaml(reqYaml));
  const plan: string[] = [`# Work plan — ${name}`, "", `_01 Planner: ${tickets.length} tickets in ${milestones.length} milestones${planner ? `, planned ${day(planner.startedAt)}` : ""}._`, ""];
  for (const m of milestones) {
    const ts = ticketsOf(m);
    plan.push(`## Milestone ${num(m.number)}: ${str(m.name)} — ${ts.filter((t) => t.done === true).length} of ${ts.length} done`, "", "| # | Ticket | Type | Estimate | Column |", "|---|---|---|---|---|");
    for (const t of ts) plan.push(`| ${num(t.number)} | ${str(t.title).replace(/\|/g, "/")} | ${str(t.type)} | ${estimateCell(num(t.hours))} | ${str(t.column)} |`);
    plan.push("");
  }
  w.write("plan/PLAN.md", `${plan.join("\n")}\n`);

  // ---------------------------------------------------------------- design (HTML rendered from each design job's design.json)
  const designItems: { rel: string; title: string }[] = [];
  const designJobs = jobs.filter((j) => j.kind === "design.generate" && fs.existsSync(path.join(j.dir, "design.json")));
  if (designJobs.length) {
    let render: ((spec: J) => string) | null = null;
    try {
      const m = (await import("../local/engine/kinds/scope/screenHtml.ts")) as { screenHtml(spec: unknown): string };
      render = (spec) => m.screenHtml(spec);
    } catch {
      render = null;
    }
    designJobs.forEach((j, n) => {
      const d = obj(readJson(path.join(j.dir, "design.json"))?.design);
      const screens = arr(d.screens);
      const lines = [`# Screen designs ${n + 1} — ${name}`, "", `_Designer: ${screens.length} screens, ${day(j.startedAt)} (job ${j.jobId.slice(0, 8)})._`, ""];
      screens.forEach((sc, i) => {
        const device = str(sc.device) === "mobile" ? "mobile" : "desktop";
        const rel = `design/v${n + 1}/${String(i + 1).padStart(2, "0")}-${slug(str(sc.name), 40) || "screen"}-${device}.html`;
        if (render) {
          try {
            const spec = { device, brand: str(d.brand) || "4f46e5", app: str(d.app) || name, title: str(sc.name), ...(str(sc.subtitle) ? { subtitle: str(sc.subtitle) } : {}), nav: screens.map((x) => str(x.navLabel)), activeNav: i, ...(str(sc.person) ? { person: str(sc.person) } : {}), search: str(sc.search), blocks: arr(sc.blocks) };
            w.write(rel, render(spec));
            designItems.push({ rel, title: `${str(sc.name)} (${device})` });
          } catch {
            /* one screen that cannot be drawn is listed without its page */
          }
        }
        lines.push(`- **${str(sc.name)}** (${device})${str(sc.subtitle) ? ` — ${str(sc.subtitle)}` : ""}${designItems.some((x) => x.rel === rel) ? ` · [open](${rel.replace(/^design\//, "")})` : ""}`);
      });
      w.write(`design/DESIGN-v${n + 1}.md`, `${lines.join("\n")}\n`);
    });
  }

  // ---------------------------------------------------------------- the builds: one module per milestone / change
  const items: Record<string, OutputItem[]> = {};
  const add = (section: string, rel: string, title: string, summary: string, extra: Partial<OutputItem> = {}) => {
    let st: fs.Stats;
    try {
      st = fs.statSync(path.join(artifacts, rel));
    } catch {
      return;
    }
    (items[section] ??= []).push({ path: rel, title, summary, kind: kindOf(rel), bytes: st.size, updatedAt: st.mtime.toISOString(), ...extra });
  };
  const buildJobs = jobs.filter((j) => j.kind === "build.run" || j.kind === "change.build");
  const buildDecisions = new Map<string, { review: string; test: string; sec: string; docs: string; commit: string }>();
  const traceBuilds: J[] = [];
  for (const j of buildJobs) {
    const bj = readJson(path.join(j.dir, "build.json"));
    const g = gatesOf(j, repo);
    const gj = readJson(path.join(j.dir, "gates.json"));
    const buildId = str(bj?.buildId) || str(gj?.buildId) || "";
    const version = str(bj?.version) || str(gj?.version) || str(j.input.version);
    const pre = /^([a-z]+)(\d+)/.exec(buildId) ?? /^([a-z]+)(\d+)/.exec(str(j.input.milestone));
    const ms = msByRef.get(`Milestone:${str(j.input.milestoneId)}`) ?? milestones.find((m) => pre && pre[1] === "m" && num(m.number) === Number(pre[2]));
    const cr = j.kind === "change.build" || (pre && pre[1] !== "m") ? (crs.find((c) => str(c.ref) === `ChangeRequest:${str(j.input.changeRequestId)}`) ?? crs.find((c) => pre && num(c.number) === Number(pre[2]))) : undefined;
    const mod = cr ? `CR${num(cr.number)}` : pre && pre[1] !== "m" ? `CR${pre[2]}` : `M${String(ms ? num(ms.number) : pre ? Number(pre[2]) : 0).padStart(2, "0")}`;
    const modTitle = ms && !cr ? str(ms.name) : cr ? str(cr.title) : str(gj?.label) || buildId || j.jobId.slice(0, 8);
    const dir = `specs/${mod}-${slug(modTitle, 40) || "build"}`;
    const group = `${mod === "M00" ? "Build" : mod.startsWith("CR") ? `Change ${mod.slice(2)}` : `Milestone ${Number(mod.slice(1))}`}: ${modTitle}${version ? ` · ${version}` : ""}`;
    const vN = j.attempt;
    const tag = `${PID}-${mod}-v${vN}`;
    // the module's spec: what the developer was asked to build (artifacts/<buildId>-spec.md) and the tickets
    const specSrc = buildId ? path.join(artifacts, `${buildId}-spec.md`) : "";
    const msTickets = ms ? ticketsOf(ms) : [];
    const spec = [`# ${mod} — ${modTitle}`, "", ms ? `**Goal:** ${str(ms.goal)}` : "", "", "## Tickets and acceptance criteria", ""];
    for (const t of msTickets) spec.push(`### #${num(t.number)} ${str(t.title)}`, "", ...strs(t.acceptance).map((a) => `- ${a}`), "");
    if (specSrc && fs.existsSync(specSrc)) spec.push("---", "", readText(specSrc));
    w.write(`${dir}/${mod}-${slug(modTitle, 40) || "build"}.md`, `${spec.join("\n")}\n`);
    add("builds", `${dir}/${mod}-${slug(modTitle, 40) || "build"}.md`, `Module spec — ${modTitle}`, `${msTickets.length} tickets with their acceptance criteria and the developer's brief.`, { group, status: "info" });
    if (!g) continue;
    const base = (kind: string, extra: J) => ({ id: `${kind}-${tag}`, "spec-ref": `${dir}/${mod}-${slug(modTitle, 40) || "build"}.md`, revision: vN, "build-id": buildId, version, branch: str(bj?.branch) || str(gj?.branch), commit: g.commit ?? "", job: `${j.jobId} (attempt ${j.attempt})`, ...(g.reconstructed ? { "recorded-from": "build.json (this build was made before the gates wrote gates.json)" } : {}), ...extra });
    const checksOf = (x?: Gate) => (x?.checks ?? []).map((c) => ({ check: c.title, result: c.result, detail: c.detail, ...(c.log ? { log: `logs/${j.folder}/${c.log}` } : {}) }));
    for (const c of [...(g.test?.checks ?? []), ...(g.security?.checks ?? [])]) if (c.log) w.copy(path.join(j.dir, c.log), `${dir}/logs/${j.folder}/${c.log}`);
    const sendBack = (x: Gate | undefined, levels: string[]) => (x?.findings ?? []).filter((f) => levels.includes(f.severity)).map((f, i) => ({ id: `SB-${String(i + 1).padStart(3, "0")}`, severity: f.severity, ...(f.file ? { file: f.file } : {}), actual: f.what }));
    // 02-dev
    const changed = g.changes;
    const code = base("CODE", {
      title: modTitle,
      status: g.status === "passed" ? "PASS" : "BLOCKED",
      ...(g.failure ? { blockers: [`${g.failure.code}: ${g.failure.message}`] } : { blockers: [] }),
      "tech-stack": ["React 18", "Vite", "Tailwind CSS", "TypeScript (TSX)"],
      "setup-instructions": "npm install",
      "run-instructions": "npm run dev (local) · npm run build (production build into dist/)",
      "spec-coverage": msTickets.map((t) => ({ ticket: `#${num(t.number)} ${str(t.title)}`, status: t.done === true ? "implemented" : str(t.column) })),
      "changed-files": changed ? { files: changed.files, insertions: changed.insertions, deletions: changed.deletions, list: changed.list.map((x) => `${x.file} (+${x.added} −${x.removed})`) } : "not recorded",
      "test-summary": (g.test?.checks ?? []).map((c) => `${c.title}: ${c.result}`),
      "human-review-required": false,
    });
    w.write(`${dir}/CODE-${tag}.yaml`, toYaml(code));
    // 03-review
    const rd = decisionOf(g.review, ["CRITICAL", "HIGH", "MEDIUM"], ["code-notes"]);
    w.write(`${dir}/REVIEW-${tag}.yaml`, toYaml(base("REVIEW", {
      "code-ref": `CODE-${tag}.yaml`, decision: rd, "checks-performed": checksOf(g.review), findings: (g.review?.findings ?? []).map((f) => ({ severity: f.severity, ...(f.file ? { file: f.file } : {}), finding: f.what })),
      "send-back-items": sendBack(g.review, ["CRITICAL", "HIGH", "MEDIUM"]), "not-checked": g.review?.notChecked ?? [],
      "human-review-required": rd === "SEND-BACK", "human-review-reason": rd === "SEND-BACK" ? "Findings that the Factory does not send back to the developer automatically yet." : "",
    })));
    // 04-test
    const td = g.status === "failed" && /compile|install|generate/.test(g.failure?.code ?? "") ? "SEND-BACK" : decisionOf(g.test, ["CRITICAL", "HIGH"]);
    w.write(`${dir}/TEST-${tag}.yaml`, toYaml(base("TEST", {
      "code-ref": `CODE-${tag}.yaml`, "review-ref": `REVIEW-${tag}.yaml`, "environment-target": "DEV", decision: td,
      "test-plan": "The production build of the whole app; the app's own automated tests when it has them; the smoke tests of each published address (see the RELEASE reports).",
      "test-cases": checksOf(g.test), failures: (g.test?.findings ?? []).map((f) => f.what).concat(g.failure && td === "SEND-BACK" ? [`${g.failure.code}: ${g.failure.message}`] : []),
      "e2e-results": "Not run by the build. Each published address is smoke-tested by the release gate (RELEASE-*.yaml).", "not-checked": g.test?.notChecked ?? [],
    })));
    // 05-secops
    const sd = g.failure?.code === "build.security_failed" ? "SEND-BACK" : decisionOf(g.security, ["CRITICAL", "HIGH"]);
    w.write(`${dir}/SEC-${tag}.yaml`, toYaml(base("SEC", {
      "code-ref": `CODE-${tag}.yaml`, "environment-scope": "DEV", decision: sd, "checks-performed": checksOf(g.security),
      findings: (g.security?.findings ?? []).map((f, i) => ({ id: `SEC-${String(i + 1).padStart(3, "0")}`, severity: f.severity, finding: f.what })), "send-back-items": sendBack(g.security, ["CRITICAL", "HIGH"]),
      "acknowledged-risks": [], "not-checked": g.security?.notChecked ?? [],
      "human-review-required": sd === "SEND-BACK", "human-review-reason": sd === "SEND-BACK" ? "Security findings to settle before the next release." : "",
    })));
    // 06-docs
    const dd = decisionOf(g.docs, ["CRITICAL", "HIGH"]);
    w.write(`${dir}/DOCS-${tag}.yaml`, toYaml(base("DOCS", { "code-ref": `CODE-${tag}.yaml`, status: dd === "PASS" ? "PASS" : dd === "NOT-RUN" ? "NOT-RUN" : "BLOCKED", "documents-produced": ["README.md (user guide, on main)", "RELEASE-NOTES.md (on main)", buildId ? `${buildId}-release-notes.md` : ""].filter(Boolean), "checks-performed": checksOf(g.docs), "not-checked": g.docs?.notChecked ?? [] })));
    const summaryOf = (x: Gate | undefined, d: string) => `${d === "SEND-BACK" ? "Send back" : d === "PASS" ? "Passed" : "Not run"} · ${(x?.checks ?? []).filter((c) => c.result === "PASS").length} of ${(x?.checks ?? []).length} checks passed · ${(x?.findings ?? []).length} finding(s)`;
    add("builds", `${dir}/CODE-${tag}.yaml`, `Developer report (02 dev) — ${modTitle}`, `${g.status === "passed" ? "Built" : "Stopped"}${changed ? ` · ${changed.files} files changed (+${changed.insertions} −${changed.deletions})` : ""}${g.commit ? ` · commit ${g.commit.slice(0, 8)}` : ""}`, { group, status: g.status === "passed" ? "pass" : "fail" });
    add("builds", `${dir}/REVIEW-${tag}.yaml`, `Review report (03 review) — ${modTitle}`, summaryOf(g.review, rd), { group, status: statusOf(rd) });
    add("builds", `${dir}/TEST-${tag}.yaml`, `Test report (04 test) — ${modTitle}`, summaryOf(g.test, td), { group, status: statusOf(td) });
    add("builds", `${dir}/SEC-${tag}.yaml`, `Security report (05 SecOps) — ${modTitle}`, summaryOf(g.security, sd), { group, status: statusOf(sd) });
    add("builds", `${dir}/DOCS-${tag}.yaml`, `Docs report (06 docs) — ${modTitle}`, summaryOf(g.docs, dd), { group, status: statusOf(dd) });
    for (const c of [...(g.test?.checks ?? []), ...(g.security?.checks ?? [])]) if (c.log) add("builds", `${dir}/logs/${j.folder}/${c.log}`, `${c.title} — output`, c.detail, { group, status: "info" });
    if (g.status === "passed") buildDecisions.set(buildId, { review: rd, test: td, sec: sd, docs: dd, commit: g.commit ?? "" });
    traceBuilds.push({ buildId, version, module: mod, commit: g.commit ?? "", status: g.status, tickets: msTickets.map((t) => num(t.number)) });
  }

  // ---------------------------------------------------------------- 07-release: one gate per environment
  const releaseItems: string[] = [];
  const deployJobs = jobs.filter((j) => j.kind === "preview.deploy");
  for (const [env, raw] of Object.entries(envs)) {
    const e = obj(raw);
    const version = str(e.version);
    const buildId = str(e.buildId);
    const ENV = ENV_NAME[env] ?? env.toUpperCase();
    const job = [...deployJobs].reverse().find((j) => j.status === "succeeded" && (str(j.input.environment) === env || (env === "dev" && str(j.input.release) === version)));
    const smoke = job ? (readJson(path.join(job.dir, "smoke.json")) as unknown as J[] | null) : null;
    const d = buildDecisions.get(buildId);
    const openSendBacks = d ? [d.review, d.test, d.sec].filter((x) => x === "SEND-BACK").length : 0;
    const rel = releases.find((r) => str(r.environment) === env && str(r.version) === version);
    const gate = !d ? "HOLD" : openSendBacks ? "HOLD" : "OPEN";
    const holdReason = !d ? "The build's gate reports are missing." : openSendBacks ? `${openSendBacks} gate(s) of build ${buildId} sent back (see its REVIEW / TEST / SEC reports).` : "";
    const y = {
      id: `RELEASE-${ENV}-${PID}-${version}`,
      environment: ENV,
      revision: 1,
      status: gate,
      "gate-decision": gate,
      "hold-reason": holdReason,
      "artifact-chain": d ? { "build-id": buildId, commit: d.commit, review: d.review, test: d.test, security: d.sec, docs: d.docs } : { "build-id": buildId },
      deployment: { url: str(e.url), version, "deployed-at": str(e.at), ...(rel ? { "released-by": who(rel.releasedBy), "released-at": str(rel.releasedAt), "release-ref": str(rel.ref) } : {}), ...(job ? { job: `${job.jobId} (attempt ${job.attempt})` } : {}) },
      "smoke-tests": Array.isArray(smoke) && smoke.length ? smoke : job ? "Passed (the deploy job succeeds only when its smoke tests pass; this older run did not record their details)." : "No deploy job found.",
      rollback: "The previous version stays published under /v/<version>/ on the preview server; promoting it again restores it.",
      "version-confirmed-by": rel && str(rel.releasedBy) ? who(rel.releasedBy) : "the engine (smoke tests)",
      ...(gate === "HOLD" && str(e.at) ? { note: "Released by a person although the gate holds: the Factory does not block a release on these reports yet." } : {}),
    };
    const file = `RELEASE-${ENV}-${PID}-${version || "unversioned"}.yaml`;
    w.write(file, toYaml(y));
    releaseItems.push(file);
    add("releases", file, `Release gate — ${ENV_LABEL[env] ?? env} ${version}`, `${gate === "OPEN" ? "Gate open" : "On hold"} · ${str(e.url)} · ${day(str(e.at))}`, { status: gate === "OPEN" ? "pass" : "hold" });
  }
  // previews of milestones (dev) that were not promoted are listed by the summary

  // ---------------------------------------------------------------- docs: the app's own guide and notes on main
  const readme = git(repo, ["show", "main:README.md"]);
  const notes = git(repo, ["show", "main:RELEASE-NOTES.md"]);
  if (readme) w.write("docs/README.md", readme);
  if (notes) w.write("docs/RELEASE-NOTES.md", notes);
  const overview = [`# Business overview — ${name}`, "", str(objective.statement) || str(basics.goal), "", "## Who it is for", "", str(basics.targetUsers), "", "## What it does", "", ...features.map((f) => `- **${str(f.title)}** — ${str(f.description)}`), ""];
  w.write("docs/business-overview.md", `${overview.join("\n")}\n`);

  // ---------------------------------------------------------------- trace
  const relOf = (buildId: string) => Object.entries(envs).filter(([, v]) => str(obj(v).buildId) === buildId).map(([k, v]) => `${ENV_LABEL[k] ?? k} ${str(obj(v).version)}`);
  const trace: J[] = reqItems.map((r) => {
    const fsOf = features.filter((f) => strs(f.requirementRefs).some((x) => reqOfRef(x) === r));
    return {
      requirement: `R${num(r.number)} ${str(r.title)}`,
      ref: ref(r.ref),
      features: fsOf.map((f) => {
        const ts = tickets.filter((t) => str(t.feature).replace(/^feature:/i, "") === str(f.key));
        const msNums = [...new Set(ts.map((t) => num(msByRef.get(str(t.milestone))?.number)))].filter(Boolean);
        const bs = traceBuilds.filter((b) => msNums.includes(Number(str(b.module).slice(1))) && str(b.module).startsWith("M"));
        return {
          feature: str(f.title), ref: ref(f.ref), stories: arr(f.stories).map((x) => str(x.title)),
          tickets: ts.map((t) => `#${num(t.number)} ${str(t.title)} (${str(t.column)})`),
          builds: bs.map((b) => ({ build: str(b.buildId), version: str(b.version), commit: str(b.commit).slice(0, 12), releases: relOf(str(b.buildId)) })),
        };
      }),
    };
  });
  w.write(`TRACE-${PID}.json`, `${JSON.stringify({ project: name, projectId, generatedAt: now, trace }, null, 2)}\n`);
  const tm = [`# Trace — ${name}`, "", "_Requirement → feature → story → ticket → commit → build → release. Every record's full history (which engine job made it, from which context version and sources) is in brief/ledger.jsonl and the project-brief MCP server's `trace` tool._", ""];
  for (const t of trace) {
    tm.push(`## ${str(t.requirement)}`, "");
    const fl = arr(t.features);
    if (!fl.length) tm.push("_No feature covers it yet._", "");
    for (const f of fl) {
      tm.push(`- **Feature:** ${str(f.feature)}`);
      for (const st of strs(f.stories)) tm.push(`  - Story: ${st}`);
      for (const tk of strs(f.tickets)) tm.push(`  - Ticket ${tk}`);
      for (const b of arr(f.builds)) tm.push(`  - Build ${str(b.build)} (${str(b.version)}), commit \`${str(b.commit)}\`${strs(b.releases).length ? ` → released: ${strs(b.releases).join(", ")}` : ""}`);
    }
    tm.push("");
  }
  w.write(`TRACE-${PID}.md`, `${tm.join("\n")}\n`);

  // ---------------------------------------------------------------- runs + pipeline summary
  const runs = [`# Engine runs — ${name}`, "", `${jobs.length} engine job(s). Each job's own folder (prompt, transcript, logs, result, the context version it used) is jobs/<job>-<attempt>/ in the project folder.`, "", "| Started | Job | MADP role | Status | Result | Folder |", "|---|---|---|---|---|---|"];
  for (const j of jobs) runs.push(`| ${day(j.startedAt)} | ${j.kind} | ${ROLE[j.kind] ?? j.kind} | ${j.status} | ${j.message.replace(/\|/g, "/").slice(0, 140)} | jobs/${j.folder}/ |`);
  w.write("runs/RUNS.md", `${runs.join("\n")}\n`);
  const done = tickets.filter((t) => t.done === true).length;
  const live = Object.entries(envs).map(([k, v]) => `${ENV_LABEL[k] ?? k} ${str(obj(v).version)}`);
  const summaryLine = `${reqItems.length} requirements, ${features.length} features, ${tickets.length} tickets (${done} done), ${Object.keys(builds).length} build(s)${live.length ? `, live on ${live.join(", ")}` : ""}.`;
  const ps = [`# Pipeline summary — ${name}`, "", summaryLine, "", "| Stage | MADP agent | What it produced | Result |", "|---|---|---|---|"];
  const stage = (label: string, agent: string, what: string, result: string) => ps.push(`| ${label} | ${agent} | ${what} | ${result} |`);
  stage("Requirements", "R1 BRD", "requirements/BRD.md, QUESTIONS.md", `${reqItems.length} requirements · ${clar.length - openQ.length}/${clar.length} questions answered`);
  stage("Requirements", "R2 PRD", "requirements/PRD.md", `${features.length} features · ${features.reduce((n, f) => n + arr(f.stories).length, 0)} stories · ${milestones.length} milestones`);
  stage("Planning", "01 Planner", `REQ-${PID}-v${lockedN || 1}.yaml, plan/PLAN.md`, `${tickets.length} tickets`);
  for (const [buildId, d] of buildDecisions) stage("Build", "02–06", `specs/ (${buildId})`, `review ${d.review} · test ${d.test} · secops ${d.sec} · docs ${d.docs}`);
  for (const f of releaseItems) stage("Release", "07 Release", f, readText(path.join(artifacts, f)).match(/^gate-decision: (\w+)/m)?.[1] ?? "");
  ps.push("", "## Engine jobs", "", ...Object.entries(jobs.reduce<Record<string, { n: number; ok: number }>>((m, j) => ((m[j.kind] = { n: (m[j.kind]?.n ?? 0) + 1, ok: (m[j.kind]?.ok ?? 0) + (j.status === "succeeded" ? 1 : 0) }), m), {})).map(([k, v]) => `- ${k} (${ROLE[k] ?? k}): ${v.ok} of ${v.n} succeeded`), "");
  w.write("PIPELINE-SUMMARY.md", `${ps.join("\n")}\n`);

  // ---------------------------------------------------------------- memory + knowledge (official engine: memory/, knowledge/)
  w.write("memory/context.md", `# Project context — ${name}\n\n${summaryLine}\n\n- Goal: ${str(objective.statement) || str(basics.goal)}\n- Users: ${str(basics.targetUsers)}\n- Scope version ${lockedN}${str(sv.status) ? ` (${str(sv.status)})` : ""}\n- Context version ${num(ctx?.version)} (${day(str(ctx?.updatedAt))}); the full snapshot is brief/context.json, served to the build agents by the project-brief MCP server.\n`);
  const dec = [`# Decisions — ${name}`, "", "## Technical decisions", "", ...tech.map((t) => `- ${str(t.title)} — ${str(t.status)}${str(t.decidedAt) ? ` ${day(str(t.decidedAt))}` : ""}`), "", "## Answers that decided the scope", "", ...clar.filter((c) => str(c.answer)).map((c) => `- Q${num(c.number)} ${str(c.question)} → ${str(c.answer)}`), ""];
  for (const d of arr(decisions.decisions)) dec.push(`- ${str(d.title) || str(d.text) || str(d.ref)}`);
  w.write("memory/decisions.md", `${dec.join("\n")}\n`);
  const gaps = [`# Gaps — ${name}`, "", "## Open questions", "", ...(openQ.length ? openQ.map((c) => `- Q${num(c.number)} ${str(c.question)}`) : ["- None."]), "", "## Not checked by the Factory's gates (yet)", ""];
  const notChecked = new Set<string>();
  for (const j of buildJobs) {
    const g = gatesOf(j, repo);
    for (const x of [g?.review, g?.test, g?.security, g?.docs]) for (const n of x?.notChecked ?? []) notChecked.add(n);
  }
  gaps.push(...(notChecked.size ? [...notChecked].map((n) => `- ${n}`) : ["- Nothing recorded."]), "");
  w.write("memory/gaps.md", `${gaps.join("\n")}\n`);
  const risks: string[] = [];
  for (const j of buildJobs) {
    const g = gatesOf(j, repo);
    for (const f of [...(g?.security?.findings ?? []), ...(g?.test?.findings ?? []), ...(g?.review?.findings ?? [])]) if (["CRITICAL", "HIGH", "MEDIUM"].includes(f.severity)) risks.push(`- ${f.severity}: ${f.what}${f.file ? ` (${f.file})` : ""} — build ${j.jobId.slice(0, 8)}`);
  }
  w.write("memory/risks.md", `# Risks — ${name}\n\n${risks.length ? [...new Set(risks)].join("\n") : "No open risk from the gates' findings."}\n`);
  w.write("knowledge/risks.md", `# Known risks — ${name}\n\n${risks.length ? [...new Set(risks)].join("\n") : "None recorded by the gates."}\n`);
  const pkg = obj(readJson(path.join(projectDir, "repo", "package.json")) ?? (() => { try { return JSON.parse(git(repo, ["show", "main:package.json"]) || "{}") as J; } catch { return {}; } })());
  const deps = Object.entries(obj(pkg.dependencies)).map(([k, v]) => `- ${k} ${str(v)}`);
  const devDeps = Object.entries(obj(pkg.devDependencies)).map(([k, v]) => `- ${k} ${str(v)} (build only)`);
  w.write("knowledge/dependencies.md", `# Dependencies — ${name}\n\n${deps.length || devDeps.length ? [...deps, ...devDeps].join("\n") : "No package.json on main yet."}\n`);
  const debt: string[] = [];
  for (const j of buildJobs) for (const f of gatesOf(j, repo)?.review?.findings ?? []) if (f.severity === "LOW") debt.push(`- ${f.what}${f.file ? ` (${f.file})` : ""}`);
  w.write("knowledge/tech-debt.md", `# Technical debt — ${name}\n\n${debt.length ? [...new Set(debt)].join("\n") : "No leftover notes in the code were found by the review gate."}\n`);

  // ---------------------------------------------------------------- changes
  if (crs.length) {
    const cr = [`# Change requests — ${name}`, ""];
    for (const c of crs) cr.push(`## ${str(c.title) || str(c.ref)}`, "", ...Object.entries(c).filter(([k, v]) => k !== "title" && (typeof v === "string" || typeof v === "number") && str(v)).map(([k, v]) => `- ${k}: ${str(v)}`), "");
    w.write("changes/CHANGES.md", `${cr.join("\n")}\n`);
  }

  // ---------------------------------------------------------------- on the official MADP engine (official/onboarding.ts)
  // the onboarding report of an attached or former product: its checks on the untouched dev branch, its languages
  const onboarding = readReport(path.join(projectDir, "madp"));
  if (onboarding) w.write("engine/ONBOARDING.md", reportMarkdown(onboarding));

  // ---------------------------------------------------------------- sections of the index
  if (onboarding) add("engine", "engine/ONBOARDING.md", "Set-up on the MADP engine", `${onboarding.summary}${onboarding.attention.length ? ` ${onboarding.attention.length === 1 ? "One point needs" : `${onboarding.attention.length} points need`} your team.` : ""}`, { status: onboarding.attention.length ? "open" : "pass" });
  // what the brief really merges (server/api/brief/builder.ts): the Project brief note, the objective and the users where
  // they are recorded, and the files' readings; the person's other notes feed the business analyst's questions instead
  add("brief", "brief/brief.md", "Project brief", "The merged brief from the setup answers, the recorded objective and users, and the files.", { status: "info" });
  add("brief", "brief/form-answers.json", "Setup answers", "What the client answered in the guided start and to the business analyst's questions on the objective and the users.", { status: "info" });
  add("brief", "brief/decisions.json", "Brief decisions", "What the client confirmed or set aside in the brief.", { status: "info" });
  add("requirements", "requirements/BRD.md", "Business requirements (BRD)", `${reqItems.length} requirements, objective and success targets.`, { status: "info" });
  add("requirements", "requirements/PRD.md", "Product requirements (PRD)", `${features.length} features with their user stories, ${milestones.length} milestones, ${tech.length} technical decisions.`, { status: "info" });
  add("requirements", "requirements/QUESTIONS.md", "Questions and answers", `${clar.length - openQ.length} of ${clar.length} answered.`, { status: openQ.length ? "open" : "pass" });
  add("planning", `REQ-${PID}-v${lockedN || 1}.yaml`, "Planner artifact (01 planner)", `Requirements, scope and the module map of scope version ${lockedN || 1}.`, { status: tickets.length ? "pass" : "open" });
  add("planning", "plan/PLAN.md", "Work plan", `${tickets.length} tickets in ${milestones.length} milestones, ${done} done.`, { status: "info" });
  for (const b of designBriefsOf(artifacts)) add("planning", b.rel, "Design brief", b.summary, { status: "info", group: "Screen designs" });
  for (let n = 1; n <= designJobs.length; n++) add("planning", `design/DESIGN-v${n}.md`, `Screen designs ${n}`, "The screens the designer drew.", { status: "info", group: "Screen designs" });
  for (const d of designItems) add("planning", d.rel, d.title, "Open the screen in the browser.", { status: "info", group: "Screen designs" });
  add("releases", "docs/RELEASE-NOTES.md", "Release notes", "What each build added, ticket by ticket (as on main).", { status: "info" });
  add("releases", "docs/README.md", "User guide", "The app's README.md as on main.", { status: "info" });
  add("releases", "docs/business-overview.md", "Business overview", "What the product is, for whom, what it does.", { status: "info" });
  add("trace", `TRACE-${PID}.md`, "Trace", "Requirement → feature → story → ticket → commit → build → release.", { status: "info" });
  add("trace", `TRACE-${PID}.json`, "Trace (data)", "The same trace as data.", { status: "info" });
  add("trace", "PIPELINE-SUMMARY.md", "Pipeline summary", summaryLine, { status: "info" });
  add("trace", "runs/RUNS.md", "Engine runs", `${jobs.length} engine jobs with their role, status and result.`, { status: "info" });
  add("trace", "brief/ledger.jsonl", "Audit ledger", "Every job, output and person's action, with its sources (append only).", { status: "info" });
  for (const [f, t, d] of [["memory/context.md", "Context", "Where the project stands."], ["memory/decisions.md", "Decisions", "What was decided and answered."], ["memory/gaps.md", "Gaps", "Open questions and what the gates do not check yet."], ["memory/risks.md", "Risks", "Findings that need attention."], ["knowledge/dependencies.md", "Dependencies", "The app's packages."], ["knowledge/tech-debt.md", "Technical debt", "Leftover notes in the code."]] as const) add("memory", f, t, d, { status: "info" });
  if (crs.length) add("changes", "changes/CHANGES.md", "Change requests", `${crs.length} change request(s).`, { status: "info" });

  const SECTIONS: [string, string, string][] = [
    ["engine", "On the MADP engine", "How the product was set up on the official MADP engine: its checks on the dev branch as it was, and its languages."],
    ["brief", "What the client gave us", "The setup answers and the merged project brief."],
    ["requirements", "Requirements (BRD and PRD)", "The requirement phase: business and product requirements, questions and answers."],
    ["planning", "Plan and designs (01 planner)", "The planner's artifact, the work plan and the screen designs."],
    ["builds", "Builds (02 dev → 06 docs)", "Per milestone: the spec and the developer, review, test, security and docs reports of each build."],
    ["releases", "Releases (07 release)", "The gate decision of each environment, the release notes and the user guide."],
    ["changes", "Change requests", "Changes asked for after a release."],
    ["trace", "Trace and audit trail", "From requirement to release, every engine run and the ledger."],
    ["memory", "Memory and knowledge", "Context, decisions, gaps, risks, dependencies and technical debt."],
  ];
  const sections: OutputSection[] = SECTIONS.filter(([id]) => (items[id] ?? []).length > 0).map(([id, title, summary]) => ({ id, title, summary, items: items[id]! }));
  const latest = obj(pj.latestBuild);
  const facts = [
    { label: "Requirements", value: String(reqItems.length) },
    { label: "Features", value: String(features.length) },
    { label: "Tickets done", value: `${done} of ${tickets.length}` },
    { label: "Builds", value: String(Object.keys(builds).length) },
    ...(str(latest.version) ? [{ label: "Latest build", value: str(latest.version) }] : []),
    ...Object.entries(envs).map(([k, v]) => ({ label: `On ${ENV_LABEL[k] ?? k}`, value: str(obj(v).version) })),
    { label: "Engine jobs", value: String(jobs.length) },
  ];
  const manifest: OutputsManifest = { schema: "madp-outputs/1", projectId, workspaceId, name, pid: PID, generatedAt: now, summary: summaryLine, facts, sections, generated: [] };

  // ---------------------------------------------------------------- the index: README.md + index.html + outputs.json
  const md = [`# What MADP produced — ${name}`, "", summaryLine, "", facts.map((f) => `**${f.label}:** ${f.value}`).join(" · "), "", `_Generated ${day(now)} from the project folder (projects/${workspaceId}/${projectId}/). Open index.html for the same list in a browser._`, ""];
  for (const sec of sections) {
    md.push(`## ${sec.title}`, "", sec.summary, "");
    let group = "";
    for (const it of sec.items) {
      if ((it.group ?? "") !== group) {
        group = it.group ?? "";
        if (group) md.push("", `### ${group}`, "");
      }
      md.push(`- [${it.title}](${encodeURI(it.path)}) — ${it.summary}`);
    }
    md.push("");
  }
  md.push("## The project folder", "", "- `repo/` the app's git repository (main = the accepted code) · `worktrees/` one folder per branch · `builds/` what each preview serves", "- `jobs/<job>-<attempt>/` each engine job's prompt, transcript, logs, result and the context version it used · `inputs/` the files people shared · `logs/engine.log`", "");
  w.write("README.md", `${md.join("\n")}\n`);
  w.write("index.html", indexHtml(manifest));
  manifest.generated = [...new Set([...w.written, "outputs.json"])].sort();
  w.write("outputs.json", `${JSON.stringify(manifest, null, 2)}\n`);
  return manifest;
}

// ------------------------------------------------------------------------------------------------- index.html

const esc = (s: string): string => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
const BADGE: Record<string, string> = { pass: "Passed", fail: "Send back", hold: "On hold", open: "Open", info: "" };

export function indexHtml(m: OutputsManifest): string {
  const secs = m.sections
    .map((s) => {
      let group = "";
      const rows = s.items
        .map((it) => {
          const head = (it.group ?? "") !== group ? ((group = it.group ?? ""), group ? `<li class="group">${esc(group)}</li>` : "") : "";
          const badge = it.status && BADGE[it.status] ? `<span class="badge ${it.status}">${BADGE[it.status]}</span>` : "";
          return `${head}<li><a href="${esc(encodeURI(it.path))}">${esc(it.title)}</a>${badge}<div class="sum">${esc(it.summary)}</div><div class="meta">${esc(it.path)} · ${it.bytes < 1024 ? `${it.bytes} B` : `${Math.round(it.bytes / 1024)} kB`}</div></li>`;
        })
        .join("");
      return `<section><h2>${esc(s.title)}</h2><p class="lead">${esc(s.summary)}</p><ul>${rows}</ul></section>`;
    })
    .join("\n");
  const facts = m.facts.map((f) => `<div class="fact"><div class="v">${esc(f.value)}</div><div class="l">${esc(f.label)}</div></div>`).join("");
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>What MADP produced — ${esc(m.name)}</title>
<style>
:root{--bg:#f6f7fb;--card:#fff;--ink:#14161f;--mute:#5d6475;--line:#e3e6ef;--brand:#4f46e5;--pass:#0f7a4a;--passbg:#e3f5ec;--fail:#b42318;--failbg:#fde8e6;--hold:#9a5b00;--holdbg:#fff2d6;--open:#3b4cc0;--openbg:#e8ecff}
@media (prefers-color-scheme:dark){:root{--bg:#0f1117;--card:#171a23;--ink:#eef0f6;--mute:#9aa1b4;--line:#2a2f3d;--brand:#8b85ff;--passbg:#12301f;--pass:#5fd39a;--failbg:#3a1714;--fail:#ff8a7d;--holdbg:#3a2a0a;--hold:#f5c063;--openbg:#1d2347;--open:#9aa8ff}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:15px/1.5 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
header{padding:32px 16px 8px;max-width:1000px;margin:0 auto}.kicker{color:var(--brand);font-weight:600;font-size:13px;letter-spacing:.04em;text-transform:uppercase}
h1{margin:4px 0 6px;font-size:28px}.summary{color:var(--mute);margin:0 0 16px}
.facts{display:flex;flex-wrap:wrap;gap:8px;margin-bottom:8px}.fact{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:8px 12px;min-width:110px}.fact .v{font-weight:700;font-size:18px}.fact .l{color:var(--mute);font-size:12px}
main{max-width:1000px;margin:0 auto;padding:8px 16px 48px}section{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:18px 20px;margin:14px 0}
h2{margin:0 0 2px;font-size:18px}.lead{margin:0 0 10px;color:var(--mute);font-size:14px}ul{list-style:none;margin:0;padding:0}
li{padding:9px 0;border-top:1px solid var(--line)}li:first-child{border-top:0}li.group{font-weight:600;color:var(--brand);font-size:13px;padding-top:14px;border-top:0}
a{color:var(--ink);font-weight:600;text-decoration:none}a:hover{color:var(--brand);text-decoration:underline}.sum{color:var(--mute);font-size:14px}.meta{color:var(--mute);font-size:12px;opacity:.8;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;overflow-wrap:anywhere}
.badge{display:inline-block;margin-left:8px;font-size:12px;font-weight:600;padding:1px 8px;border-radius:99px;vertical-align:1px}.badge.pass{background:var(--passbg);color:var(--pass)}.badge.fail{background:var(--failbg);color:var(--fail)}.badge.hold{background:var(--holdbg);color:var(--hold)}.badge.open{background:var(--openbg);color:var(--open)}
footer{max-width:1000px;margin:0 auto;padding:0 16px 32px;color:var(--mute);font-size:12px}
</style></head><body>
<header><div class="kicker">What MADP produced</div><h1>${esc(m.name)}</h1><p class="summary">${esc(m.summary)}</p><div class="facts">${facts}</div></header>
<main>
${secs}
</main>
<footer>Generated ${esc(m.generatedAt.replace("T", " ").slice(0, 16))} UTC from projects/${esc(m.workspaceId)}/${esc(m.projectId)}/ · every link opens a file next to this page.</footer>
</body></html>
`;
}

/** The outputs of a project, written when its folder exists (after a job, hooks.ts). Never throws. */
export async function refreshOutputs(projectDir: string, log?: (line: string) => void): Promise<OutputsManifest | null> {
  try {
    if (!fs.existsSync(path.join(projectDir, "project.json"))) return null;
    return await writeProjectOutputs(projectDir);
  } catch (e) {
    log?.(`outputs: the index was not written (${e instanceof Error ? e.message : String(e)})`);
    return null;
  }
}
