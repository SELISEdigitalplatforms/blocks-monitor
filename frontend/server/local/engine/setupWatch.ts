// The business agent's doorbell: while a project is being set up, every new file (any upload path: the Share window,
// the document tree, Autofill, the guided start) and every changed note queues a setup.assist job, a few seconds after
// the last change (debounced), so a batch of uploads is read in one go. A job is queued only for material no finished
// run has read (src/domain/setupAgent.ts planAgentRun), so the agent's own moves and folders never queue another one.
//
// Restart safe: the queued job is a row like any other (the engine claims it after a restart). At start, and when a
// run finishes, the projects the agent already works on are looked at again, so material that arrived while a run was
// busy, or while the server was down, is read next.
import { capKey } from "../../../functions/_lib/ids";
import type { RawGateway, Row } from "../../../functions/_lib/gateway";
import { SETUP_AGENT_KIND, inSetup, materialOf, planAgentRun, readSoFar, shortHash } from "../../../src/domain/setupAgent";
import type { RowStore } from "../rowStore.ts";
import type { EngineConfig } from "./config.ts";
import { str, strs } from "./context.ts";

const ACTIVE = new Set(["queued", "claimed", "running"]);
/** Seconds after the last change before the agent starts reading (pace 1). */
export const SETUP_AGENT_DEBOUNCE_S = 3;

export interface SetupWatchOptions {
  store: RowStore;
  gateway: RawGateway;
  config(): EngineConfig;
  log(line: string): void;
  ready?: () => boolean;
  /** Debounce in ms (default SETUP_AGENT_DEBOUNCE_S at the pace); 0 = only on check() (tests). */
  debounceMs?: number;
  /** Looks at the projects the agent works on at start (default true). */
  sweepAtStart?: boolean;
}

export interface SetupWatch {
  /** Queues a run for the project now when it has unread material; answers the job id (or null). */
  check(projectId: string, actor?: string): Promise<string | null>;
  stop(): void;
}

/** The project's material and the agent's runs, straight from the store. */
export function projectAgentState(store: RowStore, projectId: string) {
  const live = (r: Row) => r.ProjectId === projectId && r.IsDeleted !== true;
  const files = store.rows("DocFile").filter(live).map((f) => ({ id: str(f.ItemId), status: str(f.Status) }));
  const notes = store.rows("DocNote").filter(live).map((n) => ({ id: str(n.ItemId), body: str(n.BodyMd), title: str(n.Title), isBrief: n.IsProjectBrief === true }));
  const jobs = store.rows("EngineJob").filter((j) => j.ProjectId === projectId && j.Kind === SETUP_AGENT_KIND);
  return { material: materialOf(files, notes), jobs, active: jobs.find((j) => ACTIVE.has(str(j.Status))) ?? null };
}

export function startSetupWatch(o: SetupWatchOptions): SetupWatch {
  const timers = new Map<string, ReturnType<typeof setTimeout>>();
  // a key of its own: a reloaded backend starts its watch before the old one stops, and the old stop must not take the
  // new listener with it
  const key = `setup-agent-watch:${Math.random().toString(36).slice(2, 10)}`;
  const actors = new Map<string, string>();
  let stopped = false;

  async function check(projectId: string, actor?: string): Promise<string | null> {
    if (stopped || (o.ready && !o.ready())) return null;
    const project = o.store.get("Project", projectId);
    if (!project || !inSetup(project)) return null;
    const st = projectAgentState(o.store, projectId);
    if (st.active) return null; // the run's end looks again
    const plan = planAgentRun(st.material, readSoFar(st.jobs));
    if (!plan) return null;
    const readers = strs(project.ReaderIds);
    const who = [actor, actors.get(projectId), str(project.AssigneeUserId), str(project.CreatedByUserId)].find((id) => id && (readers.length === 0 || readers.includes(id))) ?? str(project.CreatedByUserId);
    const res = await o.gateway.insert("EngineJob", {
      ProjectId: projectId,
      Kind: SETUP_AGENT_KIND,
      Status: "queued",
      Progress: 0,
      Attempts: 0,
      Message: "",
      ActiveKey: `${SETUP_AGENT_KIND}:project`,
      InputJson: JSON.stringify({ projectId, ...plan }),
      RequestedByUserId: who,
      WorkspaceId: str(project.WorkspaceId),
      ReaderIds: readers,
      CreatedByUserId: who,
      UpdatedByUserId: who,
      RequestKey: capKey(`setup-agent:${projectId}:${shortHash(plan.seen.join(","))}`),
    });
    if (res.itemId) o.log(`[engine] business agent queued for ${str(project.Name)} (${plan.fileIds.length} files, ${plan.noteIds.length} notes)`);
    return res.itemId ?? null;
  }

  const later = (projectId: string, actor?: string): void => {
    if (stopped || !projectId) return;
    if (actor) actors.set(projectId, actor);
    const t = timers.get(projectId);
    if (t) clearTimeout(t);
    const ms = o.debounceMs ?? SETUP_AGENT_DEBOUNCE_S * 1000 * Math.min(1, o.config().pace);
    if (ms <= 0) return;
    timers.set(projectId, setTimeout(() => {
      timers.delete(projectId);
      check(projectId).catch((e: unknown) => o.log(`[engine] business agent not queued: ${e instanceof Error ? e.message : String(e)}`));
    }, ms));
  };

  o.store.onChange(key, (c) => {
    if (c.kind !== "insert" && c.kind !== "update") return;
    const r = c.row;
    const pid = str(r.ProjectId);
    if (c.schema === "DocFile" && r.Status === "ready") later(pid, str(r.UpdatedByUserId) || str(r.CreatedByUserId));
    else if (c.schema === "DocNote" && r.IsProjectBrief !== true && str(r.Title) !== "Project brief") later(pid, str(r.UpdatedByUserId));
    else if (c.schema === "EngineJob" && r.Kind === SETUP_AGENT_KIND && !ACTIVE.has(str(r.Status))) later(pid);
  });

  // the projects the agent already works on: anything that came in while the server was away is read next
  if (o.sweepAtStart !== false) {
    setTimeout(() => {
      const ids = new Set(o.store.rows("EngineJob").filter((j) => j.Kind === SETUP_AGENT_KIND).map((j) => str(j.ProjectId)));
      for (const id of ids) later(id);
    }, 5_000);
  }

  return {
    check,
    stop() {
      stopped = true;
      o.store.onChange(key, null);
      for (const t of timers.values()) clearTimeout(t);
      timers.clear();
    },
  };
}
