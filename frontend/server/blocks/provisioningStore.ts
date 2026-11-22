import { createBlocksClient } from "@seliseblocks/client";
import { serviceTokens } from "../../functions/_lib/serviceToken.ts";
import { defaultSdk } from "../../functions/_lib/sdk.ts";
import { PROVISIONING_FIELDS, type ProvisioningRow, type ProvisioningStore } from "./provisioning.ts";

const rec = (v: unknown): Record<string, unknown> => v && typeof v === "object" && !Array.isArray(v) ? v as Record<string, unknown> : {};
export function createProvisioningStore(env: Record<string, string>, apiUrl: string): ProvisioningStore {
  const config = { apiUrl, tenant: env.MF_BLOCKS_TENANT || env.VITE_BLOCKS_PROJECT_KEY, clientId: env.MF_SVC_CLIENT_ID, clientSecret: env.MF_SVC_CLIENT_SECRET };
  if (!config.tenant || !config.clientId || !config.clientSecret) throw new Error("provisioning_not_configured");
  const tokens = serviceTokens(config, defaultSdk);
  const client = createBlocksClient({ apiUrl, xBlocksKey: config.tenant, accessToken: () => tokens.token() });
  function data(value: unknown) {
    const root = rec(value);
    if (Array.isArray(root.errors) && root.errors.length) throw new Error("provisioning_gateway_failed");
    if (!root.data || typeof root.data !== "object") throw new Error("provisioning_gateway_failed");
    return rec(root.data);
  }
  const collection = client.data.collection("Project", { fields: PROVISIONING_FIELDS });
  function items(value: unknown): ProvisioningRow[] {
    const result = rec(data(value).getProjects);
    if (!Array.isArray(result.items)) throw new Error("provisioning_gateway_failed");
    return result.items.map(rec);
  }
  return {
    async get(id) { return items(await collection.get(id))[0] ?? null; },
    async list() {
      const rows: ProvisioningRow[] = [];
      for (let pageNo = 1; ; pageNo++) {
        const page = items(await collection.list({ pageNo, pageSize: 100, filter: { Status: "active", BlocksProvisioningStatus: { $in: ["pending", "creating", "needs-reconciliation"] } }, sort: { _id: 1 } })); // the gateway ignores a sort on ItemId (src/domain/gatewaySort.ts)
        rows.push(...page);
        if (page.length < 100) return rows;
      }
    },
    async change(row, patch) {
      const filter = JSON.stringify({ ItemId: row.ItemId, Status: "active", BlocksProjectRef: row.BlocksProjectRef ?? null,
        BlocksProvisioningStatus: row.BlocksProvisioningStatus ?? null, BlocksProvisioningName: row.BlocksProvisioningName ?? null,
        BlocksProvisioningAt: row.BlocksProvisioningAt ?? null });
      const result = rec(data(await client.data.graphql({
        query: "mutation ClaimFactoryProvisioning($filter: String, $input: ProjectUpdateInput!) { updateProject(filter: $filter, input: $input) { acknowledged totalImpactedData } }",
        variables: { filter, input: patch },
      })).updateProject);
      if (result.acknowledged !== true || typeof result.totalImpactedData !== "number") throw new Error("provisioning_gateway_failed");
      return result.totalImpactedData === 1;
    },
  };
}
