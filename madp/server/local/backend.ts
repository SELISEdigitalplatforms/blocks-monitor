// The functions side of the local host, loaded through Vite's SSR loader (so an edited op or rule is live on the next
// request): the six routers built exactly as functions/<fn>/index.ts builds them, with local adapters — the SQLite
// gateway, local Storage, and the local platform client (service token, IAM with the caller's own token). Also the
// pieces that must share the functions' module instances: the purge tick, the public share and plans handlers, the engine hook
// and the seed target.
import adminOps from "mf:ops/admin";
import billingOps from "mf:ops/billing";
import collabOps from "mf:ops/collab";
import deliveryOps from "mf:ops/delivery";
import engineOps from "mf:ops/engine";
import projectOps from "mf:ops/project";
import workspaceOps from "mf:ops/workspace";
import aclSchemas from "mf:schemas/acl";
import { OpError } from "../../functions/_lib/errors";
import { uuid5 } from "../../functions/_lib/ids";
import { guardPaging } from "../../functions/_lib/paging";
import { onProjectPurgeWake, runPurgeTick, type PurgeOptions } from "../../functions/_lib/purge";
import { createFunction } from "../../functions/_lib/router";
import type { SdkFactory } from "../../functions/_lib/sdk";
import type { FilesService } from "../../functions/_lib/storage";
import type { FunctionHandler, HostAdapters } from "../../functions/_lib/types";
import type { FnFunctionName } from "../../src/domain/fnContract";
import { createPublicPlansHandler } from "../fnHost/publicPlans.ts";
import { createPublicI18nHandler } from "../fnHost/publicI18n.ts";
import { createPublicShareHandler } from "../fnHost/publicShare.ts";
import { startDoorbellMail } from "./doorbell.ts";
import { startEngineHook } from "./engine/index.ts";
import "./engine/local.ts";
import { createLocalGateway } from "./gateway.ts";
import { createLocalSdk } from "./iam/sdk.ts";
import { runtime } from "./runtime.ts";
import { createSeedTarget } from "./seedTarget.ts";
import { createLocalFiles } from "./storageService.ts";

const OPS: Record<FnFunctionName, readonly unknown[]> = {
  workspace: workspaceOps,
  project: projectOps,
  delivery: deliveryOps,
  collab: collabOps,
  admin: adminOps,
  engine: engineOps,
  billing: billingOps,
};

export interface Backend {
  routers: Record<FnFunctionName, FunctionHandler>;
  files: FilesService;
  purge: {
    runProjectPurgeTick(platform: unknown, opts?: PurgeOptions): ReturnType<typeof runPurgeTick>;
    onProjectPurgeWake: typeof onProjectPurgeWake;
  };
  publicShare: ReturnType<typeof createPublicShareHandler>;
  publicPlans: ReturnType<typeof createPublicPlansHandler>;
  publicI18n: ReturnType<typeof createPublicI18nHandler>;
  stop(): void;
}

let built: Backend | null = null;

/** One backend per evaluation of this module (a re-evaluated module builds a fresh one). */
export function getBackend(o: { expectedHost: string }): Backend {
  if (built) return built;
  const rt = runtime();
  const log = (line: string) => rt.log("info", line);
  const raw = createLocalGateway(rt.store);
  const workspaceIdOf = async (projectId: string): Promise<string> => {
    const ws = rt.store.get("Project", projectId)?.WorkspaceId;
    if (typeof ws !== "string" || !ws) throw new OpError("not_found");
    return ws;
  };
  const files = createLocalFiles(rt, workspaceIdOf);
  const sdk = createLocalSdk({ db: rt.db, appOrigin: () => rt.appOrigin, log }) as unknown as SdkFactory;
  const adapters: HostAdapters = { sdk, rawGateway: () => raw, files: () => files };
  const routers = Object.fromEntries(
    (Object.keys(OPS) as FnFunctionName[]).map((name) => [name, createFunction({ name, ops: OPS[name], aclSchemas }, adapters)]),
  ) as Record<FnFunctionName, FunctionHandler>;

  const purgeRaw = guardPaging(raw);
  const purge: Backend["purge"] = {
    runProjectPurgeTick: (_platform, opts) =>
      runPurgeTick(
        {
          raw: purgeRaw,
          files: {
            async remove(fileId) {
              try {
                await files.remove(fileId);
              } catch (e) {
                if (!(e instanceof OpError && e.code === "not_found")) throw e;
              }
            },
          },
          ids: { uuid5: (name) => uuid5(name) },
          now: () => new Date(),
          log: (level, line) => rt.log(level, line),
        },
        opts,
      ),
    onProjectPurgeWake,
  };

  startDoorbellMail(rt);
  const stopEngine = startEngineHook({ gateway: purgeRaw, store: rt.store, log });
  built = {
    routers,
    files,
    purge,
    publicShare: createPublicShareHandler({ raw: purgeRaw, files, expectedHost: o.expectedHost, log }),
    publicPlans: createPublicPlansHandler({ raw: purgeRaw, expectedHost: o.expectedHost, log }),
    // the local adapter has no Blocks UILM: the app shows its bundled texts
    publicI18n: createPublicI18nHandler({ read: null, expectedHost: o.expectedHost }),
    stop() {
      stopEngine();
      rt.store.onChange("doorbell-mail", null);
    },
  };
  return built;
}

/** The seed target over the same store (npm run reset). */
export function seedTarget(now = new Date()) {
  return createSeedTarget(runtime(), now);
}
