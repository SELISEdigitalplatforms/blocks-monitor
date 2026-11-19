// Pure rules for the "from the factory" notes: who follows a project, where a note links and how
// its event key is built. No I/O; bundled by the server functions.
import { isSafeInternalLink } from "./notifications";
import { prefixPath, rewritePath } from "../lib/pathPrefix";

export type NotificationAudience = "project-followers" | "project-followers-and-actor";

export const FACTORY_NOTE_KINDS = [
  "business.handed-over",
  "requirements.ready",
  "scope.ready",
  "build.started",
  "release.created",
] as const;
export type FactoryNoteKind = (typeof FACTORY_NOTE_KINDS)[number];

export type FactoryNoteEnv = "dev" | "stage" | "production";

export interface FactoryNoteInput {
  kind: FactoryNoteKind;
  audience: NotificationAudience;
  projectId: string;
  params: Record<string, string | number>;
  link: string;
  eventKey: string;
}

const MAX_EVENT_KEY = 160;
const PAGE: Record<Exclude<FactoryNoteKind, "release.created">, string> = {
  "business.handed-over": "sanitization",
  "requirements.ready": "requirements",
  "scope.ready": "scope",
  "build.started": "build",
};

export function factoryNoteLink(kind: FactoryNoteKind, projectId: string, opts?: { env?: FactoryNoteEnv }): string {
  const base = prefixPath(`/p/${encodeURIComponent(projectId)}`);
  const link = kind === "release.created" ? `${base}/delivered?env=${opts?.env ?? "dev"}` : `${base}/${PAGE[kind]}`;
  return isSafeInternalLink(link) ? link : rewritePath("/dashboard");
}

export function factoryNoteEventKey(kind: FactoryNoteKind, projectId: string, discriminator: string): string {
  const safe = (s: string) => String(s).replace(/[^A-Za-z0-9:._-]/g, "");
  return `factory:${safe(kind)}:${safe(projectId)}:${safe(discriminator)}`.slice(0, MAX_EVENT_KEY);
}

export function followersOf(
  p: { assigneeUserId?: string | null; createdByUserId?: string | null; readerIds?: readonly string[] | null },
  actorUserId: string | null,
): string[] {
  const readers = p.readerIds ?? [];
  const out: string[] = [];
  const add = (id: string | null | undefined) => {
    if (typeof id === "string" && id !== "" && readers.includes(id) && !out.includes(id)) out.push(id);
  };
  add(p.assigneeUserId ? p.assigneeUserId : p.createdByUserId);
  add(actorUserId);
  return out;
}

export function factoryNote(
  kind: FactoryNoteKind,
  o: {
    projectId: string;
    discriminator: string;
    params?: Record<string, string | number>;
    env?: FactoryNoteEnv;
    withActor: boolean;
  },
): FactoryNoteInput {
  return {
    kind,
    audience: o.withActor ? "project-followers-and-actor" : "project-followers",
    projectId: o.projectId,
    params: o.params ?? {},
    link: factoryNoteLink(kind, o.projectId, { env: o.env }),
    eventKey: factoryNoteEventKey(kind, o.projectId, o.discriminator),
  };
}
