// The worker's light, periodic context refresh (DEMO-SCOPE-31.10.md "Project context"): what people do between jobs
// (answers, approvals, the scope lock, milestone accepts, chat questions, uploads) reaches the project's context and
// its ledger as "user" events within a minute, even when no job follows.
//
//   which projects    the active ones only: a job of the project was created or moved in the last ACTIVE_FOR_MS (one
//                     read of the newest EngineJob rows per round) or this worker prepared one; at most MAX_PROJECTS,
//                     and only projects whose context exists already (a job made it: no folder is ever made here)
//   what is read      the first time in this process the whole project (as a job's prepare does), after that only the
//                     schemas people act on (USER_SCHEMAS), one parallel round per project
//   never during a job  a project with a job running on this worker is skipped (its job refreshes the context itself),
//                     and a job's prepare waits for a refresh of its project that is under way (beforeJob)
//
// Cheap on purpose: one EngineJob read per round, a few reads per active project, no Claude, no writes to the Data
// Gateway. Errors are logged once in a while and never stop the worker.
import { f } from "../../../functions/_lib/filter";
import type { RawGateway, Row } from "../../../functions/_lib/gateway";
import { ProjectView } from "../../local/engine/context.ts";
import { refreshProjectContext } from "../../engine-context/hooks.ts";
import type { GatewayStore } from "./store.ts";

export const CONTEXT_REFRESH_MS = 60_000;
const ACTIVE_FOR_MS = 3 * 60 * 60_000;
const MAX_PROJECTS = 4;
const ALL_STATUSES = ["queued", "claimed", "running", "succeeded", "failed", "cancelled"];
/** The schemas people's actions live in (userEvents.ts) and what the context shows of them. */
export const USER_SCHEMAS = [
  "Clarification", "Decision", "TechDecision", "DocFile", "DocNote", "Requirement", "RequirementExtra", "Objective", "DesignBrief",
  "ScopeVersion", "Milestone", "Challenge", "ApprovalPolicy", "ApprovalRequest", "ApprovalStep", "Release", "AgentChatMessage", "AssistantMessage", "ChangeRequest",
  "Attachment", "FeedbackThread", "FeedbackComment",
];

const str = (v: unknown): string => (typeof v === "string" ? v : "");
const errTag = (e: unknown): string => (e instanceof Error ? e.message.slice(0, 160) : "error");

export interface ContextRefresher {
  /** One round over the active projects (never two at once). */
  tick(): Promise<void>;
  /** A job's prepare: waits for a refresh of its project that is under way; marks the project active and fully read. */
  beforeJob(projectId: string, workspaceId: string): Promise<void>;
  afterLoad(projectId: string): void;
  /** One project now (a full read first); null when it has no context yet. */
  refreshOne(projectId: string, workspaceId: string): Promise<Awaited<ReturnType<typeof refreshProjectContext>>>;
}

export function createContextRefresher(o: {
  store: GatewayStore;
  raw: RawGateway;
  /** MF_ENGINE_ROOT (null: no project folders, nothing to refresh). */
  root: string | null;
  readFile(id: string): Promise<Uint8Array | null>;
  /** Job ids this worker runs now. */
  working(): string[];
  log(line: string): void;
  now?: () => number;
}): ContextRefresher {
  const now = o.now ?? Date.now;
  const active = new Map<string, { workspaceId: string; at: number }>();
  const fullyRead = new Set<string>();
  const inflight = new Map<string, Promise<unknown>>();
  let running = false;
  let failures = 0;

  async function activeProjects(): Promise<Map<string, { workspaceId: string; at: number }>> {
    const res = await o.raw.find("EngineJob", {
      where: f.in("Status", ALL_STATUSES), fields: ["ProjectId", "WorkspaceId", "CreatedDate", "LastUpdatedDate"], sort: { field: "CreatedDate", dir: "desc" }, page: 1, pageSize: 40,
    });
    for (const j of res.items) {
      const at = Math.max(Date.parse(str(j.CreatedDate)) || 0, Date.parse(str(j.LastUpdatedDate)) || 0);
      const id = str(j.ProjectId);
      if (!id || !str(j.WorkspaceId) || now() - at > ACTIVE_FOR_MS) continue;
      if ((active.get(id)?.at ?? 0) < at) active.set(id, { workspaceId: str(j.WorkspaceId), at });
    }
    for (const [id, a] of active) if (now() - a.at > ACTIVE_FOR_MS) active.delete(id);
    return active;
  }

  function busyProjects(): Set<string> {
    const out = new Set<string>();
    for (const id of o.working()) {
      const j: Row | undefined = o.store.get("EngineJob", id);
      if (j && str(j.ProjectId)) out.add(str(j.ProjectId));
    }
    return out;
  }

  async function refresh(projectId: string, workspaceId: string, full: boolean) {
    const dropIf = () => busyProjects().has(projectId);
    const loaded = await o.store.loadProject(projectId, new Set(o.working()), full ? { workspaceId, dropIf } : { workspaceId, only: USER_SCHEMAS, dropIf });
    if (!loaded) return null;
    if (full) fullyRead.add(projectId);
    if (!o.store.get("Project", projectId)) return null;
    return refreshProjectContext({ p: new ProjectView(o.store, projectId), workspaceId, projectId, root: o.root!, readFile: o.readFile, log: (l) => o.log(`[engine] ${l}`) });
  }

  function guarded<T>(projectId: string, work: () => Promise<T>): Promise<T> {
    const p = work();
    inflight.set(projectId, p);
    void p.finally(() => { if (inflight.get(projectId) === p) inflight.delete(projectId); }).catch(() => undefined);
    return p;
  }

  return {
    async tick() {
      if (running || !o.root) return;
      running = true;
      try {
        const projects = [...(await activeProjects()).entries()].sort((a, b) => b[1].at - a[1].at).slice(0, MAX_PROJECTS);
        const busy = busyProjects();
        for (const [projectId, a] of projects) {
          if (busy.has(projectId) || inflight.has(projectId)) continue;
          const r = await guarded(projectId, () => refresh(projectId, a.workspaceId, !fullyRead.has(projectId)));
          if (r && (r.userEvents > 0 || r.files > 0)) {
            o.log(`[engine] context of ${projectId.slice(0, 8)}: v${r.version}${r.changed.length ? ` (${r.changed.join(", ")})` : ""}, ${r.userEvents} people's action(s) recorded${r.files ? `, ${r.files} file(s) to inputs/` : ""}`);
          }
        }
        if (failures > 0) o.log("[engine] context refresh works again");
        failures = 0;
      } catch (e) {
        failures += 1;
        if (failures === 1 || failures % 30 === 0) o.log(`[engine] context refresh failed (${failures}x): ${errTag(e)}`);
      } finally {
        running = false;
      }
    },
    async beforeJob(projectId, workspaceId) {
      if (workspaceId) active.set(projectId, { workspaceId, at: now() });
      // at most a short wait: a refresh that answers later is dropped anyway (dropIf), as the job runs by then
      const p = inflight.get(projectId);
      if (p) await Promise.race([p.catch(() => undefined), new Promise((r) => setTimeout(r, 15_000))]);
    },
    afterLoad(projectId) {
      fullyRead.add(projectId);
    },
    refreshOne(projectId, workspaceId) {
      return guarded(projectId, () => refresh(projectId, workspaceId, true));
    },
  };
}
