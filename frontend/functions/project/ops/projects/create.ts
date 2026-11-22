import { SCRATCH_TITLE, checkNoteBody } from "../../../../src/domain/docs";
import { checkClientField, checkProjectName, type Check } from "../../../../src/domain/projects";
import {
  FACTORY_REPO_PROVIDER, NEW_REPO_BRANCH, REPO_MODE, checkBranch, checkNewRepo, checkRepoRef, isChoosableType, repoSlug,
  type ChoosableType, type RepoRef, type RepoVisibility,
} from "../../../../src/domain/projectType";
import { LIMITS, checkWebsite, normaliseWebUrl } from "../../../../src/domain/guidedStart";
import { BRIEF_TITLE, briefMarkdown, parseTestEnv } from "../../../../src/domain/projectBrief";
import { ok, strictArgs, type OpDef } from "./op";
import { F, SCHEMA } from "./records";

const CLIENT = ["clientName", "clientContact", "clientIndustry", "clientRegion"] as const;

/** The guided project start's free-text answers: logical name → the most characters kept (after trimming). */
export const SETUP_TEXT = { goal: 2000, targetUsers: 1000, runInstructions: 5000, blocksProjectRef: 200 } as const;
export const DESCRIPTION_MAX = 2000;
export type SetupTextKey = keyof typeof SETUP_TEXT;
export const SETUP_STATUSES = ["draft", "complete"] as const;
export type SetupStatus = (typeof SETUP_STATUSES)[number];
export const APP_URL_MAX = 500;
/** The official website's address (WebsiteUrl), after the https:// a bare host gets. */
export const WEBSITE_URL_MAX = LIMITS.website;
export const TEST_ENV_MAX = 2000;
export const SETUP_ANSWERS_MAX = 20000;
const TEST_ENV_AVAILABLE = ["yes", "no", "unsure"] as const;

/** What the guided start stores on the project; a key is present only when it was sent and non-empty. */
export type GuidedFields = Partial<Record<SetupTextKey | "appUrl" | "websiteUrl" | "testEnv" | "setupAnswers", string>> & { setupStatus?: SetupStatus };

/** The repository a project starts with: an existing one (brownfield, or greenfield into a prepared repo) or the new one MADP creates (greenfield). */
export type CreateRepo = (RepoRef & { kind: "existing" }) | (RepoRef & { kind: "new"; visibility: RepoVisibility });

export interface CreateArgs {
  workspaceId: string;
  name: string;
  client: Record<(typeof CLIENT)[number], string>;
  scratchMd: string;
  type: ChoosableType;
  /** Optional at creation: the Business step can add it before the hand-over. */
  repo: CreateRepo | null;
  guided: GuidedFields;
  /** The guided start's description of the project (written into the Project brief note, with the other answers). */
  description: string;
}

/** An http(s) address typed by a person (shared with the guided start's screens). */
export { normaliseWebUrl };

const isPlainObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

function parseJson(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return undefined;
  }
}

/** testEnv: {"available":"yes"|"no"|"unsure","url"?:string,"accessHow"?:string} → its normalised JSON (empty url/accessHow left out). */
export function checkTestEnv(raw: string): Check<string> {
  const v = parseJson(raw);
  if (!isPlainObject(v) || Object.keys(v).some((k) => k !== "available" && k !== "url" && k !== "accessHow")) {
    return { ok: false, messageKey: "project.testEnvInvalid" };
  }
  if (!(TEST_ENV_AVAILABLE as readonly unknown[]).includes(v.available)) return { ok: false, messageKey: "project.testEnvInvalid" };
  if ((v.url !== undefined && typeof v.url !== "string") || (v.accessHow !== undefined && typeof v.accessHow !== "string")) {
    return { ok: false, messageKey: "project.testEnvInvalid" };
  }
  const url = normaliseWebUrl((v.url as string | undefined) ?? "");
  if (url === null) return { ok: false, messageKey: "project.testEnvUrlInvalid" };
  const accessHow = ((v.accessHow as string | undefined) ?? "").trim();
  const out = JSON.stringify({ available: v.available, ...(url ? { url } : {}), ...(accessHow ? { accessHow } : {}) });
  return { ok: true, value: out };
}

