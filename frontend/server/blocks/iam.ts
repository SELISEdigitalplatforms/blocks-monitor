import { createBlocksClient } from "@seliseblocks/client";
import { authBodyOk, classifyLogin, readTokens, isServerFailure } from "../../src/blocks/iamResult.ts";
import type { FnEnv } from "../../functions/_lib/env.ts";
import { IamRejected, profileLanguageCode, type IamAuth, type IamTokens, type IamUser } from "../fnHost/iamAuth.ts";

const record = (v: unknown): Record<string, unknown> => v && typeof v === "object" && !Array.isArray(v) ? v as Record<string, unknown> : {};
const text = (v: unknown): string => typeof v === "string" ? v : "";
const strings = (v: unknown): string[] => Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];

export function readIamUser(body: unknown): IamUser {
  if (!authBodyOk(body)) throw new IamRejected(401);
  const root = record(body);
  const data = root.data && typeof root.data === "object" ? record(root.data) : root;
  const itemId = text(data.itemId) || text(data.userId) || text(data.sub);
  const email = text(data.email).trim().toLowerCase();
  if (!itemId || !email) throw new IamRejected(401);
  return {
    itemId, email, firstName: text(data.firstName) || text(data.given_name),
    lastName: text(data.lastName) || text(data.family_name), displayName: text(data.displayName) || text(data.name),
    roles: strings(data.roles), permissions: strings(data.permissions),
    active: data.active === true || data.isActive === true,
    organizationId: text(data.organizationId) || "default",
    ...(text(data.language) ? { language: text(data.language) } : {}),
  };
}

/** All network access uses the official SDK. A cookie jar is held only inside encrypted server sessions.
 * Identity comes ONLY from Blocks IAM (one project = its IAM users): there is no app-level user mirror or
 * eligibility layer. Workspace authorization is the ops' job (membership rows), never a login gate. */
export function createBlocksIam(env: FnEnv, fetchImpl: typeof fetch = globalThis.fetch): IamAuth {
  function client(token?: string, cookie = "") {
    const jar = new Map<string, string>();
    for (const pair of cookie.split(";")) {
      const at = pair.indexOf("=");
      if (at > 0) jar.set(pair.slice(0, at).trim(), pair.slice(at + 1).trim());
    }
    const sdk = createBlocksClient({
      apiUrl: env.apiUrl, xBlocksKey: env.tenant, accessToken: token,
      fetch: async (input, init) => {
        const headers = new Headers(init?.headers);
        if (jar.size) headers.set("cookie", [...jar].map(([key, value]) => `${key}=${value}`).join("; "));
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 12_000);
        try {
          const response = await fetchImpl(input, { ...init, headers, signal: controller.signal });
          for (const set of response.headers.getSetCookie()) {
            const pair = set.split(";", 1)[0];
            const at = pair.indexOf("=");
            if (at > 0) {
              const key = pair.slice(0, at).trim();
              if (/max-age=0(?:;|$)/i.test(set)) jar.delete(key);
              else jar.set(key, pair.slice(at + 1).trim());
            }
          }
          return response;
        } finally { clearTimeout(timeout); }
      },
    });
    return { sdk, jar, cookie: () => [...jar].map(([key, value]) => `${key}=${value}`).join("; ") };
  }

  async function tokensFrom(body: unknown, transport: ReturnType<typeof client>): Promise<IamTokens | null> {
    if (!authBodyOk(body)) return null;
    const tokens = readTokens(body);
    let accessToken = tokens?.accessToken;
    // Some tenants set token cookies rather than returning tokens in the body. Do not guess
    // cookie names or trust decoded claims: candidate access tokens must pass live iam.me().
    if (!accessToken) {
      for (const raw of transport.jar.values()) {
        let candidate: string;
        try { candidate = decodeURIComponent(raw); } catch { continue; }
        if (!/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(candidate)) continue;
        try { readIamUser(await client(candidate).sdk.iam.me()); accessToken = candidate; break; } catch { /* not an access token */ }
      }
    }
    if (!accessToken) return null;
    const user = readIamUser(await client(accessToken).sdk.iam.me());
    let expiresAtMs = Date.now() + (tokens?.expiresInSec ?? 900) * 1000;
    try {
      const claims = record(JSON.parse(Buffer.from(accessToken.split(".")[1], "base64url").toString("utf8")));
      if (typeof claims.exp === "number") expiresAtMs = Math.min(expiresAtMs, claims.exp * 1000);
    } catch { /* live IAM validation, not JWT decoding, determines identity */ }
    const cookie = transport.cookie();
    const refreshToken = tokens?.refreshToken || (cookie ? "cookie-session" : "");
    if (!refreshToken || expiresAtMs <= Date.now()) return null;
    return { accessToken, refreshToken, expiresAtMs, userId: user.itemId, ...(cookie ? { refreshCookie: cookie } : {}) };
  }

  return {
    async login(email, password) {
      try {
        const transport = client();
        const result = await transport.sdk.auth.login({ username: email.trim().toLowerCase(), password });
        if (!authBodyOk(result)) return { ok: false, reason: isServerFailure(result) ? "unavailable" : classifyLogin(result) };
        const tokens = await tokensFrom(result, transport);
        return tokens ? { ok: true, tokens } : { ok: false, reason: "extra-step" };
      } catch { return { ok: false, reason: "unavailable" }; }
    },
    async refresh(session) {
      try {
        const transport = client(undefined, session.refreshCookie);
        const result = await transport.sdk.auth.refresh(session.refreshToken === "cookie-session" ? {} : { refreshToken: session.refreshToken });
        if (!authBodyOk(result)) return { ok: false, refused: !isServerFailure(result) };
        const tokens = await tokensFrom(result, transport);
        return tokens ? { ok: true, tokens } : { ok: false, refused: true };
      } catch { return { ok: false, refused: false }; }
    },
    async me(accessToken) {
      let user: IamUser;
      try { user = readIamUser(await client(accessToken).sdk.iam.me()); }
      catch (error) {
        if (error instanceof IamRejected || (error && typeof error === "object" && "status" in error && (error.status === 401 || error.status === 403))) throw new IamRejected(401);
        throw error;
      }
      if (!user.active) throw new IamRejected(401);
      return user;
    },
    async logout(session) {
      const transport = client(session.accessToken, session.refreshCookie);
      return authBodyOk(await transport.sdk.auth.logout(session.refreshToken === "cookie-session" ? {} : { refreshToken: session.refreshToken }));
    },
    async logoutAll(token) { return client(token).sdk.auth.logoutAll(); },
    /** The person's own IAM profile (POST /iam/v4/iam/me through the SDK): the language, with the names as IAM holds
     *  them, so an update that replaces the profile fields keeps them. */
    async setLanguage(accessToken, language) {
      const sdk = client(accessToken).sdk;
      const user = readIamUser(await sdk.iam.me());
      if (!user.active) throw new IamRejected(401);
      return authBodyOk(await sdk.iam.updateMe({ firstName: user.firstName, lastName: user.lastName, language: profileLanguageCode(language) }));
    },
    async relay(flow, payload, token) {
      const auth = client(token).sdk.auth;
      switch (flow) {
        case "recover": return auth.recover(payload);
        case "resendActivation": return auth.resendActivation(payload);
        case "validateActivation": return auth.validateActivation(payload);
        case "activate": return auth.activate(payload);
        case "resetPassword": return auth.resetPassword(payload);
        case "changePassword": return auth.changePassword(payload);
      }
    },
  };
}
