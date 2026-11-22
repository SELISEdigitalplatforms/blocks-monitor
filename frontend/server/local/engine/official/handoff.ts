// What the official lanes' agents need besides the work description: the product's client-approved design and the
// files people attached to the work. Before a lane runs (build.ts runOfficialWork) they are copied into the working
// tree of every repository of the product's registry, where the official dev agent's spec looks for them
// (engine/selise-madp/MADP/agents/02-dev/AGENT.md, "Step 1.5"):
//   .madp/design/                    the approved design: handoff.json, design-master.md, ux-plan.md, screens.json, the
//                                    exported screen PNGs and the optional design-tokens.json of a native Figma design;
//                                    figma-make.md (and prototype.html) of a Figma Make or Factory prototype
//   .madp/feedback/<run>/<owner>/…   the files attached to the work's tickets (<ticket id>) and change requests (cr-<id>)
//   .madp/runs/<run>                 a run that uses the folder now (two runs of a product may wait for the same repo)
// The work description names them (handoffBlock, its "Design" section) for the planner and the dev agents.
//
// They never reach a commit: .madp/ is in the repository's info/exclude, and before the lane starts git must report
// nothing under .madp/ (no tracked file, no untracked one), so the lanes' preflight sees no dirty file and their
// commits (only the files the agents changed) cannot include them. removeHandoff takes this run's copies out again
// after the lane; the design and the folder go when no other run of the product still uses them.
//
// Restored from the template builder's build/attachments.ts and build/prompt.ts (removed in a1f5777f), for the lanes.
// A product without an approved Figma design and a work without attached files leave the repositories untouched and
// the description exactly as it was. A Figma design that is not approved for the current requirements, or whose
// approved artifact cannot be verified and placed, stops the work before the lane starts (fail closed, as before).
import fs from "node:fs";
import path from "node:path";
import { changeCode } from "../../../../src/domain/delivery";
import { parseChangeAnalysis } from "../../../../src/domain/changeAnalysis";
import { automaticDesignDirection, designSource, rawDesignRequirements } from "../../../../src/domain/figmaMake";
import { designSourceCurrent, designSourcesOf, parseProductPrototype } from "../../../../src/domain/factoryDesign";
import { parseDesignTokens } from "../../../../src/domain/designTokens.ts";
import { ATTACHMENT_OWNERS, attachmentRows, attachmentsOf, type AttachedFile } from "../ai/attachments.ts";
import type { BuildTicket } from "../build/prompt.ts";
import { excludeFromCommits, git } from "../build/workspace.ts";
import { num, str } from "../context.ts";
import { JobFailure, type JobRun } from "../run.ts";

/** The Factory's folder in a repository's working tree ("/" separated, as the description names it). */
export const MADP_DIR = ".madp";
/** The client-approved design handoff. */
export const DESIGN_DIR = ".madp/design";
/** The files people attached, one folder per run. */
export const FEEDBACK_DIR = ".madp/feedback";
/** One marker per run that uses the folder now. */
const RUNS_DIR = ".madp/runs";
/** A run marker older than this is left over from a stopped engine (a lane runs at most about three hours, waiting for
 *  the repository lock included). */
const LIVE_MS = 6 * 3600_000;

type Content = string | Uint8Array;

/** A plain file or folder name: letters, digits, dot, dash and underscore; never empty, never hidden (pure). */
export function safeFileName(name: string, max = 100): string {
  const ext = /(\.[A-Za-z0-9]{1,8})$/.exec(name)?.[1] ?? "";
  const clean = (s: string) => s.normalize("NFKD").replace(/[^\w.\- ]+/g, "").replace(/\s+/g, "-").replace(/^[.\-]+/, "");
  const stem = clean(ext ? name.slice(0, -ext.length) : name).slice(0, Math.max(1, max - ext.length)) || "file";
  return `${stem}${ext.toLowerCase()}`;
}

