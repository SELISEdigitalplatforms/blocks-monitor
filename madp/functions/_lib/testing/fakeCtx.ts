// Test kit only: a platform ctx with a valid env, a fake secret and a fake SDK that never touches the network.
import type { PlatformCtx } from "../types";
import type { SdkFactory } from "../sdk";

const b64 = (v: unknown): string => Buffer.from(JSON.stringify(v)).toString("base64url");

/** header.payload.signature, base64url; the signature is not real. */
export function fakeJwt(claims: Record<string, unknown>): string {
  return `${b64({ alg: "RS256", typ: "JWT" })}.${b64(claims)}.${Buffer.from("fake-signature").toString("base64url")}`;
}

export const FAKE_ENV: Record<string, string> = {
  BLOCKS_API_URL: "https://api.test.invalid",
  BLOCKS_TENANT: "TENANT-TEST",
  SVC_CLIENT_ID: "svc-client-test",
  SVC_CLIENT_SECRET: "fake-secret-not-real",
};

export type LogEntry = { level: "info" | "warn" | "error"; args: unknown[] };

export type FakeCtx = {
  platformCtx: PlatformCtx;
  sdk: SdkFactory;
  logs: LogEntry[];
  tokenRequests(): number;
};

function denied(path: string): any {
  return new Proxy(function () {}, {
    get: (_t, key) => denied(`${path}.${String(key)}`),
    apply: () => {
      throw new Error("network disabled in tests");
    },
  });
}

let runCounter = 0;

export function fakeCtx(
  o: {
    userId?: string;
    email?: string;
    roles?: string[];
    tenantId?: string;
    env?: Record<string, string> | null;
    attempt?: number;
    impersonated?: boolean;
    isAuthenticated?: boolean;
    callerToken?: string;
    /** The caller's token and its IAM organization as Host A passes them to billing. */
    utilitiesCaller?: { token: string; organizationId: string | null };
    iam?: unknown;
    auth?: Record<string, unknown>;
  } = {},
): FakeCtx {
  const logs: LogEntry[] = [];
  let tokens = 0;
  const env = o.env === null ? {} : { ...FAKE_ENV, ...(o.env ?? {}) };
  const log = (level: LogEntry["level"]) => (...args: unknown[]) => void logs.push({ level, args });
  const sdk: SdkFactory = (() => ({
    auth: {
      oidc: {
        clientCredentials: async () => {
          tokens++;
          return { access_token: fakeJwt({ exp: Math.floor(Date.now() / 1000) + 3600, roles: ["mf-service"], sub: "svc" }) };
        },
      },
      ...(o.auth ?? {}),
    },
    data: denied("data"),
    iam: o.iam ?? denied("iam"),
  })) as unknown as SdkFactory;
  const platformCtx = {
    context: {
      tenantId: o.tenantId ?? "TENANT-TEST",
      userId: o.userId ?? "user-1",
      organizationId: null,
      roles: o.roles ?? ["mf-user"],
      permissions: [],
      email: o.email ?? "user1@selisegroup.com",
      isAuthenticated: o.isAuthenticated ?? true,
      impersonated: o.impersonated ?? false,
      applicationDomain: "localhost",
    },
    env,
    run: { id: `run-${++runCounter}`, attempt: o.attempt ?? 1 },
    log: { info: log("info"), warn: log("warn"), error: log("error") },
  } as unknown as PlatformCtx;
  if (o.callerToken) platformCtx.callerToken = o.callerToken;
  if (o.utilitiesCaller) platformCtx.utilitiesCaller = o.utilitiesCaller;
  return { platformCtx, sdk, logs, tokenRequests: () => tokens };
}
