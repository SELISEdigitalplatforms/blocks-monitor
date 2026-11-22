/** Change requests after a release and the dev / stage environments: pure rules (lanes, numbering, versions,
 *  validation, history). No React, DOM, store or db here, and no clock: callers pass the time. */
import type { Role, StageId } from "./types";
import { STAGES } from "./pipeline";

export type Lane = "change" | "enhance" | "add" | "fix";
export type ChangeStatus = "draft" | "building" | "released-dev" | "promoted-stage";
export type EnvId = "dev" | "stage";
export type WorkspaceRole = "owner" | "member" | "viewer";
export type TargetType = "feature" | "requirement";

export interface ChangeAttachmentMeta { id: string; changeRequestId: string; name: string; mime: string; size: number }
export interface ChangeRequest {
  id: string; projectId: string; number: number; lane: Lane; featureRef: string; title: string; description: string;
  status: ChangeStatus;
  /** "" until the build starts */
  version: string;
  createdBy: string; createdAt: string; updatedAt: string; attachments: ChangeAttachmentMeta[];
}
export interface Release { id: string; projectId: string; env: EnvId; version: string; url: string; changeRequestIds: string[]; releasedAt: string }
export interface EnvState {
  env: EnvId; released: boolean; version: string | null; url: string; releasedAt: string | null;
  /** this environment's releases, newest first */
  history: Release[];
}
export interface ChangeInput { lane: Lane; featureRef: string; title: string; description: string }
export interface ImpactStory { id: string; no: number | null; text: string; isNew: boolean }
export interface Impact { stories: ImpactStory[]; screens: string[]; stages: StageId[]; hours: number }
export interface FeatureVersion { version: string; text: string; lane: Lane | null; code: string | null }
export interface AddedFeature { id: string; ref: string; name: string; plain: string; version: string; code: string }
export interface ChangeBadge { lane: Lane; version: string; label: string }

export const LANES: Lane[] = ["change", "enhance", "add"];
export const ALL_LANES: Lane[] = [...LANES, "fix"];
export const LANE_META: Record<Lane, { label: string; line: string; example: string; badge: string }> = {
  change: { label: "Change feature", line: "The business changed and the feature works differently now.", example: "Email and password login becomes OTP login.", badge: "Changed" },
  enhance: { label: "Enhance feature", line: "A partial change or an addition to the feature.", example: "Add multi-factor authentication to login.", badge: "Enhanced" },
  add: { label: "Add feature", line: "A new feature.", example: "Export orders to CSV.", badge: "New" },
  fix: { label: "Fix", line: "Something does not work as the scope says; MADP fixes it.", example: "The price list shows the prices of the previous month after 18:00.", badge: "Fix" },
};
export const ENVIRONMENTS: EnvId[] = ["dev", "stage"];
export const ENV_LABEL: Record<EnvId, string> = { dev: "Dev", stage: "Stage" };
export const FIRST_VERSION = "1.0";
export const CR_MAX_ATTACHMENTS = 5;
export const CR_MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;

const CHANGE_STATUSES: readonly string[] = ["draft", "building", "released-dev", "promoted-stage"];
export const isLane = (v: unknown): v is Lane => typeof v === "string" && (ALL_LANES as string[]).includes(v);
export const isChangeStatus = (v: unknown): v is ChangeStatus => typeof v === "string" && CHANGE_STATUSES.includes(v);
export const isEnv = (v: unknown): v is EnvId => typeof v === "string" && (ENVIRONMENTS as string[]).includes(v);
export const isReleased = (status: ChangeStatus): boolean => status === "released-dev" || status === "promoted-stage";

/* ── numbering and versions ── */

export const crCode = (n: number): string => `CR-${String(n).padStart(3, "0")}`;
/** The Release page parameter that opens a change request draft. */
export const CHANGE_PARAM = "change";
/** The Release page URL that opens the draft with this number, from any page. */
export const changeRequestUrl = (projectId: string, number: number): string => `/p/${projectId}/delivered?${CHANGE_PARAM}=${number}`;
export const fixCode =(n: number): string => `FX-${n}`;
type NumberedRequest = { id: string; number: number; lane: Lane };
/** A fix is numbered among the fixes only: 1 + the other fixes with a smaller number. */
export const fixNumberOf = (cr: NumberedRequest, requests: NumberedRequest[]): number =>
  1 + requests.filter((r) => r.lane === "fix" && r.id !== cr.id && r.number < cr.number).length;