/** The run's folder name under .madp/feedback and .madp/runs (the same as its work file's name). */
export const runKey = (id: string): string => id.replace(/[^A-Za-z0-9_-]/g, "").slice(0, 24) || "run";

// ------------------------------------------------------------------ the approved design

export interface DesignScreen {
  name: string;
  nodeId: string;
  requirementKeys: string[];
  /** The exported PNG in .madp/design. */
  file: string;
}

export interface DesignHandoff {
  provider: "figma-design" | "figma-make" | "factory";
  revision: string;
  approvedAt: string | null;
  /** The file the description names first, in .madp/design: handoff.json (native Figma) or figma-make.md. */
  entry: string;
  /** Native Figma: the approved frames and their exported PNGs. */
  screens: DesignScreen[];
  /** Native Figma: design-tokens.json is there. */
  tokens: boolean;
  /** A Factory prototype: prototype.html is there. */
  prototype: boolean;
  /** The files of .madp/design (name -> content). */
  files: Record<string, Content>;
}

function designFailure(run: JobRun, stage: string, error: unknown): JobFailure {
  const code = (error as { code?: unknown })?.code;
  run.writeJobFile("design-handoff-error.json", { stage, type: error instanceof Error ? error.name : "Error", ...(typeof code === "string" && /^[A-Z_]+$/.test(code) ? { code } : {}) });
  run.log(`approved design handoff failed during ${stage}`);
  return new JobFailure("The approved design handoff could not be verified or safely copied. Restore its matching Storage artifact and retry; the build did not start.", "design.figmaHandoffRequired");
}

/** The product's approved Figma design, read from its Storage artifact and checked against the approved revision; null
 *  when the product has no Figma design (Look and feel not in Figma mode). A Figma design must be the exact approved,
 *  current revision: anything else stops the work before Storage is read. */