/** setupAnswers: any JSON object, stored as its compact JSON string. */
export function checkSetupAnswers(raw: string): Check<string> {
  const v = parseJson(raw);
  return isPlainObject(v) ? { ok: true, value: JSON.stringify(v) } : { ok: false, messageKey: "project.setupAnswersInvalid" };
}

const filled = (v: unknown): v is string => typeof v === "string" && v.trim() !== "";

/** websiteUrl: an existing product's optional website, normalised ("" = none); refused unless it is an http(s) address. */
export function checkWebsiteUrl(raw: string): Check<string> {
  const w = checkWebsite(raw);
  if (w.ok) return { ok: true, value: w.value };
  return { ok: false, messageKey: w.problem === "tooLong" ? "project.websiteUrlTooLong" : "project.websiteUrlInvalid" };
}

export function parseGuided(r: Record<string, unknown>): Check<GuidedFields> {
  const out: GuidedFields = {};
  for (const [k, max] of Object.entries(SETUP_TEXT) as [SetupTextKey, number][]) {
    const v = ((r[k] as string | undefined) ?? "").trim();
    if (v.length > max) return { ok: false, messageKey: "project.textTooLong", params: { field: k, max } };
    if (v) out[k] = v;
  }
  if (r.appUrl !== undefined) {
    const url = normaliseWebUrl(r.appUrl as string);
    if (url === null) return { ok: false, messageKey: "project.appUrlInvalid" };
    if (url) out.appUrl = url;
  }
  if (r.websiteUrl !== undefined) {
    const w = checkWebsiteUrl(r.websiteUrl as string);
    if (!w.ok) return w;
    if (w.value) out.websiteUrl = w.value;
  }
  if (filled(r.testEnv)) {
    const t = checkTestEnv(r.testEnv);
    if (!t.ok) return t;
    out.testEnv = t.value;
  }
  if (filled(r.setupAnswers)) {
    const s = checkSetupAnswers(r.setupAnswers);
    if (!s.ok) return s;
    out.setupAnswers = s.value;
  }
  if (r.setupStatus !== undefined) {
    if (!(SETUP_STATUSES as readonly unknown[]).includes(r.setupStatus)) return { ok: false, messageKey: "input.wrongType", params: { key: "setupStatus" } };
    out.setupStatus = r.setupStatus as SetupStatus;
  }
  return { ok: true, value: out };
}

/** repo + repoBranch = an existing repository (any type); newRepoOwner + newRepoName + repoVisibility (+ repoBranch) = a new one (greenfield). */
function parseRepo(r: Record<string, unknown>, type: ChoosableType): Check<CreateRepo | null> {
  const fresh = filled(r.newRepoOwner) || filled(r.newRepoName) || filled(r.repoVisibility);
  if (fresh && filled(r.repo)) return { ok: false, messageKey: "project.repoMixed" };
  if (fresh) {
    if (type !== "greenfield") return { ok: false, messageKey: "project.notGreenfield" };
    const n = checkNewRepo((r.newRepoOwner as string | undefined) ?? "", (r.newRepoName as string | undefined) ?? "", ((r.repoVisibility as string | undefined) ?? "").trim());
    if (!n.ok) return { ok: false, messageKey: n.field === "owner" ? "project.repoOwnerInvalid" : n.field === "name" ? "project.repoNameInvalid" : "project.repoVisibilityInvalid" };
    const b = filled(r.repoBranch) ? checkBranch(r.repoBranch) : { ok: true as const, value: NEW_REPO_BRANCH };
    if (!b.ok) return { ok: false, messageKey: "project.branchInvalid" };
    return { ok: true, value: { kind: "new", owner: n.value.owner, name: n.value.name, visibility: n.value.visibility, branch: b.value } };
  }
  if (filled(r.repo) || filled(r.repoBranch)) {
    const ref = checkRepoRef((r.repo as string | undefined) ?? "", (r.repoBranch as string | undefined) ?? "");
    if (!ref.ok) return { ok: false, messageKey: ref.field === "repo" ? "project.repoInvalid" : "project.branchInvalid" };
    return { ok: true, value: { kind: "existing", ...ref.value } };
  }
  return { ok: true, value: null };
}

