/** MADP Factory data model (front-end prototype; all records are demo data). */

export type Role = "requester" | "techlead" | "pm" | "management" | "admin";

export interface Person {
  id: string;
  name: string;
  title: string;
  role: Role;
  initials: string;
  email: string;
  /** what this role does in the factory, one line */
  does: string;
}

export interface Client {
  id: string;
  name: string;
  industry: string;
  city: string;
  contact: string;
}

/** The project lifecycle (see data/journey.ts for transitions and guards). */
export type ProjectStatus =
  | "intake"
  | "understanding"
  | "objective"
  | "scope"
  | "approval"
  | "changes"
  | "rejected"
  | "approved"
  | "building"
  | "needs-decision"
  | "preview"
  | "acceptance"
  | "ready"
  | "live"
  | "delivered"
  | "paused"
  | "abandoned";

/** MADP's real pipeline: the stages are run by MADP's AI agents; deploy + smoke test puts the app on Blocks. 08 (publish) is not go-live. */
export type StageId = "01" | "02" | "03" | "04" | "05" | "06" | "07" | "deploy";

export type Health = "on-track" | "at-risk" | "late" | "blocked" | "done";

export interface Project {
  id: string;
  name: string;
  clientId: string;
  requesterId: string;
  status: ProjectStatus;
  stage?: StageId;
  /** 0-100 */
  progress: number;
  health: Health;
  /** plain one-line status for everyone */
  statusLine: string;
  /** who has to do something next, or null */
  nextActionBy: Role | null;
  eta: string;
  startedAt: string;
  /** client-facing price guide in CHF */
  priceGuide: number;
  /** internal cost so far in CHF (PM / management only) */
  internalCost: number;
  hero?: boolean;
}

export type ChipTone = "neutral" | "accent" | "ai" | "success" | "warning" | "danger";
