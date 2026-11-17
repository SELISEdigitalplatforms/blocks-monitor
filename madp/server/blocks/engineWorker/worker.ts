// The MADP engine worker for Blocks mode: the same engine as local mode (server/local/engine: driver.ts, run.ts and the
// kind writers in kinds/*), on the real Data Gateway of the Factory tenant, as the Factory service identity (MF_SVC_*).
//
//   poll (every second)       active EngineJob rows (queued, claimed, running) created at or after ENGINE_SINCE: one read
//                             when nothing runs (ENGINE_POLL_MS changes the interval)
//   claim                     conditional: queued -> claimed (Attempts + 1, ClaimedBy, ClaimedAt) only from the state read,
//                             at once (no paced pick-up), while the project's rows are read in parallel
//   run                       the kind's writer, on a fresh snapshot of the project's rows (store.ts), progress on the row
//                             in the background; the paced waits of local mode are skipped (real work only), except for
//                             the delivery kinds, whose waits stay as their writers have them
//   finish                    succeeded (OutputRefs, FinishedAt) or failed (Message, ErrorCode)
//   restart                   claimed / running jobs of this host are resumed in place (run.ts replays to the stored
//                             progress); a job of another host only once its row has been quiet for the lease (120 s)
//   limits                    a queued job past MAX_JOB_ATTEMPTS and a job past its kind's JOB_MAX_RUN_MS are failed
//   context (every 60 s)      the active projects' context and ledger get what people did meanwhile (contextRefresh.ts)
//   heartbeat (every 30 s)    this host's EngineHost row and, once a minute, an EngineHostSample (heartbeat.ts)
//   AI accounts (every 60 s)  the account pool the lanes run on and its AiAccount rows (aiAccountSync.ts, accountPool.ts)
//
// Files: Storage through the app's own Blocks Storage code (functions/_lib/storage.ts). Loaded by start.mjs through Vite,
// which reloads this module graph when a writer changes.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { serviceClient, serviceTokens, type TokenStore } from "../../../functions/_lib/serviceToken";
import { createRawGateway, type Row } from "../../../functions/_lib/gateway";
import { privateRaw, scrubFile } from "./privacy.ts";
import { defaultSdk } from "../../../functions/_lib/sdk";
import { createFiles } from "../../../functions/_lib/storage";
import type { FnEnv } from "../../../functions/_lib/env";
import {
  ENGINE_JOB_KINDS, JOB_CLAIM_LEASE_MS, JOB_MAX_RUN_MS, MAX_JOB_ATTEMPTS, isEngineJobKind, isHostMaintenance,
} from "../../../src/domain/engineJob";
import { attemptsMessage, timeLimitMessage } from "../../../src/domain/jobMessage";
import { engineConfigSource } from "../../local/engine/config.ts";
import { createEngine, recordedOutcome } from "../../local/engine/driver.ts";
import { changeLoader, holdBack as streamsHoldBack } from "../../local/engine/streams.ts";
import { plainJobWrites } from "../../local/engine/plainMessages.ts";
import { writerOf } from "../../local/engine/kinds/index.ts";
import { realWorkWriterOf, simulatedKinds } from "./realWorkOnly.ts";
import { requireAi } from "../../local/engine/ai/index.ts";
import { ID, engineRoot, projectWorkspace } from "../../local/engine/projectFolder.ts";
import { createGatewayStore, loadCatalog } from "./store.ts";
import { CONTEXT_REFRESH_MS, createContextRefresher, type ContextRefresher } from "./contextRefresh.ts";
import { createProvisioner } from "../provisioning.ts";
import { createProvisioningCli } from "../provisioningCli.ts";
import { createProvisioningStore } from "../provisioningStore.ts";
import { acceptsWorkerJob, workerJobScope } from "./jobScope.ts";
import { DAILY_SYNC_CHECK_MS, dailySyncIntervalHours, engineHomeReady, ensureDailySkillsSync } from "./dailySync.ts";
import { RENEWAL_CHECK_MS, renewalsEnabled, runBillingRenewals } from "./billingRenewals.ts";
import { syncProjectRegistry } from "../../api/registryWriter.ts";
import { f } from "../../../functions/_lib/filter";
import { BUILD_FAILURE_KINDS, createBuildFailureNotifier } from "../../local/engine/buildFailureNotification.ts";
import { authBodyOk } from "../../../src/blocks/iamResult";
import { releaseIdOf } from "./release.mjs";
import { createHeartbeat } from "./heartbeat.ts";
import { createHostStatsReader } from "./hostStats.ts";
import { createAiAccountSync } from "./aiAccountSync.ts";
import { accountPool, commandProbe, createAccountPool, installAccountPool } from "../../local/engine/ai/accountPool.ts";
import { createRepositoryBroker } from "../../shell/repositories.ts";

