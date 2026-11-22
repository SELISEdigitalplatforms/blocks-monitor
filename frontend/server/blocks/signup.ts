// The sign-up backend of the Blocks host. Public sign-up has no caller token, so the server acts as its service
// identity (client credentials): IAM user create / activate / read, the SignUp, AuditEvent and PlatformSetting rows
// (data rules: service writes only), and Blocks Mail with the project's default outbound configuration. Tenant
// self-signup (IAM signup-settings) stays OFF: this server is the only way in, with its rate limits and checks.
// The service role therefore needs these IAM rights (blocks/mail/README.md, "Sign-up"); a refusal is reported, never hidden.
import { randomUUID } from "node:crypto";
import { sanitizeDetails } from "../../functions/_lib/audit.ts";
import type { FnEnv } from "../../functions/_lib/env.ts";
import { f } from "../../functions/_lib/filter.ts";
import { createRawGateway, type RawGateway, type Row } from "../../functions/_lib/gateway.ts";
import { defaultSdk, type SdkClient, type SdkFactory } from "../../functions/_lib/sdk.ts";
import { serviceClient, serviceTokens } from "../../functions/_lib/serviceToken.ts";
import { signupModeOf, SIGNUP_SETTING_KEY, type SignupMode } from "../../src/domain/signup.ts";
import { IAM_USER_ROLE } from "../../functions/admin/ops/people/shared.ts";
import { SIGNUP_SCHEMA, signupFromRow, signupToRow, type SignupBackend } from "../fnHost/signup.ts";

const SIGNUP_FIELDS = [
  "ItemId", "UserId", "Email", "Name", "OrganizationName", "PlanKey", "Status", "TokenHash", "TokenExpiresAt",
  "SentCount", "LastSentAt", "VerifiedAt", "WorkspaceId",
] as const;

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const text = (v: unknown): string => (typeof v === "string" ? v : "");

/** IAM answers 200 with isSuccess:false (and an error map) for refusals. */
const refused = (res: unknown): boolean =>
  isObject(res) && (res.isSuccess === false || (isObject(res.errors) && Object.keys(res.errors).length > 0));

const errorText = (res: unknown): string => {
  if (!isObject(res) || !isObject(res.errors)) return "";
  return Object.values(res.errors).filter((v): v is string => typeof v === "string").join(" ").toLowerCase();
};

/** How long the sign-up mode read is reused (a change in Platform -> Settings applies within this time). */
const MODE_CACHE_MS = 15_000;

