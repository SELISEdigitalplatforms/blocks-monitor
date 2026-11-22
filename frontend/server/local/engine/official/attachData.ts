// The Factory's data for the attach command (attach.ts), the way the engine worker reaches it: the Data Gateway of the
// Factory tenant as the Factory service identity (MF_BLOCKS_TENANT, MF_SVC_CLIENT_ID, MF_SVC_CLIENT_SECRET,
// VITE_BLOCKS_API_URL), every write through the engine's privacy guard. The link to the product's Blocks project is the
// provisioner's own compare-and-set (provisioningStore.ts, ClaimFactoryProvisioning). Credentials are never printed.
import { createRawGateway, type Row } from "../../../../functions/_lib/gateway";
import { f } from "../../../../functions/_lib/filter";
import { defaultSdk } from "../../../../functions/_lib/sdk";
import { serviceTokens } from "../../../../functions/_lib/serviceToken";
import { privateRaw } from "../../../blocks/engineWorker/privacy.ts";
import { createProvisioningStore } from "../../../blocks/provisioningStore.ts";
import type { FactoryData } from "./attach.ts";

const PROJECT_FIELDS = [
  "ItemId", "Name", "Status", "WorkspaceId", "ReaderIds", "CreatedByUserId", "Stage", "Rev", "RepoMode",
  "BlocksProjectRef", "BlocksProjectDomain", "BlocksProvisioningStatus", "BlocksProvisioningName", "BlocksProvisioningAt", "BlocksProvisioningError",
] as const;
const RELEASE_FIELDS = ["ItemId", "Environment", "Version", "Url", "Status"] as const;

/** The Factory's data as the engine's service identity, or null when this host has none configured. */
export function serviceFactoryData(env: Record<string, string | undefined>): FactoryData | null {
  const fnEnv = {
    apiUrl: (env.VITE_BLOCKS_API_URL || "https://blocksapi.slsblx.com").replace(/\/+$/, ""),
    tenant: env.MF_BLOCKS_TENANT || env.VITE_BLOCKS_PROJECT_KEY || "",
    clientId: env.MF_SVC_CLIENT_ID || "",
    clientSecret: env.MF_SVC_CLIENT_SECRET || "",
  };
  if (!fnEnv.tenant || !fnEnv.clientId || !fnEnv.clientSecret) return null;
  const tokens = serviceTokens(fnEnv, defaultSdk);
  const raw = privateRaw(createRawGateway({ env: fnEnv, sdk: defaultSdk, tokens, batch: false }), env as NodeJS.ProcessEnv);
  const provisioning = createProvisioningStore(
    { MF_BLOCKS_TENANT: fnEnv.tenant, MF_SVC_CLIENT_ID: fnEnv.clientId, MF_SVC_CLIENT_SECRET: fnEnv.clientSecret },
    fnEnv.apiUrl,
  );
  return {
    project: (projectId) => raw.get("Project", projectId, PROJECT_FIELDS),
    releases: (projectId) => raw.findAll("Release", { where: f.eq("ProjectId", projectId), fields: RELEASE_FIELDS, max: 500 }),
    link: (row: Row, patch: Row) => provisioning.change(row, patch),
    insertRelease: (row) => raw.insert("Release", row),
    updateProject: (itemId, patch) => raw.update("Project", itemId, patch),
  };
}