export interface WorkerOptions {
  root: string;
  env: Record<string, string | undefined>;
  tokenStore: TokenStore;
  log(line: string): void;
  /** Only jobs created at or after this ISO time are worked on (older queued jobs are left as they are). */
  since: string | null;
  /** Folder of engine.json ({"enabled": false} pauses, {"pace": 0.5} speeds up); null = environment only. */
  configDir: string | null;
  pollMs?: number;
}

export interface Worker {
  /** Stops claiming new jobs; running jobs go on. */
  drain(): void;
  /** Job ids being worked on now. */
  working(): string[];
  /** Stops at once: running jobs stay claimed / running and are resumed by the next worker. */
  stop(): Promise<void>;
  /** Settles once this generation runs no job any more, after stop(): at once on a shutdown, after its last handed-over
   *  job on a reload. Until then its code and files are in use (start.mjs keeps its release loaded). */
  finished(): Promise<void>;
}

const MAX_UPLOAD_BYTES = 50 * 1024 * 1024;
/** When this module graph was evaluated (shown at start: a reload after an edit shows a new time). */
const EVALUATED_AT = new Date().toISOString();
const CATALOG_REFRESH_MS = 3 * 60_000;
const POLL_MS = 1000;
/** Kinds whose waits stay paced (their writers own their timing); every other kind does real work only. */
const PACED_KINDS = new Set(["build.run", "preview.deploy", "change.build"]);

const str = (v: unknown): string => (typeof v === "string" ? v : "");
const num = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : 0);
const errTag = (e: unknown): string => (e instanceof Error ? e.message.slice(0, 160) : "error");

/** The engine's name on the jobs it claims (EngineJob.ClaimedBy, seen by everyone who reads the jobs). MF_ENGINE_WORKER_ID
 *  sets a neutral one; without it the host name is used. */
export function workerHostId(): string {
  const configured = process.env.MF_ENGINE_WORKER_ID?.trim();
  if (configured) {
    if (!/^[A-Za-z0-9_-]{1,100}$/.test(configured)) throw new Error('Invalid engine worker identity');
    return configured;
  }
  return `madp-engine-${os.hostname().replace(/[^A-Za-z0-9-]/g, "").slice(0, 40) || "host"}`;
}

/** Jobs that an earlier code generation of this process still runs (job id -> stop that generation). Shared across
 *  reloads of this module graph, so it lives on globalThis. */
const retired: Map<string, () => void> = ((globalThis as Record<string, unknown>).__mfEngineRetiredJobs ??= new Map()) as Map<string, () => void>;