export const changeCode = (cr: NumberedRequest, requests: NumberedRequest[]): string =>
  cr.lane === "fix" ? fixCode(fixNumberOf(cr, requests)) : crCode(cr.number);
export const nextCrNumber = (numbers: number[]): number => (numbers.length ? Math.max(...numbers) + 1 : 1);

const parts = (v: string): [number, number, number] => {
  const [a, b, c] = v.split(".");
  return [parseInt(a, 10) || 0, parseInt(b ?? "0", 10) || 0, parseInt(c ?? "0", 10) || 0];
};
export function compareVersions(a: string, b: string): number {
  const [a1, a2, a3] = parts(a);
  const [b1, b2, b3] = parts(b);
  return a1 !== b1 ? a1 - b1 : a2 !== b2 ? a2 - b2 : a3 - b3;
}
/** The first release is 1.0; each later release is the highest released version with the minor + 1. */
export function nextVersion(released: string[]): string {
  if (!released.length) return FIRST_VERSION;
  const top = released.reduce((m, v) => (compareVersions(v, m) > 0 ? v : m));
  const [major, minor] = parts(top);
  return `${major}.${minor + 1}`;
}
/** A fix is a patch: the highest released version with the patch + 1. */
export function nextFixVersion(released: string[]): string {
  if (!released.length) return `${FIRST_VERSION}.1`;
  const top = released.reduce((m, v) => (compareVersions(v, m) > 0 ? v : m));
  const [major, minor, patch] = parts(top);
  return `${major}.${minor}.${patch + 1}`;
}
export const versionLabel = (v: string): string => `v${v}`;

/* ── references ── */

export const featureRef = (type: TargetType, id: string): string => `${type}:${id}`;
export function parseFeatureRef(ref: string): { type: TargetType; id: string } | null {
  const i = ref.indexOf(":");
  if (i < 0) return null;
  const type = ref.slice(0, i);
  const id = ref.slice(i + 1);
  return (type === "feature" || type === "requirement") && id ? { type, id } : null;
}

/* ── environments ── */

export function projectSlug(name: string): string {
  const slug = name.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return slug || "portal";
}
export const envHost = (env: EnvId, slug: string): string => `${env}.${slug}.selise.app`;
export const envUrl = (env: EnvId, slug: string): string => `https://${envHost(env, slug)}`;

export function environmentsOf(releases: Release[], slug: string): Record<EnvId, EnvState> {
  const one = (env: EnvId): EnvState => {
    const history = releases.filter((r) => r.env === env)
      .sort((a, b) => compareVersions(b.version, a.version) || (a.releasedAt < b.releasedAt ? 1 : a.releasedAt > b.releasedAt ? -1 : 0));
    const top = history[0];
    return { env, released: !!top, version: top?.version ?? null, url: top?.url || envUrl(env, slug), releasedAt: top?.releasedAt ?? null, history };
  };
  return { dev: one("dev"), stage: one("stage") };
}
export const canPromote = (envs: Record<EnvId, EnvState>): boolean =>
  envs.dev.released && (!envs.stage.released || compareVersions(envs.dev.version!, envs.stage.version!) > 0);
export function promotionOf(releases: Release[], requests: ChangeRequest[]): { version: string; changeRequestIds: string[] } | null {
  const envs = environmentsOf(releases, "");
  if (!canPromote(envs)) return null;
  const version = envs.dev.version!;
  const changeRequestIds = requests
    .filter((r) => r.status === "released-dev" && compareVersions(r.version, version) <= 0)
    .sort((a, b) => a.number - b.number).map((r) => r.id);
  return { version, changeRequestIds };
}

/* ── roles ── */

export function workspaceRoleOf(role: Role | null): WorkspaceRole {
  if (role === "requester") return "owner";
  if (role === "techlead" || role === "pm" || role === "admin") return "member";
  return "viewer";
}
export const canRunChanges = (r: WorkspaceRole): boolean => r !== "viewer";

/* ── status and validation ── */

export function changeStatusLabel(cr: { status: ChangeStatus; version: string }): string {
  if (cr.status === "building") return `Building ${versionLabel(cr.version)}`;
  if (cr.status === "released-dev") return `Released to dev in ${versionLabel(cr.version)}`;
  if (cr.status === "promoted-stage") return `Promoted to stage in ${versionLabel(cr.version)}`;
  return "Draft";
}

