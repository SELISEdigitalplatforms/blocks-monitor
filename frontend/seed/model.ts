// The shapes of the seed's data tables. A project module describes one project as plain data (ProjectPlan); the
// builders in seed/build/** turn it into rows for every step the project has reached. To add a field to the seed, add it
// to the plan type here, fill it in the project tables and write it in the one builder that owns that schema.
import type { When } from "./core/clock";
import type { ScreenImage } from "./core/draw";
import type { FileSpec } from "./core/files";
import type { BugAnalysis } from "../src/domain/assistant";

export type Step = "business" | "sanitization" | "requirements" | "scope" | "board" | "build" | "release";
export const STEPS: readonly Step[] = ["business", "sanitization", "requirements", "scope", "board", "build", "release"];
export type Stage = Step | "paused" | "abandoned";

/** A person key from seed/data/people.ts. */
export type P = string;

// ── people and workspaces ─────────────────────────────────────────────────────────────────────────────────────

export interface PersonDef {
  key: P;
  name: string;
  email: string;
  /** Job title, used in texts and the README. */
  title: string;
  /** IAM platform role ("mf-super-admin") and/or a custom PlatformRole key. */
  superAdmin?: boolean;
  platformRole?: string;
  /** Invited by e-mail but never signed up: no IAM account and no Account row. */
  noAccount?: boolean;
  /** Account deactivated by an admin (its memberships are suspended). */
  deactivated?: { at: When; by: P };
  lastSignIn?: When;
}

export interface CustomRoleDef {
  key: string;
  name: string;
  description: string;
  permissions: string[];
  by: P;
  at: When;
}

export interface MemberDef {
  person: P;
  /** owner | member | viewer | a custom role key of the workspace */
  role: string;
  status?: "active" | "invited" | "pending-account" | "suspended";
  invitedBy: P;
  invited: When;
  joined?: When;
  suspended?: When;
}

export interface WorkspaceDef {
  key: string;
  name: string;
  createdBy: P;
  created: When;
  roles: CustomRoleDef[];
  members: MemberDef[];
}

// ── projects ──────────────────────────────────────────────────────────────────────────────────────────────────

/** Local references between rows of one project: "note:<key>", "file:<key>", "clar:<key>", "dec:<key>", "req:<key>". */
export type Ref = string;

export interface Timeline {
  created: When;
  handedOver?: When;
  sanitized?: When;
  confirmed?: When;
  locked?: When;
  /** When the build of milestone 1 started (build and release projects). */
  buildStart?: When;
  /** When the project was paused or abandoned. */
  stopped?: When;
  /** The project's last change (LastUpdatedDate; the projects list sorts by it). Defaults to the latest step time. */
  updated?: When;
}

export interface DocsPlan {
  folders: { key: string; name: string; kind: "meeting" | "presentation" | "event" | "ideation" | "other"; parent?: string; at: When; by: P }[];
  notes: { key: string; folder?: string; title: string; body: string; at: When; by: P; edited?: When }[];
  scratch?: { body: string; at: When; by: P };
  files: { key: string; folder?: string; file: FileSpec; at: When; by: P }[];
}

export interface ClarificationPlan {
  key: string;
  q: string;
  a?: string;
  status: "open" | "answered" | "deferred";
  owner: P;
  at: When;
  answeredBy?: P;
  answeredAt?: When;
  deferReason?: string;
  source?: Ref;
}

export interface DecisionPlan {
  key: string;
  title: string;
  statement: string;
  rationale: string;
  by: P;
  at: When;
  clar?: string;
  source?: Ref;
}

export interface TechDecisionPlan {
  key: string;
  area: "stack" | "architecture" | "integration" | "nfr" | "security" | "data" | "hosting" | "other";
  title: string;
  choice: string;
  rationale: string;
  alternatives: string[];
  experts: P[];
  status: "proposed" | "accepted" | "rejected";
  by: P;
  at: When;
  nfr?: { category: string; target: string };
  system?: string;
}