export async function startWorker(o: WorkerOptions): Promise<Worker> {
  const operatorScope = workerJobScope(o.env);
  // on Blocks the engine's visible text comes from the AI or not at all: a job whose AI does not answer usably (or is
  // off on this host) fails plainly instead of writing a built-in plan (ai/index.ts)
  requireAi(true);
  // never the board-only simulation of a build on Blocks: those jobs wait for a host that builds for real (realWorkOnly.ts)
  const simulated = simulatedKinds();
  const scope = simulated.length
    ? { ...operatorScope, excludedKinds: [...new Set([...(operatorScope.excludedKinds ?? []), ...simulated])] }
    : operatorScope;
  if (simulated.length) o.log(`[engine] build mode is off on this host: ${simulated.join(", ")} jobs are left for a host that builds for real`);
  const readOnly = o.env.MF_ENGINE_READ_ONLY === "1";
  const env: FnEnv = {
    apiUrl: (o.env.VITE_BLOCKS_API_URL || "https://blocksapi.slsblx.com").replace(/\/+$/, ""),
    tenant: o.env.MF_BLOCKS_TENANT || o.env.VITE_BLOCKS_PROJECT_KEY || "",
    clientId: o.env.MF_SVC_CLIENT_ID || "",
    clientSecret: o.env.MF_SVC_CLIENT_SECRET || "",
  };
  if (!env.tenant || !env.clientId || !env.clientSecret) throw new Error("MF_BLOCKS_TENANT, MF_SVC_CLIENT_ID and MF_SVC_CLIENT_SECRET are needed");
  const tokens = serviceTokens(env, defaultSdk, Date.now, { store: o.tokenStore });
  const client = serviceClient(env, defaultSdk, tokens);
  // no read batching: the tenant's Data Gateway refuses the aliased batch query, so a batch only adds a failed round
  // before the single reads (which run in parallel anyway)
  // every row the engine writes passes the privacy guard (privacy.ts): no accounts, logins or design-tool links leave the host
  const raw = privateRaw(createRawGateway({ env, sdk: defaultSdk, tokens, batch: false }));
  const workerId = workerHostId();

  let catalog = await loadCatalog(o.root, client);
  let catalogAt = Date.now();
  if (catalog.missing().length > 0) o.log(`[engine] schemas not on the tenant yet (rows of these are not read or written): ${catalog.missing().join(", ")}`);
  const store = createGatewayStore({ root: o.root, raw, client, invalidateToken: () => tokens.invalidate(), catalog });
  const alertSince = o.env.MF_BUILD_FAILURE_EMAIL_SINCE;
  if (alertSince && (!Number.isFinite(Date.parse(alertSince)) || new Date(alertSince).toISOString() !== alertSince)) {
    throw new Error("MF_BUILD_FAILURE_EMAIL_SINCE must be an ISO UTC timestamp");
  }
  // the e-mail address comes from IAM; when the service role may not read IAM users (403), the alert is written in-app
  // only and the failure is settled (buildFailureNotification.ts), so the reconciliation below does not retry it
  const notifyBuildFailure = createBuildFailureNotifier(raw, async (id) => {
    const result = await (await client()).iam.users.get(id);
    const root = result.data as Record<string, unknown> | undefined;
    if (!authBodyOk(root)) throw new Error("IAM lookup failed");
    const user = (root?.data ?? root) as Record<string, unknown> | undefined;
    if (!user || (user.active !== true && user.isActive !== true)) return null;
    return str(user.email) || null;
  }, { log: (line) => log(line) });
  const eligibleFailure = async (job: Row): Promise<void> => {
    if (!readOnly && alertSince && str(job.FinishedAt) >= alertSince && acceptsWorkerJob(scope, job)) await notifyBuildFailure(job);
  };
  let alertsCheckedAt = 0;
  let maintenanceCheckedAt = 0;
  let renewalsCheckedAt = 0;
  // what people read on a job is plain (plainMessages.ts); the raw text goes to this worker's log. The driver uses
  // this same wrapped gateway.
  const gateway = plainJobWrites(store.mirrored(), { job: (id) => store.get("EngineJob", id), log: (line) => log(line), onFailed: eligibleFailure });

  const files = createFiles({
    client,
    workspaceIdOf: async (projectId) => {
      const p = store.get("Project", projectId) ?? (await store.refreshRow("Project", projectId));
      if (!p) throw new Error("project not found");
      return str(p.WorkspaceId);
    },
  });

  // the per-project folders on this PC (MF_ENGINE_ROOT/projects/<workspaceId>/<projectId>/...)
  const folderRoot = engineRoot(o.env);
  // every line about one project (its jobs, its context) also goes to that project's logs/engine.log
  const log = folderRoot ? projectLogger(folderRoot, store, o.log) : o.log;

  const baseConfig = engineConfigSource({ dataDir: o.configDir });
  // The daily Blocks skills sync only belongs to a host with the official engine home: an incapable host must never
  // claim the job (it would claim it and immediately fail it, every day), neither queue it (a capable engine might).
  const maintenanceReady = !readOnly && engineHomeReady();
  let draining = false;
  const config = () => {
    const c = baseConfig();
    return draining || readOnly ? { ...c, enabled: false } : c;
  };

  // the jobs this process works on (the driver's own list), so a project load never replaces their rows mid-run
  let engineRef: ReturnType<typeof createEngine> | null = null;
  const readChanges = changeLoader((id) => store.refreshRow("ChangeRequest", id), () => engineRef?.tick(), (line) => log(line));
  // what people do between jobs reaches the active projects' context and ledger within a minute (contextRefresh.ts)
  let refresher: ContextRefresher | null = null;
  const engine = createEngine({
    store,
    gateway,
    config,
    log,
    ...(o.env.MF_BLOCKS_REPOSITORY_URL || o.env.MF_BLOCKS_REPOSITORY_KEY ? {
      async repositoryEnvironment(project: Row, job: Row) {
        const tenantId = str(project.BlocksProjectRef), userId = str(job.RequestedByUserId) || str(job.CreatedByUserId);
        const repository = `${str(project.RepoOwner)}/${str(project.RepoName)}`, branch = str(project.RepoBranch);
        if (!tenantId || !userId || !branch) throw new Error("repository_connection_incomplete");
        return createRepositoryBroker(o.env).environmentFor({ tenantId, userId }, repository, branch);
      },
    } : {}),
    // the kinds without a real implementation fail plainly instead of writing invented results (realWorkOnly.ts)
    writers: realWorkWriterOf(writerOf),
    workerId,
    acceptsJob: (job) => acceptsWorkerJob(scope, job, maintenanceReady),
    // parallel streams: a change build starts when a stream is free and nothing running touches what its analysis
    // touches; the analyses of the project's active builds are read first when this worker does not hold them yet
    holdBack: (job) => streamsHoldBack(store, job, readChanges),
    sweepMs: 0,
    pickupDelay: false,
    backgroundProgress: true,
    waitScale: (kind) => (PACED_KINDS.has(kind) ? 1 : 0),
    ...(folderRoot ? { projectFolder: (workspaceId: string, projectId: string, opt?: { name?: string }) => projectWorkspace(folderRoot, workspaceId, projectId, opt) } : {}),
    async prepare(job) {
      if (isHostMaintenance(job.Kind)) return;
      // a periodic context refresh of this project that is under way finishes first (contextRefresh.ts)
      await refresher?.beforeJob(str(job.ProjectId), str(job.WorkspaceId));
      await store.loadProject(str(job.ProjectId), new Set(engineRef?.working() ?? []), { workspaceId: str(job.WorkspaceId) });
      refresher?.afterLoad(str(job.ProjectId));
      const p = store.get('Project', str(job.ProjectId));
      if (p) {
        const repoPath = folderRoot ? path.join(folderRoot, 'projects', str(p.WorkspaceId), str(p.ItemId), 'repo') : '';
        try { syncProjectRegistry(p, repoPath); } catch {}
      }
    },
    canResume(job) {
      // a job an earlier code generation of this process still runs to its end (see stop() below)
      if (retired.has(str(job.ItemId))) return false;
      if (str(job.ClaimedBy) === workerId) return true;
      const quiet = Date.now() - Date.parse(str(job.LastUpdatedDate) || str(job.ClaimedAt) || "1970-01-01");
      return quiet > JOB_CLAIM_LEASE_MS;
    },
    async putFile(input) {
      // Blocks Storage fails a share of calls at random (03.11.2026, like the Data Gateway): the presign and the upload
      // are tried again together, up to twice more; a new presign each time, so a repeat never reuses a spent URL.
      for (let attempt = 0; ; attempt += 1) {
        try {
          return await (async () => {
            // files the engine uploads pass the privacy guard too (text files are scrubbed; pictures are passed as they are)
            const fl = { ...input, bytes: scrubFile(input.mime, input.bytes) };
            const pre = await files.presignUpload({
              projectId: fl.projectId,
              fileName: fl.name,
              mime: fl.mime,
              sizeBytes: fl.bytes.length,
              maxBytes: MAX_UPLOAD_BYTES,
              allowedMimes: [fl.mime],
            });
            const c = await client();
            await c.data.files.uploadToUrl({ url: pre.uploadUrl, body: new Blob([new Uint8Array(fl.bytes)], { type: fl.mime }), contentType: fl.mime, headers: pre.requiredHeaders });
            return pre.fileId;
          })();
        } catch (e) {
          const code = (e as { code?: unknown })?.code;
          const transient = code === "unavailable" || code === "internal" || /unavailable|internal|timed? ?out|50[234]/i.test(e instanceof Error ? e.message : String(e));
          if (attempt >= 2 || !transient) throw e;
          await new Promise((r) => setTimeout(r, 500 * 2 ** attempt));
        }
      }
    },
    async readFile(fileId) {
      const { url } = await files.downloadUrl(fileId);
      if (!url.startsWith("https://")) return null;
      const res = await fetch(url);
      if (!res.ok) return null;
      return new Uint8Array(await res.arrayBuffer());
    },
  });
  engineRef = engine;
  const readFile = async (fileId: string): Promise<Uint8Array | null> => {
    const { url } = await files.downloadUrl(fileId);
    if (!url.startsWith("https://")) return null;
    const res = await fetch(url);
    return res.ok ? new Uint8Array(await res.arrayBuffer()) : null;
  };
  refresher = folderRoot ? createContextRefresher({ store, raw, root: folderRoot, readFile, working: () => engine.working(), log }) : null;
  let refreshTimer: ReturnType<typeof setTimeout> | null = null;
  const refreshLoop = (delay: number) => {
    refreshTimer = setTimeout(() => {
      if (stopped || draining || !refresher) return;
      void refresher.tick().finally(() => { if (!stopped && !draining) refreshLoop(CONTEXT_REFRESH_MS); });
    }, delay);
  };

  /** Fails a job through the conditional gateway (a miss means a person or another engine changed it first). */
  async function failJob(job: Row, message: string, code: string): Promise<void> {
    await gateway.update("EngineJob", str(job.ItemId), {
      Status: "failed",
      Message: message,
      ErrorCode: code,
      FinishedAt: new Date().toISOString(),
      ActiveKey: str(job.ItemId),
    });
  }

  /** True when this host's folder of the job's attempt has the outcome of its current claim (driver.ts recordedOutcome):
   *  the work ended here and the engine writes that outcome on its next look, so the time limit must not fail it. */
  function endedHere(j: Row): boolean {
    if (!folderRoot || str(j.ClaimedBy) !== workerId) return false;
    const ws = str(j.WorkspaceId), project = str(j.ProjectId), id = str(j.ItemId), attempt = num(j.Attempts) || 1;
    if (!ID.test(ws) || !ID.test(project) || !ID.test(id)) return false;
    try {
      const file = path.join(folderRoot, "projects", ws, project, "jobs", `${id}-${attempt}`, "result.json");
      return recordedOutcome(JSON.parse(fs.readFileSync(file, "utf8")), j) !== null;
    } catch {
      return false;
    }
  }

  async function enforceLimits(jobs: Row[]): Promise<void> {
    const now = Date.now();
    for (const j of jobs) {
      const kind = str(j.Kind);
      if (!isEngineJobKind(kind)) continue;
      if (j.Status === "queued" && num(j.Attempts) >= MAX_JOB_ATTEMPTS) {
        log(`[engine] ${kind} ${str(j.ItemId).slice(0, 8)}: tried ${MAX_JOB_ATTEMPTS} times, failed`);
        await failJob(j, attemptsMessage(kind, MAX_JOB_ATTEMPTS), "engine.attempts");
        continue;
      }
      const started = Date.parse(str(j.ClaimedAt));
      if ((j.Status === "claimed" || j.Status === "running") && Number.isFinite(started) && now - started > JOB_MAX_RUN_MS[kind] && !endedHere(j)) {
        log(`[engine] ${kind} ${str(j.ItemId).slice(0, 8)}: past its maximum run time, failed`);
        await failJob(j, timeLimitMessage(kind, JOB_MAX_RUN_MS[kind]), "engine.timeout");
      }
    }
  }

  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let failures = 0;
  const skippedLogged = new Set<string>();

  async function poll(): Promise<void> {
    if (stopped) return;
    const startedAt = Date.now();
    try {
      if (Date.now() - catalogAt > CATALOG_REFRESH_MS) {
        const before = catalog.missing().join(",");
        catalog = await loadCatalog(o.root, client);
        catalogAt = Date.now();
        store.setCatalog(catalog);
        if (catalog.missing().join(",") !== before) log(`[engine] tenant schemas changed; still missing: ${catalog.missing().join(", ") || "none"}`);
      }
      const jobs = await store.refreshJobs(o.since, scope);
      if (config().enabled) await enforceLimits(jobs);
      // The daily Blocks skills sync: queued by the engine itself, never collapsed even if the Blocks cron never lands.
      if (!readOnly && Date.now() - maintenanceCheckedAt > DAILY_SYNC_CHECK_MS) {
        maintenanceCheckedAt = Date.now();
        void ensureDailySkillsSync(raw, {
          now: () => new Date(),
          intervalHours: dailySyncIntervalHours(o.env),
          log,
        }).catch((e) => log(`[engine] the daily skills sync defers (${errTag(e)})`));
      }
      // Monthly renewal of paid plans (billingRenewals.ts): hourly, idempotent per period, only where billing is set up.
      if (!readOnly && renewalsEnabled(o.env) && !scope.projectIds.length && !scope.kinds.length && Date.now() - renewalsCheckedAt > RENEWAL_CHECK_MS
        && catalog.fields("Subscription") !== null && catalog.fields("Payment") !== null) {
        renewalsCheckedAt = Date.now();
        void runBillingRenewals(raw, { now: () => new Date(), env: o.env })
          .then((r) => {
            if (r.renewed.length || r.pastDue.length || r.ended.length || r.waiting.length) {
              log(`[engine] plan renewals: ${r.renewed.length} renewed, ${r.pastDue.length} past due, ${r.ended.length} ended, ${r.waiting.length} waiting for their plan in the catalogue`);
            }
          })
          .catch((e) => log(`[engine] plan renewals deferred (${errTag(e)})`));
      }
      // Failed jobs no longer appear in refreshJobs. Reconcile persisted failures after restarts or failed alert writes.
      if (!readOnly && alertSince && Date.now() - alertsCheckedAt > 60_000) {
        alertsCheckedAt = Date.now();
        try {
          for (let page = 1; ; page++) {
            // Date ranges against this tenant's date fields return nothing; apply the rollout cutoff locally.
            const failed = await raw.find("EngineJob", {
              where: f.and(f.eq("Status", "failed"), f.in("Kind", BUILD_FAILURE_KINDS),
                ...(scope.projectIds.length ? [f.in("ProjectId", scope.projectIds)] : [])),
              fields: ["ItemId", "ProjectId", "Kind", "Status", "Attempts", "FinishedAt", "Message", "ClaimedBy"],
              sort: { field: "ItemId", dir: "asc" }, page, pageSize: 100,
            });
            for (const job of failed.items) {
              try { await eligibleFailure(job); } catch (e) { log(`[engine] build failure alert deferred (${errTag(e)})`); }
            }
            if (failed.items.length < 100) break;
          }
        } catch { log("[engine] build failure alert reconciliation deferred"); }
      }
      for (const j of jobs) {
        const id = str(j.ItemId);
        if (!store.get("Project", str(j.ProjectId)) && !skippedLogged.has(id)) {
          skippedLogged.add(id);
          log(`[engine] ${str(j.Kind)} ${id.slice(0, 8)}: its project is gone, left as it is`);
        }
      }
      if (!stopped) engine.tick();
      if (failures > 0) log("[engine] Data Gateway reachable again");
      failures = 0;
    } catch (e) {
      failures += 1;
      if (failures === 1 || failures % 20 === 0) log(`[engine] poll failed (${failures}x): ${errTag(e)}`);
    } finally {
      if (!stopped) {
        const base = readOnly ? Math.max(30_000, o.pollMs ?? POLL_MS) : o.pollMs ?? POLL_MS;
        // one poll per period (the time the poll took counts), never two at once
        const wait = failures > 0 ? Math.min(30_000, base * 2 ** Math.min(failures, 4)) : Math.max(200, base - (Date.now() - startedAt));
        timer = setTimeout(() => void poll(), wait);
      }
    }
  }

  // the writers' modules are loaded now (in the background), so the first job after a start or a code reload does not
  // wait for them; a module that fails here is loaded again (and reported) by its job
  void Promise.all(ENGINE_JOB_KINDS.map((k) => writerOf(k).catch(() => undefined)));

  // the first round after a start or a code reload waits a little (reloads come in bursts while code is edited)
  if (refresher) refreshLoop(45_000);

  // Blocks projects for new Factory projects (the Blocks CLI, MF_BLOCKS_PROVISIONING_ACCOUNT): made here, on the engine
  // host, never on a web server. The web writes the Project row; its pending provisioning is picked up every 30 s.
  const provisioner = !readOnly && o.env.MF_BLOCKS_PROVISIONING_ENABLED === "true" && !scope.projectIds.length && !scope.kinds.length
    ? createProvisioner(createProvisioningStore(o.env as Record<string, string>, env.apiUrl), createProvisioningCli(o.env.MF_BLOCKS_PROVISIONING_ACCOUNT || ""))
    : null;
  const provisionScan = () => void provisioner?.scan().catch((e: unknown) => log(`[engine] Blocks provisioning scan unavailable (${errTag(e)}); queued projects stay in the Data Gateway`));
  const provisionTimer = provisioner ? setInterval(provisionScan, 30_000) : null;
  if (provisioner) provisionScan();

  // Engine & capacity: the host's heartbeat (its own timers, never in the way of the jobs; failures are only logged)
  const has = (schema: string) => catalog.fields(schema) !== null;
  const heartbeat = readOnly ? null : createHeartbeat({
    raw,
    hostId: workerId,
    stats: createHostStatsReader({ diskDir: folderRoot ?? o.root }),
    runningJobs: () => new Set([...engine.working(), ...retired.keys()]).size,
    queueLength: () => store.rows("EngineJob").filter((j) => j.Status === "queued").length,
    release: () => releaseIdOf(o.root) ?? "checkout",
    has,
    log: o.log,
  });
  heartbeat?.start();
  // The AI account pool (MF_AI_ACCOUNTS_DIR): kept across code reloads (its measurements), its rows synced here
  if (!readOnly && String(o.env.MF_AI_ACCOUNTS_DIR ?? "").trim()) {
    const probeFile = String(o.env.MF_AI_USAGE_PROBE ?? "").trim();
    if (!accountPool()) {
      installAccountPool(createAccountPool({
        env: process.env,
        stateDir: path.join(o.configDir ?? folderRoot ?? o.root, "ai-accounts"),
        log: o.log,
        probe: probeFile ? commandProbe(probeFile) : null,
      }));
    }
  }
  const pool = accountPool();
  const aiSync = pool && !readOnly ? createAiAccountSync({ raw, pool, hostId: workerId, has, log: o.log }) : null;
  aiSync?.start();

  const c = config();
  log(`[engine] MADP engine worker ${workerId} on tenant ${env.tenant.slice(0, 6)}… (code of ${EVALUATED_AT}; pace ${c.pace}${c.enabled ? "" : ", paused"}; jobs since ${o.since ?? "always"}; project folders ${folderRoot ?? "off (MF_ENGINE_ROOT not set)"}; Blocks provisioning ${provisioner ? "on" : "off"})`);
  if (pool) log(`[engine] AI accounts: ${pool.accounts().map((a) => a.label).join(", ") || "none found yet"} (rotation at ${pool.rotateAtPercent()} %)`);
  if (scope.projectIds.length || scope.kinds.length || readOnly) log(`[engine] scope: projects ${scope.projectIds.join(",") || "all"}; kinds ${scope.kinds.join(",") || "all"}; read-only ${readOnly ? "on" : "off"}`);
  void poll();

  let markFinished: () => void = () => undefined;
  const finished = new Promise<void>((resolve) => {
    markFinished = resolve;
  });
  return {
    drain() {
      draining = true;
    },
    finished: () => finished,
    // After drain() the running jobs are handed over (stop() lets them finish), so the reload need not wait for them.
    working: () => (draining ? [] : engine.working()),
    async stop() {
      stopped = true;
      if (timer) clearTimeout(timer);
      if (provisionTimer) clearInterval(provisionTimer);
      void provisioner?.stop();
      heartbeat?.stop();
      aiSync?.stop();
      if (refreshTimer) clearTimeout(refreshTimer);
      const running = engine.working();
      if (!draining || running.length === 0) {
        // shutdown: this generation's jobs and those of earlier generations are stopped (resumed by the next start)
        engine.stop();
        if (!draining) for (const end of retired.values()) end();
        markFinished();
        return;
      }
      // A code reload: the running jobs (a build takes many minutes) finish on the code they started with instead of
      // being cut and started again. The next generation leaves them alone (canResume) until they are done.
      log(`[engine] ${running.length} running job(s) finish on the code they started with`);
      const end = () => engine.stop();
      for (const id of running) retired.set(id, end);
      void engine.idle().finally(() => {
        for (const id of running) if (retired.get(id) === end) retired.delete(id);
        engine.stop();
        markFinished();
      });
    },
  };
}