export interface ChangeContext { released: boolean; role: WorkspaceRole; building: ChangeRequest | null; selfId?: string | null; forBuild: boolean; requests?: ChangeRequest[] }

/** The first message that applies, or null when the change can be saved (or started, with forBuild). */
export function validateChange(input: ChangeInput, ctx: ChangeContext): string | null {
  if (ctx.role === "viewer") return "Viewers see change requests and comment on them. A Workspace admin or a member starts a change.";
  if (!ctx.released) return "Change requests open after the first release to dev.";
  if (input.lane !== "add" && !parseFeatureRef(input.featureRef)) return "Choose the feature this change is for.";
  const title = input.title.trim();
  const description = input.description.trim();
  if (!title && !description) return "Write a title or what changes first.";
  if (ctx.forBuild && !title) return "Give the change a short title.";
  if (ctx.forBuild && !description) return "Say what changes and why.";
  if (ctx.forBuild && ctx.building && ctx.building.id !== ctx.selfId) {
    return `${ctx.requests ? changeCode(ctx.building, ctx.requests) : crCode(ctx.building.number)} is building. Start this one when it is released to dev.`;
  }
  return null;
}

/* ── change-build stages ── */

/** Which stages a change build runs, in pipeline order. */
export function stagesFor(lane: Lane, screenCount: number): StageId[] {
  const always: StageId[] = ["02", "03", "04", "05", "07", "deploy"];
  return STAGES.map((s) => s.id).filter((id) =>
    always.includes(id) || (id === "01" && (lane === "change" || lane === "add")) ||
    (id === "06" && (lane === "change" || lane === "add" || (lane === "enhance" && screenCount > 0))));
}
const BASE_HOURS: Record<Lane, number> = { change: 1, enhance: 0.5, add: 1.5, fix: 0.5 };
export const changeHours = (lane: Lane, storyCount: number): number =>
  Math.min(6, Math.max(1, Math.round((BASE_HOURS[lane] + 0.5 * storyCount) * 2) / 2));

/* ── history ── */

export const featureHistory = (ref: string, requests: ChangeRequest[]): ChangeRequest[] =>
  requests.filter((r) => isReleased(r.status) && r.lane !== "add" && r.lane !== "fix" && r.featureRef === ref)
    .sort((a, b) => compareVersions(a.version, b.version));
export const badgesFor = (ref: string, requests: ChangeRequest[]): ChangeBadge[] =>
  featureHistory(ref, requests).map((r) => ({ lane: r.lane, version: r.version, label: `${LANE_META[r.lane].badge} in ${versionLabel(r.version)}` }));

function sentence(s: string): string {
  const t = s.trim();
  if (!t) return "";
  const c = t.charAt(0).toUpperCase() + t.slice(1);
  return /[.!?]$/.test(c) ? c : `${c}.`;
}
const firstSentence = (s: string): string => sentence(s.trim().split(/(?<=[.!?])\s+/)[0] ?? "");

export function revisedText(lane: Lane, previous: string, cr: { title: string; description: string }): string {
  if (lane === "enhance") return `${previous.trimEnd()} ${sentence(cr.title)}`;
  const first = firstSentence(cr.description);
  return sentence(cr.title) + (first ? ` ${first}` : "");
}
export function featureVersions(ref: string, base: string, requests: ChangeRequest[]): FeatureVersion[] {
  const out: FeatureVersion[] = [{ version: FIRST_VERSION, text: base, lane: null, code: null }];
  featureHistory(ref, requests).forEach((cr) => {
    out.push({ version: cr.version, text: revisedText(cr.lane, out[out.length - 1].text, cr), lane: cr.lane, code: crCode(cr.number) });
  });
  return out;
}
export const addedFeatures = (requests: ChangeRequest[]): AddedFeature[] =>
  requests.filter((r) => isReleased(r.status) && r.lane === "add").sort((a, b) => a.number - b.number).map((r) => {
    const id = `added-${r.number}`;
    return { id, ref: featureRef("feature", id), name: r.title, plain: firstSentence(r.description), version: r.version, code: crCode(r.number) };
  });

/** "Mon 26 Oct, 10:00", or "" for an invalid date. */
export function formatReleaseTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-GB", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23" })
    .formatToParts(d).map((x) => [x.type, x.value]));
  return `${p.weekday} ${p.day} ${p.month}, ${p.hour}:${p.minute}`;
}
