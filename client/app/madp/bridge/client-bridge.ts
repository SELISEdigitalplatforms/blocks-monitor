/**
 * Client bridge: reconfigures MADP's @seliseblocks/client to use genesis-os tokens
 * instead of the BFF cookie pattern.
 */
import { getGenesisAccessToken } from "./auth-bridge";

/**
 * Returns a fetch wrapper that injects the genesis-os access token
 * into outgoing requests to the Blocks API.
 */
export function createBridgedFetch(): typeof fetch {
  return async (input: RequestInfo | URL, init?: RequestInit) => {
    const token = getGenesisAccessToken();
    const headers = new Headers(init?.headers);
    if (token && !headers.has("Authorization")) {
      headers.set("Authorization", `Bearer ${token}`);
    }
    return fetch(input, { ...init, headers });
  };
}

/**
 * Returns the Blocks API URL from the shell's runtime env.
 * Falls back to the MADP default if not configured.
 */
export function getBlocksApiUrl(): string {
  const env = (window as unknown as Record<string, unknown>).__BLOCKS_ENV__ as Record<string, string> | undefined;
  return env?.BLOCKS_IAM_BASE_URL?.replace("/iam.", "/api.") || "https://blocksapi.slsblx.com";
}

/**
 * Returns the project key from the shell's runtime env.
 */
export function getBlocksProjectKey(): string {
  const env = (window as unknown as Record<string, unknown>).__BLOCKS_ENV__ as Record<string, string> | undefined;
  return env?.BLOCKS_X_BLOCKS_KEY || "";
}