export interface SanitizationPlan {
  clarifications: ClarificationPlan[];
  decisions: DecisionPlan[];
  tech: TechDecisionPlan[];
  /** Discussion on the sanitization step (FeedbackThread target "sanitization"). */
  discussion?: CommentPlan[];
  /** The technical assist job failed (it is the newest of its kind, so the requester sees it as needing attention). */
  assistFailure?: { at: When; message: string; error: string };
}

export interface RequirementPlan {
  key: string;
  title: string;
  text: string;
  category: "functional" | "integration" | "nfr" | "security" | "data" | "ux" | "other";
  priority: "must" | "nice" | "later";
  criteria: string[];
  sources: Ref[];
  /** Overrides the status the step gives (draft before scope, confirmed after). */
  status?: "draft" | "confirmed" | "assumed";
}

export interface ObjectivePlan {
  statement: string;
  criteria: string[];
  highLevelMd: string;
  architectureMd: string;
}

export interface SuggestionPlan {
  key: string;
  source: "engine" | "chat" | "person";
  title: string;
  text: string;
  status: "open" | "accepted" | "dismissed";
  at: When;
  decidedBy?: P;
  decidedAt?: When;
}

export interface CommentPlan {
  by: P;
  at: When;
  text: string;
  /** Image or PDF attachments of the comment (feedback-comment Attachment rows). */
  files?: FileSpec[];
  system?: boolean;
}

export interface ScreenPlan {
  key: string;
  name: string;
  image: Omit<ScreenImage, "type" | "brand" | "app">;
  status?: "generated" | "accepted" | "changes-requested";
}

export interface DesignPlan {
  mode: "describe" | "sample";
  instructions: string;
  samples?: FileSpec[];
  /** Brand colour and app name on the generated screens. */
  brand: string;
  app: string;
  confirmedBy: P;
  screens: ScreenPlan[];
  /** Screens generated in an earlier round and replaced (kept as superseded versions). */
  regenerated?: string[];
}

export interface StoryPlan {
  key: string;
  title: string;
  actor: string;
  text: string;
  criteria: string[];
  hours: number;
}

export interface FeaturePlan {
  key: string;
  title: string;
  description: string;
  priority: "must" | "nice" | "later";
  reqs: string[];
  stories: StoryPlan[];
  dropped?: boolean;
}

export interface MilestonePlan {
  name: string;
  goal: string;
  features: string[];
  preview: string;
}

export interface ChallengePlan {
  severity: "high" | "medium" | "low";
  question: string;
  why: string;
  fix: string;
  target?: { type: "feature" | "story"; key: string };
  status?: "open" | "accepted" | "answered" | "dismissed";
  answer?: string;
  by?: P;
  at?: When;
}

export interface ScopePlan {
  title: string;
  summary: string;
  features: FeaturePlan[];
  milestones: MilestonePlan[];
  challenges?: ChallengePlan[];
  /** Feedback threads on features ("feature:<key>") or stories ("story:<key>"). */
  feedback?: { target: string; resolved?: boolean; comments: CommentPlan[] }[];
}

/** Extra board tickets that come from no story (cross-cutting work). */
export interface TaskPlan {
  tag: string;
  title: string;
  milestone: number;
  hours: number;
  description: string;
  acceptance: string[];
  feature?: string;
}

export interface ChangePlan {
  lane: "change" | "enhance" | "add" | "fix";
  feature?: string;
  title: string;
  description: string;
  status: "draft" | "building" | "released-dev" | "promoted-stage" | "promoted-production";
  by: P;
  at: When;
  /** Build start / finish (released and promoted changes). */
  built?: When;
  /** change.build progress while building. */
  progress?: number;
  tickets: { title: string; hours: number; acceptance: string[] }[];
}

export interface ApprovalStepPlan {
  type: "architect" | "security" | "qa" | "custom";
  label?: string;
  required: boolean;
  approvers: P[];
}

export interface PromotionPlan {
  env: "stage" | "production";
  version: string;
  requestedBy: P;
  /** One entry per attempt; only the last may be approved or pending. */
  attempts: {
    at: When;
    status: "approved" | "rejected" | "pending" | "cancelled";
    /** Decisions per step type (steps without an entry stay pending). */
    decisions: { type: "architect" | "security" | "qa" | "custom"; by: P; decision: "approved" | "rejected"; at: When; comment?: string }[];
  }[];
  /** When the approved version was promoted. */
  promotedAt?: When;
}