export async function approvedDesign(run: JobRun): Promise<DesignHandoff | null> {
  const brief = run.p.designBrief();
  if (!brief || brief.Mode !== "figma") return null;
  const proto = parseProductPrototype(brief.PrototypeJson);
  const requirements = rawDesignRequirements(run.p.requirements());
  const sources = proto && proto.provider !== "figma-make" ? designSourcesOf(run.p) : { source: designSource(automaticDesignDirection(requirements), requirements) };
  if (brief.Status !== "confirmed" || !requirements.length || !proto || !designSourceCurrent(proto.source, sources) || (proto.provider === "figma-design" && proto.reviewComplete === false)) {
    throw new JobFailure("Approve an interactive design revision matching the current goals and requirements before building.", "design.figmaApprovalRequired");
  }
  const approvedAt = str(brief.ConfirmedAt) || null;
  let stage = "read-storage-artifact";
  try {
    const bytes = await run.readFile(proto.artifactFileId);
    if (!bytes) throw new Error("the artifact is not in storage");
    stage = "validate-storage-artifact";
    const artifact = JSON.parse(new TextDecoder().decode(bytes));
    if (!artifact || artifact.provider !== proto.provider || artifact.projectUrl !== proto.projectUrl ||
        artifact.revision !== proto.revision || artifact.source !== proto.source || artifact.jobId !== proto.jobId) {
      throw new Error("the artifact does not match the approved revision");
    }
    const master = typeof artifact.designMaster === "string" ? artifact.designMaster.trim() : "";
    const plan = typeof artifact.uxPlan === "string" ? artifact.uxPlan.trim() : "";
    if (!master || !plan) throw new Error("the artifact holds no design handoff or UX plan");
    const files: Record<string, Content> = {
      "figma-make.md": `# Approved interactive product design\n\n${JSON.stringify({ provider: proto.provider, revision: proto.revision, projectUrl: proto.projectUrl, source: proto.source, approvedAt })}\n\n${master}\n\n---\n\n# UX plan\n\n${plan}\n`,
    };
    const out: DesignHandoff = { provider: proto.provider, revision: proto.revision, approvedAt, entry: "figma-make.md", screens: [], tokens: false, prototype: false, files };
    if (proto.provider === "figma-design") {
      if (!Array.isArray(artifact.screens) || artifact.screens.length !== proto.screens.length) throw new Error("Screen exports are missing");
      const manifest = artifact.screens.map((s: { nodeId?: unknown; png?: unknown }, i: number) => {
        if (s.nodeId !== proto.screens[i]!.nodeId || typeof s.png !== "string" || !/^[A-Za-z0-9+/]+={0,2}$/.test(s.png)) throw new Error("Screen export mismatch");
        const png = Buffer.from(s.png, "base64");
        if (png.length > 5 * 1024 * 1024 || png.subarray(0, 8).toString("hex") !== "89504e470d0a1a0a") throw new Error("Invalid PNG export");
        const file = `screen-${i + 1}.png`;
        files[file] = png;
        return { ...proto.screens[i]!, file };
      });
      files["screens.json"] = JSON.stringify(manifest, null, 2);
      files["design-master.md"] = master;
      files["ux-plan.md"] = plan;
      const tokens = parseDesignTokens(artifact.tokens);
      if (artifact.tokens && !tokens) run.log("design tokens: invalid optional metadata ignored");
      if (tokens) files["design-tokens.json"] = JSON.stringify(tokens, null, 2);
      files["handoff.json"] = JSON.stringify({
        provider: proto.provider, projectId: run.projectId, projectUrl: proto.projectUrl,
        revision: proto.revision, source: proto.source, jobId: proto.jobId,
        artifactFileId: proto.artifactFileId, approvedAt,
        designMaster: "design-master.md", uxPlan: "ux-plan.md", screens: manifest,
        ...(tokens ? { tokens: "design-tokens.json" } : {}),
      }, null, 2);
      out.entry = "handoff.json";
      out.tokens = Boolean(tokens);
      out.screens = manifest.map((s: DesignScreen) => ({ name: s.name, nodeId: s.nodeId, requirementKeys: s.requirementKeys, file: s.file }));
    }
    if (proto.provider === "factory") {
      if (typeof artifact.html !== "string" || !artifact.html.trim() || artifact.projectId !== run.projectId) throw new Error("the prototype source is missing");
      files["prototype.html"] = artifact.html;
      out.prototype = true;
    }
    return out;
  } catch (error) {
    throw designFailure(run, stage, error);
  }
}

// ------------------------------------------------------------------ the files people attached

/** A file a person attached to what this work builds, as the agents find it in each repository. */
export interface BuildFile {
  /** Where it is in each repository (".madp/feedback/<run>/<ticket id | cr-<id>>/<name>", "/" separated); "" when it
   *  could not be copied there. */
  path: string;
  name: string;
  /** "image" (open it with the Read tool), "document" (its text is in `text`) or "other". */
  kind: "image" | "document" | "other";
  mime: string;
  /** What it was attached to: "their feedback on ticket #12 (The total is wrong)", "the change request CR-003 (…)". */
  owner: string;
  /** The change request's question whose answer it came with, "" otherwise. */
  question: string;
  /** A document's text (clipped), "" otherwise. */
  text: string;
}

/** The question of a change request's analysis a file's answer belongs to (Meta {"questionId"}), or "". */
function questionOf(meta: unknown, questions: ReadonlyMap<string, string>): string {
  if (typeof meta !== "string" || !meta.trim().startsWith("{")) return "";
  try {
    const id = (JSON.parse(meta) as { questionId?: unknown }).questionId;
    return typeof id === "string" ? (questions.get(id) ?? "") : "";
  } catch {
    return "";
  }
}

interface Owner {
  ownerType: string;
  ownerId: string;
  /** The folder under the run's feedback folder. */
  folder: string;
  /** What the description says it was attached to. */
  label: string;
  /** Question id -> its text (a change request's analysis). */
  questions: Map<string, string>;
}

