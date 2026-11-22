import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadEnv } from "vite";
import { createBlocksClient } from "@seliseblocks/client";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const env = loadEnv("development", root, "");
const config = { apiUrl: env.VITE_BLOCKS_API_URL, xBlocksKey: env.MF_BLOCKS_TENANT };
try {
  const publicClient = createBlocksClient(config);
  const login = await publicClient.auth.loginOptions();
  console.log(JSON.stringify({ check: "login-options", available: Boolean(login), grantTypes: login?.allowedGrantTypes ?? [] }));
  const result = await publicClient.auth.oidc.clientCredentials({ clientId: env.MF_SVC_CLIENT_ID, clientSecret: env.MF_SVC_CLIENT_SECRET });
  const token = result?.access_token ?? result?.accessToken ?? result?.data?.access_token ?? result?.data?.accessToken;
  if (typeof token !== "string" || !token) throw new Error("service_auth_failed");
  const service = createBlocksClient({ ...config, accessToken: token });
  const response = await service.data.graphql({
    operationName: "workspaceAccessProbe",
    query: "query workspaceAccessProbe { getAccounts(input: {pageNo: 1, pageSize: 1}) { totalCount } getMemberships(input: {pageNo: 1, pageSize: 1}) { totalCount } getInvitations(input: {pageNo: 1, pageSize: 1}) { totalCount } getWorkspaces(input: {pageNo: 1, pageSize: 1}) { totalCount } }",
  });
  const ok = response && !response.errors?.length && response.data;
  console.log(JSON.stringify({ check: "service-workspace-read", ok: Boolean(ok),
    // Counts only: no account identifiers, emails, records or credentials are printed.
    counts: ok ? Object.fromEntries(Object.entries(response.data).map(([key, value]) => [key, value?.totalCount])) : undefined }));
  if (!ok) process.exitCode = 1;
} catch {
  console.error("Blocks authentication/service probe failed. No credentials or response bodies were printed.");
  process.exitCode = 1;
}