/** "[engine] board.plan 88e5be9c done …", "[engine] job 88e5be9c failed …", "[engine] context of 5c3d2e1f: …". */
const LINE_ID = /^\[engine\] (?:job |context of )?(?:[a-z]+(?:\.[a-z]+)+ )?([0-9a-f]{8})\b/;

/** The worker's log, with each line about one project also appended to <project folder>/logs/engine.log (only when
 *  the folder exists: it is never made here). A line whose project is not known stays in the worker's log only. */
export function projectLogger(root: string, store: { rows(schema: string): readonly Row[] }, log: (line: string) => void): (line: string) => void {
  const known = new Map<string, { workspaceId: string; projectId: string }>();
  const find = (prefix: string): { workspaceId: string; projectId: string } | null => {
    const hit = known.get(prefix);
    if (hit) return hit;
    const job = store.rows("EngineJob").find((j) => str(j.ItemId).startsWith(prefix));
    const project = job ? null : store.rows("Project").find((r) => str(r.ItemId).startsWith(prefix));
    const v = job ? { workspaceId: str(job.WorkspaceId), projectId: str(job.ProjectId) } : project ? { workspaceId: str(project.WorkspaceId), projectId: str(project.ItemId) } : null;
    if (!v || !ID.test(v.workspaceId) || !ID.test(v.projectId)) return null;
    if (known.size > 2000) known.clear();
    known.set(prefix, v);
    return v;
  };
  return (line: string) => {
    log(line);
    try {
      const m = LINE_ID.exec(line);
      const where = m ? find(m[1]!) : null;
      if (!where) return;
      const dir = path.join(root, "projects", where.workspaceId, where.projectId, "logs");
      if (!fs.existsSync(dir)) return;
      fs.appendFileSync(path.join(dir, "engine.log"), `${new Date().toISOString()} ${line}\n`);
    } catch {
      /* the worker's own log has the line */
    }
  };
}