export interface DeliveryPlan {
  /** When each built milestone's build started (one entry per built milestone, in order). */
  builds: When[];
  /** Milestones fully built (preview ready). */
  builtMilestones: number;
  /** The milestone after the built ones is building now: the share of its build that is done (0..1). */
  current?: { progress: number };
  /** Tickets that come from no story (cross-cutting work). */
  tasks?: TaskPlan[];
  /** Person comments on tickets (by ticket plan ref, e.g. "r1.2" or "x.ci"). */
  ticketComments?: { ticket: string; by: P; text: string; after: number }[];
  /** Stage and production approval policies. */
  policies?: { env: "stage" | "production"; note: string; allRequired: boolean; steps: ApprovalStepPlan[]; at: When; by: P }[];
  promotions?: PromotionPlan[];
  /** Who promotes approved versions. */
  promoter?: P;
  changes?: ChangePlan[];
  /** Release URLs per environment (https). */
  urls: { dev: string; stage?: string; production?: string };
}

export interface WikiPlan {
  slug: string;
  group: "overview" | "guide" | "features" | "logic" | "technical" | "decisions" | "releases";
  title: string;
  body: string;
  origin: "factory" | "person";
  sources?: { label: string; ref: string }[];
  order?: number;
  by?: P;
  at: When;
  /** Earlier saved bodies of a person page (oldest first) with who and when; the current body is added as the newest. */
  history?: { body: string; by: P; at: When }[];
}

export interface ChatPlan {
  role: "planner" | "dev" | "reviewer" | "qa" | "secops" | "docs" | "shipper";
  messages: { from: P | "agent"; at: When; text: string; task?: { target: "change-request" | "suggestion" | "ticket"; ref: string } }[];
}

export interface AssistantPlan {
  env: "dev" | "stage" | "production";
  messages: {
    from: P | "assistant";
    at: When;
    text: string;
    points?: string[];
    refs?: { path: string; line: number | null; why: string }[];
    attachments?: { name: string; mime: string; size: number; excerpt: string }[];
    analysis?: BugAnalysis;
    /** Who asked the engine for this answer or analysis (analysis needs build.run); defaults to the last asker. */
    requestedBy?: P;
    fix?: { state: "offered" | "started" | "declined"; change?: number };
  }[];
}

export interface SharePlan {
  item: "scope" | "screens" | "screen";
  screen?: string;
  by: P;
  with: P;
  at: When;
}

export interface ShareLinkPlan {
  item: "scope" | "design.screen";
  screen?: string;
  token: string;
  by: P;
  at: When;
  days: 1 | 7 | 30;
  revoked?: When;
  views?: number;
}

export interface ProjectPlan {
  key: string;
  workspace: string;
  name: string;
  client: { name: string; contact: string; industry: string; region: string };
  brief: string;
  stage: Stage;
  /** For paused / abandoned projects: the step they stopped at. */
  resumeTo?: Step;
  repo:
    | { mode: "new"; owner?: string; name?: string; visibility?: "private" | "internal"; branch?: string }
    | { mode: "existing"; owner: string; name: string; branch: string };
  creator: P;
  assignee?: P;
  /** Earlier assignees (oldest first) before the current one. */
  previousAssignees?: { person: P; by: P; at: When }[];
  assignedBy?: P;
  handedOverBy?: P;
  /** Who works the later steps (completes sanitization, confirms requirements, locks scope, starts builds). */
  lead: P;
  days: Timeline;
  docs: DocsPlan;
  sanitization?: SanitizationPlan;
  requirements?: RequirementPlan[];
  objective?: ObjectivePlan;
  suggestions?: SuggestionPlan[];
  requirementFeedback?: { req: string; resolved?: boolean; comments: CommentPlan[] }[];
  design?: DesignPlan;
  scope?: ScopePlan;
  delivery?: DeliveryPlan;
  wiki?: WikiPlan[];
  chat?: ChatPlan[];
  assistant?: AssistantPlan[];
  shares?: SharePlan[];
  links?: ShareLinkPlan[];
}