export function createBlocksSignupBackend(
  env: FnEnv,
  o: { sdk?: SdkFactory; log?(line: string): void; gateway?: RawGateway; now?(): number } = {},
): SignupBackend {
  const sdk = o.sdk ?? defaultSdk;
  const now = o.now ?? Date.now;
  const tokens = serviceTokens(env, sdk);
  const client: () => Promise<SdkClient> = serviceClient(env, sdk, tokens);
  const gateway = o.gateway ?? createRawGateway({ env, sdk, tokens });
  const log = (line: string) => {
    try {
      o.log?.(line);
    } catch {
      /* logging never breaks a request */
    }
  };
  let modeCache: { at: number; mode: SignupMode } | null = null;

  async function signupRow(where: ReturnType<typeof f.eq>): Promise<Row | null> {
    const res = await gateway.find(SIGNUP_SCHEMA, { where, fields: SIGNUP_FIELDS, page: 1, pageSize: 5 });
    // the newest row of an address (a later sign-up after an admin removed the account)
    return res.items[res.items.length - 1] ?? null;
  }

  async function findUser(email: string): Promise<{ userId: string; active: boolean; firstName: string } | null> {
    const c = (await client()) as any;
    const res = await c.iam.users.list({ page: 0, pageSize: 5, filter: { email } });
    if (refused(res)) throw new Error("iam_refused");
    const rows: unknown[] = isObject(res) && Array.isArray(res.data) ? res.data : [];
    const hit = rows.find((u) => isObject(u) && text(u.email).trim().toLowerCase() === email);
    if (!isObject(hit) || !text(hit.itemId)) return null;
    return { userId: text(hit.itemId), active: hit.active === true || hit.isActive === true, firstName: text(hit.firstName) };
  }

  return {
    async mode() {
      if (modeCache && now() - modeCache.at < MODE_CACHE_MS) return modeCache.mode;
      const res = await gateway.find("PlatformSetting", { where: f.eq("Key", SIGNUP_SETTING_KEY), fields: ["ItemId", "Key", "ValueJson"], page: 1, pageSize: 1 });
      const mode = signupModeOf(res.items[0]?.ValueJson);
      modeCache = { at: now(), mode };
      return mode;
    },

    findUser,

    async createUser(u) {
      const c = (await client()) as any;
      let res: unknown;
      try {
        res = await c.iam.users.create({
          email: u.email, firstName: u.firstName, lastName: u.lastName, roles: [IAM_USER_ROLE], password: u.password,
        });
      } catch (e) {
        const status = isObject(e) && typeof e.status === "number" ? e.status : null;
        log(`[auth] sign-up: IAM user create failed (status ${status ?? "none"})`);
        return { ok: false, reason: "unavailable" };
      }
      if (refused(res)) {
        const why = errorText(res).split(u.password).join("");
        if (/exist|duplicate|already|taken/.test(why)) return { ok: false, reason: "exists" };
        if (/password|weak|policy|length|character|complex/.test(why)) return { ok: false, reason: "password" };
        log(`[auth] sign-up: IAM refused the user create (status ${isObject(res) && typeof res.status === "number" ? res.status : "none"})`);
        return { ok: false, reason: "unavailable" };
      }
      const data = isObject(res) ? (isObject(res.data) ? res.data : res) : {};
      let userId = text(data.itemId) || text(data.userId) || (typeof res === "object" && res !== null ? text((res as Record<string, unknown>).itemId) : "");
      if (!userId) userId = (await findUser(u.email))?.userId ?? "";
      if (!userId) return { ok: false, reason: "unavailable" };
      return { ok: true, userId };
    },

    async activateUser(userId) {
      const c = (await client()) as any;
      try {
        const res = await c.iam.users.activate({ userId, reason: "Email address verified at sign-up" });
        if (refused(res)) {
          log("[auth] sign-up: IAM refused to activate a verified account");
          return false;
        }
        return true;
      } catch {
        return false;
      }
    },

    async userById(userId) {
      const c = (await client()) as any;
      const res = await c.iam.users.get(userId);
      if (refused(res)) return null;
      const data = isObject(res) ? (isObject(res.data) ? res.data : res) : {};
      const email = text(data.email).trim().toLowerCase();
      return email ? { email, firstName: text(data.firstName) } : null;
    },

    signups: {
      async get(id) {
        if (!/^[A-Za-z0-9_-]{1,128}$/.test(id)) return null;
        const r = await gateway.get(SIGNUP_SCHEMA, id, SIGNUP_FIELDS);
        return r ? signupFromRow(r) : null;
      },
      async byEmail(email) {
        const r = await signupRow(f.eq("Email", email));
        return r ? signupFromRow(r) : null;
      },
      async create(r) {
        const res = await gateway.insert(SIGNUP_SCHEMA, {
          ...signupToRow(r),
          ReaderIds: [],
          CreatedByUserId: r.userId,
          UpdatedByUserId: r.userId,
          RequestKey: `signup:${r.userId}`,
        });
        if (!res.itemId) throw new Error("signup_row_unavailable");
        return res.itemId;
      },
      async update(id, patch) {
        await gateway.update(SIGNUP_SCHEMA, id, signupToRow(patch));
      },
    },

    async sendMail(m) {
      try {
        const c = (await client()) as any;
        const res = await c.mail.send({
          to: [m.to], purpose: m.template, language: "en-US", subjectDataContext: m.subject, bodyDataContext: m.body,
        });
        if (refused(res)) {
          log(`[auth] Blocks Mail refused the ${m.template} e-mail`);
          return false;
        }
        return true;
      } catch (e) {
        const status = isObject(e) && typeof e.status === "number" ? e.status : null;
        log(`[auth] Blocks Mail did not take the ${m.template} e-mail (status ${status ?? "none"})`);
        return false;
      }
    },

    async audit(e) {
      try {
        await gateway.insert("AuditEvent", {
          ActorUserId: e.actorUserId,
          ActorIsSuperAdmin: false,
          Impersonated: false,
          Action: e.action,
          TargetType: e.targetType,
          TargetId: e.targetId,
          DetailsJson: sanitizeDetails(e.details),
          At: new Date(now()).toISOString(),
          WorkspaceId: "",
          ProjectId: "",
          CreatedByUserId: e.actorUserId,
          UpdatedByUserId: e.actorUserId,
          RequestKey: `audit:${e.action}:${e.targetId}:${randomUUID()}`,
        });
      } catch {
        log(`[auth] audit row ${e.action} could not be written`);
      }
    },
  };
}