/** The owners of the work's tickets: each ticket, and each change request a ticket belongs to. */
function ownersOf(run: JobRun, tickets: readonly BuildTicket[]): Owner[] {
  const out: Owner[] = [];
  const crs = new Set<string>();
  for (const t of tickets) {
    if (!t.id) continue;
    out.push({ ownerType: ATTACHMENT_OWNERS.ticket, ownerId: t.id, folder: safeFileName(t.id, 64), label: `their feedback on ticket #${t.number} (${t.title})`, questions: new Map() });
    const crId = str(run.p.row("Ticket", t.id)?.ChangeRequestId);
    if (crId) crs.add(crId);
  }
  for (const crId of crs) {
    const cr = run.p.row("ChangeRequest", crId);
    const code = cr ? changeCode({ lane: str(cr.Lane), number: num(cr.Number, 1) || 1 }) : "";
    const title = str(cr?.Title);
    const questions = new Map((parseChangeAnalysis(cr?.Analysis)?.questions ?? []).map((q) => [q.id, q.text] as const));
    out.push({ ownerType: ATTACHMENT_OWNERS.changeRequest, ownerId: crId, folder: `cr-${safeFileName(crId, 60)}`, label: `the change request${code ? ` ${code}` : ""}${title ? ` (${title})` : ""}`, questions });
  }
  return out;
}

/** Script and source names get ".txt": a repository's own checks (lint, tests) never pick an attached file up. */
const CODE_EXT = /\.(?:[cm]?[jt]sx?|vue|svelte|py|sh|ps1|rb|go|java|cs|php)$/i;

/** One attached file's name and content in the run's feedback folder; content null when nothing can be copied. */
function copyOf(base: string, f: AttachedFile, taken: Set<string>): { rel: string; content: Content | null } {
  let name = safeFileName(f.name);
  const copy = Boolean(f.path && fs.existsSync(f.path));
  // a document read only as text (no copy of the file itself) is written as that text
  const asText = !copy && !f.image && f.kind === "document";
  if (asText && !/\.(md|txt|csv)$/i.test(name)) name = `${name}.txt`;
  if (CODE_EXT.test(name)) name = `${name}.txt`;
  const ext = path.extname(name);
  for (let n = 2; taken.has(`${base}/${name}`.toLowerCase()); n++) name = `${path.basename(name, ext)}-${n}${ext}`;
  taken.add(`${base}/${name}`.toLowerCase());
  const content = copy ? new Uint8Array(fs.readFileSync(f.path!)) : f.image ? f.image : asText ? f.text : null;
  return { rel: `${base}/${name}`, content };
}

interface WorkFiles {
  files: BuildFile[];
  /** files[i]'s content (null: named without a path). */
  contents: (Content | null)[];
}

/** The files people attached to the work's open tickets and their change requests; never throws. */
async function workFiles(run: JobRun, tickets: readonly BuildTicket[], key: string): Promise<WorkFiles> {
  const out: WorkFiles = { files: [], contents: [] };
  let owners: Owner[];
  try {
    owners = ownersOf(run, tickets).filter((o) => attachmentRows(run, o.ownerType, [o.ownerId]).length > 0);
  } catch (e) {
    run.log(`work attachments: not read (${e instanceof Error ? e.message.slice(0, 120) : "error"})`);
    return out;
  }
  const taken = new Set<string>();
  for (const o of owners) {
    const meta = new Map(attachmentRows(run, o.ownerType, [o.ownerId]).map((r) => [str(r.ItemId), r.Meta] as const));
    for (const f of await attachmentsOf(run, o.ownerType, [o.ownerId])) {
      let c: { rel: string; content: Content | null } = { rel: "", content: null };
      try {
        c = copyOf(`${FEEDBACK_DIR}/${key}/${o.folder}`, f, taken);
      } catch (e) {
        run.log(`work attachments: ${f.name} not copied (${e instanceof Error ? e.message.slice(0, 120) : "error"})`);
      }
      out.files.push({ path: c.content === null ? "" : c.rel, name: f.name, kind: f.kind, mime: f.mime, owner: o.label, question: questionOf(meta.get(f.id), o.questions), text: f.kind === "document" ? f.text : "" });
      out.contents.push(c.content);
    }
  }
  return out;
}

