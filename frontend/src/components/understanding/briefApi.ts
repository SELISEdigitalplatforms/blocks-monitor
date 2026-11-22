/** The project brief as the Project understanding step reads it (server/api/brief/builder.ts), and its four calls.
 *  The server reads the project as the signed-in person; every call is same-origin with the session cookie. */

export type FileState = "pending" | "processing" | "ready" | "failed" | "unsupported" | "not_read";

export interface BriefRequirement {
  /** Stable key, never shown. */
  id: string;
  description: string;
  /** Plain source names ("Requirements.pdf", "Your project setup"). */
  sources?: string[];
  basis: "explicit" | "inferred" | "confirmed";
}

export interface BriefFeature {
  name: string;
  confirmedRequirements: BriefRequirement[];
  proposedRequirements: BriefRequirement[];
}

export interface BriefFile {
  fileId: string;
  name: string;
  status: FileState | string;
  observationCount: number;
  requirementCount?: number;
  summary?: string;
  errorCode?: string;
}

export interface BriefConflict { key: string; description: string; sources: string[]; resolution: string | null }

export interface BriefQuestion { key: string; question: string; context: string; kind?: "basics" | "material"; topic?: "goal" | "users" }

export interface Brief {
  schema?: number;
  version: number;
  generatedAt: string;
  source?: "blocks" | "local";
  project: { id: string; name: string; kind: string; problem: string; desiredOutcome: string };
  targetUsers: { persona: string; description: string }[];
  features: BriefFeature[];
  rejectedRequirements?: BriefRequirement[];
  outOfScope?: string[];
  conflicts: BriefConflict[];
  openQuestions: BriefQuestion[];
  attachmentStatus: BriefFile[];
  confirmedAt?: string;
  confirmedByUserId?: string;
}

export class BriefRequestError extends Error {
  constructor(readonly status: number, readonly code: string) { super(code); }
}

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, { credentials: "same-origin", ...init });
  let body: Record<string, unknown> = {};
  try { body = await response.json(); } catch { /* an empty or broken answer */ }
  if (!response.ok) throw new BriefRequestError(response.status, typeof body.error === "string" ? body.error : "unavailable");
  return body as T;
}

const at = (projectId: string) => `/api/brief/${encodeURIComponent(projectId)}`;
const post = (body?: unknown): RequestInit => ({
  method: "POST",
  ...(body === undefined ? {} : { headers: { "content-type": "application/json" }, body: JSON.stringify(body) }),
});

/** The current brief (the server rebuilds it first when an input changed). */
export async function fetchBrief(projectId: string, signal?: AbortSignal): Promise<Brief> {
  return (await call<{ brief: Brief }>(at(projectId), { signal })).brief;
}

export type Decision =
  | { kind: "requirement"; key: string; value: "confirmed" | "rejected" | null }
  | { kind: "conflict"; key: string; value: "product_manager" | null };

export async function saveDecision(projectId: string, decision: Decision): Promise<Brief> {
  return (await call<{ brief: Brief }>(`${at(projectId)}/decision`, post(decision))).brief;
}

export async function confirmBrief(projectId: string): Promise<Brief> {
  return (await call<{ brief: Brief }>(`${at(projectId)}/confirm`, post())).brief;
}

export async function rebuildBrief(projectId: string): Promise<void> {
  await call(`${at(projectId)}/build`, post());
}