export const projectCreate: OpDef<CreateArgs, any> = {
  op: "project.create",
  permission: "project.create",
  scope: "workspace",
  // The project and its scratch note are insertOnce rows and the note's ProjectId fix-up is a repeatable patch, so a
  // rerun answers the same: on Host A the answer leaves once the fix-up has landed, before the AuditEvent and Operation
  // record of that round (the slowest writes of the request).
  bookkeepingAfterAnswer: true,
  parse(args) {
    const a = strictArgs(args, {
      workspaceId: { type: "string" },
      name: { type: "string", optional: true },
      clientName: { type: "string", optional: true },
      clientContact: { type: "string", optional: true },
      clientIndustry: { type: "string", optional: true },
      clientRegion: { type: "string", optional: true },
      scratchMd: { type: "string", optional: true },
      projectType: { type: "string", optional: true },
      repo: { type: "string", optional: true },
      repoBranch: { type: "string", optional: true },
      newRepoOwner: { type: "string", optional: true },
      newRepoName: { type: "string", optional: true },
      repoVisibility: { type: "string", optional: true },
      // The guided project start. Hard caps against oversized bodies; the trimmed limits are checked in parseGuided.
      goal: { type: "string", optional: true, max: 4 * SETUP_TEXT.goal },
      targetUsers: { type: "string", optional: true, max: 4 * SETUP_TEXT.targetUsers },
      runInstructions: { type: "string", optional: true, max: 4 * SETUP_TEXT.runInstructions },
      blocksProjectRef: { type: "string", optional: true, max: 4 * SETUP_TEXT.blocksProjectRef },
      appUrl: { type: "string", optional: true, max: 4 * APP_URL_MAX },
      websiteUrl: { type: "string", optional: true, max: 4 * WEBSITE_URL_MAX },
      testEnv: { type: "string", optional: true, max: TEST_ENV_MAX },
      setupAnswers: { type: "string", optional: true, max: SETUP_ANSWERS_MAX },
      setupStatus: { type: "string", optional: true },
      description: { type: "string", optional: true, max: 4 * DESCRIPTION_MAX },
    });
    if (!a.ok) return a;
    const r = a.value;
    const name = checkProjectName(r.name ?? "", { fallback: true });
    if (!name.ok) return name;
    const client = {} as CreateArgs["client"];
    for (const k of CLIENT) {
      const c = checkClientField(r[k], k);
      if (!c.ok) return c;
      client[k] = c.value;
    }
    const body = checkNoteBody(r.scratchMd ?? "");
    if (!body.ok) return body;
    const type = r.projectType ?? "greenfield";
    if (type === "greyfield") return { ok: false, messageKey: "project.typeDisabled" };
    if (!isChoosableType(type)) return { ok: false, messageKey: "input.wrongType", params: { key: "projectType" } };
    const repo = parseRepo(r, type);
    if (!repo.ok) return repo;
    const guided = parseGuided(r);
    if (!guided.ok) return guided;
    // only an existing product has a website: a new idea's is ignored
    if (type !== "brownfield") delete guided.value.websiteUrl;
    const description = ((r.description as string | undefined) ?? "").trim();
    if (description.length > DESCRIPTION_MAX) return { ok: false, messageKey: "project.textTooLong", params: { field: "description", max: DESCRIPTION_MAX } };
    return {
      ok: true,
      value: { workspaceId: r.workspaceId as string, name: name.value, client, scratchMd: body.value, type, repo: repo.value, guided: guided.value, description },
    };
  },
  async run(env, args) {
    // No repository is fine everywhere: MADP Factory then keeps the code itself (the engine's own git repository on
    // its host); GitHub can be connected later on the project's Code card.
    const repo = args.repo?.kind === "new" ? { ...args.repo, name: repoSlug(args.name) } : args.repo;
    if (repo) await env.ports.verifyRepository?.({ ...repo, ...(args.type === 'greenfield' && repo.kind === 'existing' ? { allowEmpty: true } : {}) });
    const fields: Record<string, unknown> = {
      [F.project.name]: args.name,
      [F.project.stage]: "business",
      [F.project.status]: "active",
      [F.project.assigneeUserId]: "",
      [F.project.repoMode]: REPO_MODE[args.type],
    };
    if (repo) {
      fields[F.project.repoProvider] = "github";
      fields[F.project.repoOwner] = repo.owner;
      fields[F.project.repoName] = repo.name;
      fields[F.project.repoBranch] = repo.branch;
      // S1's RepoExisting is a String: "owner/name" of an existing repository, "" for the one MADP creates.
      fields[F.project.repoExisting] = repo.kind === "existing" ? `${repo.owner}/${repo.name}` : "";
      if (repo.kind === "new") fields[F.project.repoVisibility] = repo.visibility;
    } else {
      fields[F.project.repoProvider] = FACTORY_REPO_PROVIDER;
    }
    for (const k of CLIENT) fields[F.project[k]] = args.client[k];
    for (const [k, v] of Object.entries(args.guided) as [keyof GuidedFields, string][]) {
      if (k === "blocksProjectRef" && env.ports.automaticBlocksProvisioning) continue;
      fields[F.project[k]] = v;
    }
    if (env.ports.automaticBlocksProvisioning) fields.BlocksProvisioningStatus = "pending";
    // One write round: the project and its scratch note are inserted together. The note's ProjectId is a placeholder
    // until the project's id is known; the fix-up runs in the router's bookkeeping round (beside the Operation record),
    // and the answer already carries the final ProjectId. Both rows are keyed by the requestId, so a retry is safe.
    const withNote = args.scratchMd.trim() !== "";
    // The guided start's answers also become the "Project brief" note at the top of the material (rewritten when they change).
    const g0 = args.guided;
    const briefBody = g0.setupAnswers ? briefMarkdown({
      name: args.name, existing: args.type === "brownfield", description: args.description, goal: g0.goal ?? "", targetUsers: g0.targetUsers ?? "",
      appUrl: g0.appUrl, testEnv: parseTestEnv(g0.testEnv), runInstructions: g0.runInstructions,
      blocksProjectRef: env.ports.automaticBlocksProvisioning ? undefined : g0.blocksProjectRef,
    }) : "";
    const [project, note, brief] = await Promise.all([
      env.insertOnce(SCHEMA.project, fields, "project"),
      withNote
        ? env.insertOnce(
            SCHEMA.note,
            {
              [F.note.projectId]: `pending:${env.requestId}`,
              [F.note.folderId]: "",
              [F.note.title]: SCRATCH_TITLE,
              [F.note.bodyMd]: args.scratchMd,
              [F.note.sortOrder]: 0,
              [F.note.isScratch]: true,
            },
            "scratch",
          )
        : Promise.resolve(null),
      briefBody
        ? env.insertOnce(
            SCHEMA.note,
            {
              [F.note.projectId]: `pending:${env.requestId}`,
              [F.note.folderId]: "",
              [F.note.title]: BRIEF_TITLE,
              [F.note.bodyMd]: briefBody,
              [F.note.sortOrder]: 0,
              [F.note.isScratch]: false,
              [F.note.isProjectBrief]: true,
            },
            "brief",
          )
        : Promise.resolve(null),
    ]);
    let briefNote;
    if (brief) {
      const briefId = brief.ItemId;
      env.after(() => env.ports.db.update(SCHEMA.note, briefId, env.stampUpdate({ [F.note.projectId]: project.ItemId })));
      briefNote = { ...brief, [F.note.projectId]: project.ItemId };
    }
    let scratchNote;
    if (note) {
      const noteId = note.ItemId;
      env.after(() => env.ports.db.update(SCHEMA.note, noteId, env.stampUpdate({ [F.note.projectId]: project.ItemId })));
      scratchNote = { ...note, [F.note.projectId]: project.ItemId };
    }
    const g = args.guided;
    await env.audit("project.create", SCHEMA.project, project.ItemId, {
      hasScratchNote: withNote,
      projectType: args.type,
      hasRepo: Boolean(repo),
      repoExisting: repo?.kind === "existing",
      hasGoal: Boolean(g.goal),
      hasAppUrl: Boolean(g.appUrl),
      hasWebsite: Boolean(g.websiteUrl),
      hasTestEnv: Boolean(g.testEnv),
      hasSetup: Boolean(g.setupAnswers),
      setupComplete: g.setupStatus === "complete",
    });
    return ok({ project, ...(scratchNote ? { scratchNote } : {}), ...(briefNote ? { briefNote } : {}) });
  },
};