// ------------------------------------------------------------------ placing and removing

/** What one run placed (handed to describeWork, then to removeHandoff). */
export interface Handoff {
  key: string;
  /** The repositories it was placed in. */
  repos: string[];
  design: DesignHandoff | null;
  attachments: BuildFile[];
}

const at = (repo: string, rel: string): string => path.join(repo, ...rel.split("/"));

function write(repo: string, rel: string, content: Content): void {
  const file = at(repo, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
}

/** The design into .madp/design, whole: written next to it first, then put in place of an earlier copy. */
function writeDesign(repo: string, key: string, d: DesignHandoff): void {
  const tmp = at(repo, `${MADP_DIR}/design.${key}.tmp`);
  fs.rmSync(tmp, { recursive: true, force: true });
  fs.mkdirSync(tmp, { recursive: true });
  for (const [name, body] of Object.entries(d.files)) fs.writeFileSync(path.join(tmp, name), body);
  const dir = at(repo, DESIGN_DIR);
  fs.rmSync(dir, { recursive: true, force: true });
  fs.renameSync(tmp, dir);
}

/** The paths of the repository this run writes (and removes again). */
const ownPaths = (key: string): string[] => [DESIGN_DIR, `${MADP_DIR}/design.${key}.tmp`, `${FEEDBACK_DIR}/${key}`, RUNS_DIR];

/** Throws when the repository has files of its own where the handoff goes: they are never overwritten or removed. */
function assertFree(repo: string, key: string): void {
  if (git(repo, ["ls-files", "--", ...ownPaths(key)]) !== "") throw new Error(`the repository tracks files under ${MADP_DIR}`);
}

/** Throws unless git keeps the placed files out: nothing reported by git status, which is what the lanes' preflight
 *  (its dirty check) and their commits see. */
function assertKeptOut(repo: string, key: string): void {
  if (git(repo, ["status", "--porcelain=v1", "--untracked-files=all", "--", ...ownPaths(key)]) !== "") throw new Error(`git does not ignore ${MADP_DIR}`);
}

const rm = (p: string): void => {
  try {
    fs.rmSync(p, { recursive: true, force: true });
  } catch {
    /* gone already, or the next run replaces it */
  }
};

/** Another run of the product uses the repository's .madp/ now (a fresh marker other than this run's). */
function othersLive(repo: string, key: string): boolean {
  try {
    const dir = at(repo, RUNS_DIR);
    return fs.readdirSync(dir).some((n) => n !== key && Date.now() - fs.statSync(path.join(dir, n)).mtimeMs < LIVE_MS);
  } catch {
    return false;
  }
}

/** Takes this run's copies out of the repositories again; the design and the folder too when no other run of the
 *  product still uses them. Never throws. */
export function removeHandoff(h: Handoff): void {
  for (const repo of h.repos) {
    rm(at(repo, `${FEEDBACK_DIR}/${h.key}`));
    rm(at(repo, `${MADP_DIR}/design.${h.key}.tmp`));
    rm(at(repo, `${RUNS_DIR}/${h.key}`));
    if (othersLive(repo, h.key)) continue;
    for (const d of [DESIGN_DIR, FEEDBACK_DIR, RUNS_DIR]) rm(at(repo, d));
    try {
      fs.rmdirSync(at(repo, MADP_DIR));
    } catch {
      /* not empty (the repository's own files) or not there */
    }
  }
}

/** Places the product's approved design and the work's attached files in every repository before the lane runs, kept
 *  out of git (see the top). Nothing to place: the repositories are not touched. Throws a JobFailure when a Figma
 *  design is not approved or cannot be placed; attached files that cannot be placed are named without a path. */
export async function placeHandoff(run: JobRun, repos: readonly string[], tickets: readonly BuildTicket[]): Promise<Handoff> {
  const key = runKey(run.id);
  const design = await approvedDesign(run);
  const found = await workFiles(run, tickets.filter((t) => !t.done), key);
  const h: Handoff = { key, repos: [], design, attachments: found.files };
  if (!design && !found.files.length) return h;
  const failed = new Set<number>();
  for (const repo of repos.map((r) => path.resolve(r))) {
    let stage = "exclude-private-files";
    try {
      assertFree(repo, key);
      h.repos.push(repo);
      excludeFromCommits(repo, `${MADP_DIR}/`);
      write(repo, `${RUNS_DIR}/${key}`, `${JSON.stringify({ job: run.id, at: new Date().toISOString() })}\n`);
      stage = "copy-approved-handoff";
      if (design) writeDesign(repo, key, design);
      found.files.forEach((f, i) => {
        const content = found.contents[i];
        if (!f.path || content === null || content === undefined || failed.has(i)) return;
        try {
          write(repo, f.path, content);
        } catch (e) {
          failed.add(i);
          run.log(`work attachments: ${f.name} not copied (${e instanceof Error ? e.message.slice(0, 120) : "error"})`);
        }
      });
      stage = "keep-out-of-commits";
      assertKeptOut(repo, key);
    } catch (e) {
      removeHandoff(h);
      if (design) throw designFailure(run, stage, e);
      run.log(`work attachments: not copied into the repositories, ${MADP_DIR}/ could not be kept out of the commits (${e instanceof Error ? e.message.slice(0, 120) : "error"})`);
      return { key, repos: [], design: null, attachments: found.files.map((f) => ({ ...f, path: "" })) };
    }
  }
  h.attachments = found.files.map((f, i) => (failed.has(i) ? { ...f, path: "" } : f));
  if (design) run.log(`design handoff: approved ${design.provider} revision ${design.revision} in ${DESIGN_DIR} of ${h.repos.length} repo(s)`);
  if (h.attachments.length) run.log(`work attachments: ${h.attachments.filter((f) => f.path).length} of ${h.attachments.length} attached files in ${FEEDBACK_DIR}/${key}`);
  return h;
}

// ------------------------------------------------------------------ the description's "Design" section

const FILE_TEXT_MAX = 3000;
const FILES_TEXT_BUDGET = 9000;

/** The files people attached, grouped by what they were attached to (pure; "" when there are none). */
export function attachedFilesBlock(files: readonly BuildFile[]): string {
  if (!files.length) return "";
  const owners = [...new Set(files.map((f) => f.owner))];
  let budget = FILES_TEXT_BUDGET;
  const parts = owners.map((owner) => {
    const lines = files.filter((f) => f.owner === owner).map((f) => {
      const where = f.path || f.name;
      const answer = f.question ? ` (attached to their answer to the question: ${f.question.trim()})` : "";
      if (f.kind === "image") {
        return f.path
          ? `  - ${where}${answer}: a picture. Open it with the Read tool, look at it closely and follow it.`
          : `  - ${where}${answer}: a picture that could not be copied here; go by the ticket's words.`;
      }
      if (f.kind === "document" && f.text.trim()) {
        const room = Math.max(0, Math.min(FILE_TEXT_MAX, budget));
        const body = f.text.trim().length > room ? `${f.text.trim().slice(0, room)}\n[…the rest is in the file]` : f.text.trim();
        budget -= body.length;
        const head = `  - ${where}${answer}: a document${f.path ? " (open it with the Read tool for all of it)" : ""}.`;
        return room > 200 ? `${head} What it says:\n"""\n${body}\n"""` : head;
      }
      return f.path
        ? `  - ${where}${answer}: a file (${f.mime || "unknown type"}); open it with the Read tool if it helps.`
        : `  - ${where}${answer}: a file that could not be copied here.`;
    });
    return `- For ${owner}:\n${lines.join("\n")}`;
  });
  return [
    "### Files people attached",
    `People attached these files to what this work builds. They show what they want: follow them together with the tickets. Every repository of this work has them under ${FEEDBACK_DIR}/ (paths relative to the repository).`,
    parts.join("\n"),
  ].join("\n");
}

/** The approved design: where it is and how the planner and the dev agents use it (pure). */
export function designBlock(d: DesignHandoff): string {
  const of = (name: string) => `${DESIGN_DIR}/${name}`;
  const out: string[] = [];
  if (d.provider === "figma-design") {
    out.push(
      `### Approved screen design (native Figma, revision ${d.revision}${d.approvedAt ? `, approved ${d.approvedAt.slice(0, 10)}` : ""})`,
      `The client approved this product's screens. MADP placed the approved design handoff in every repository of this work, under ${DESIGN_DIR}/ (paths relative to the repository):`,
      `- ${of("handoff.json")}: the approved handoff (provider, revision, source, artifact, the files below and each frame's requirement keys). Read it first.`,
      `- ${of("design-master.md")}: the design specification (tokens, components, per-screen layout, interaction states).`,
      `- ${of("ux-plan.md")}: the journeys, mapped to the requirements.`,
      `- ${of("screens.json")}: the frame manifest. The exported screens:`,
      ...d.screens.map((s) => `  - ${of(s.file)}: ${s.name} (Figma frame ${s.nodeId}${s.requirementKeys.length ? `; requirements ${s.requirementKeys.join(", ")}` : ""})`),
    );
    if (d.tokens) out.push(`- ${of("design-tokens.json")}: validated design tokens. Use its semantic colors, fontFamily, fontSize, spacing and borderRadius in the app's theme; map them deliberately onto the existing theme, never replace it wholesale.`);
    out.push(
      "",
      "How to use it:",
      "- Planning: give every step that writes a screen the screen files and frame IDs it implements, and tell it to open them.",
      "- Developing: before coding a screen, read handoff.json, design-master.md, ux-plan.md and screens.json, and open the PNG of every screen you implement with the Read tool. Match its layout, typography, spacing, components, responsive behaviour and states. Report the revision and the frame IDs you implemented in your final lines.",
      "- If a Figma MCP is available it is read-only: inspect only the recorded file and frame IDs, never edit Figma, and report drift from the approved exports instead of adopting it.",
    );
  } else {
    out.push(
      `### Approved product design (${d.provider === "factory" ? "the Factory's interactive prototype" : "Figma Make"}, revision ${d.revision}${d.approvedAt ? `, approved ${d.approvedAt.slice(0, 10)}` : ""})`,
      `The client approved this product's screen designs. MADP placed the design handoff in every repository of this work at ${of("figma-make.md")} (relative to the repository): open it with the Read tool and follow it for the screens this work writes: layout, hierarchy, navigation, visual direction (colours, type, spacing, components) and the states it names.`,
    );
    if (d.prototype) out.push(`${of("prototype.html")} is the approved prototype's source: read it for structure and look; write this app's own code, never copy it wholesale.`);
  }
  out.push(
    "- The requirements and the tickets decide what the app does; the design decides what people see and how screens behave. If they conflict, or a screen's design files are missing, report it instead of inventing a design.",
    `- The files under ${MADP_DIR}/ are not part of the app: never import, link or load anything from them, never edit, move or delete them, and never mention them in the interface. MADP removes them after this work.`,
  );
  return out.join("\n");
}

/** The description's "Design" section: the approved design and the files people attached ("" when there is neither). */
export function handoffBlock(h: Pick<Handoff, "design" | "attachments">): string {
  const parts = [h.design ? designBlock(h.design) : "", attachedFilesBlock(h.attachments)].filter(Boolean);
  return parts.length ? `## Design\n${parts.join("\n\n")}` : "";
}
