import { createBlocksClient } from "@seliseblocks/client";
import { serviceTokens } from "../../functions/_lib/serviceToken.ts";
import { defaultSdk } from "../../functions/_lib/sdk.ts";
import { decryptGithubToken, encryptGithubToken } from "./githubCrypto.ts";

export interface GithubCredential { token: string; login: string; connectedAt: string }
export interface GithubCredentialStore {
  get(userId: string): Promise<GithubCredential | null>;
  save(userId: string, credential: GithubCredential): Promise<void>;
  disconnect(userId: string): Promise<void>;
}
const rec = (v: unknown): Record<string, unknown> => v && typeof v === "object" && !Array.isArray(v) ? v as Record<string, unknown> : {};
export function createGithubStore(env: Record<string, string>, apiUrl: string, key: Buffer): GithubCredentialStore {
  const config = { apiUrl, tenant: env.MF_BLOCKS_TENANT || env.VITE_BLOCKS_PROJECT_KEY, clientId: env.MF_SVC_CLIENT_ID, clientSecret: env.MF_SVC_CLIENT_SECRET };
  if (!config.tenant || !config.clientId || !config.clientSecret) throw new Error("github_not_configured");
  const tokens = serviceTokens(config, defaultSdk);
  const client = createBlocksClient({ apiUrl, xBlocksKey: config.tenant, accessToken: () => tokens.token() });
  const collection = client.data.collection("GithubConnection", { fields: ["ItemId", "UserId", "Login", "ConnectedAt", "TokenCiphertext"] });
  function data(value: unknown) {
    const root = rec(value);
    if ((Array.isArray(root.errors) && root.errors.length) || !root.data || typeof root.data !== "object") throw new Error("github_store_unavailable");
    return rec(root.data);
  }
  async function row(userId: string) {
    const result = rec(data(await collection.list({ pageNo: 1, pageSize: 2, filter: { UserId: userId } })).getGithubConnections);
    if (!Array.isArray(result.items) || result.items.length > 1) throw new Error("github_store_unavailable");
    return result.items.length ? rec(result.items[0]) : null;
  }
  function acknowledged(result: unknown, operation: string) {
    if (rec(data(result)[operation]).acknowledged !== true) throw new Error("github_store_unavailable");
  }
  return {
    async get(userId) {
      const found = await row(userId);
      if (!found || !found.TokenCiphertext) return null;
      if (typeof found.TokenCiphertext !== "string" || typeof found.Login !== "string" || typeof found.ConnectedAt !== "string") throw new Error("github_store_unavailable");
      return { token: decryptGithubToken(key, config.tenant, userId, found.TokenCiphertext), login: found.Login, connectedAt: found.ConnectedAt };
    },
    async save(userId, credential) {
      const found = await row(userId);
      const patch = { UserId: userId, Login: credential.login, ConnectedAt: credential.connectedAt,
        TokenCiphertext: encryptGithubToken(key, config.tenant, userId, credential.token) };
      if (found && typeof found.ItemId === "string") acknowledged(await collection.update(found.ItemId, patch), "updateGithubConnection");
      else acknowledged(await collection.create(patch), "insertGithubConnection");
    },
    async disconnect(userId) {
      const found = await row(userId);
      if (typeof found?.ItemId === "string") acknowledged(await collection.update(found.ItemId, { TokenCiphertext: "", Login: "", ConnectedAt: "" }), "updateGithubConnection");
    },
  };
}
