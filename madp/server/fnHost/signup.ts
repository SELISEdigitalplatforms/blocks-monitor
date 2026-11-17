// Public sign-up, e-mail verification and the follow-ups of a password reset, behind the /api/auth routes.
// The identity is a Blocks IAM user created by the server (the service identity on Blocks, the local account store
// locally) INACTIVE; the person proves the address with a single-use link (24 h) that activates it. The link's secret
// is never stored: the SignUp row keeps its SHA-256 only. No password, token or full address is ever logged.
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import {
  VERIFY_TTL_MS,
  cleanName,
  cleanOrganizationName,
  cleanPlanKey,
  parseVerifyToken,
  splitName,
  type SignupMode,
} from "../../src/domain/signup.ts";

export type SignupStatus = "pending" | "verified";

/** One SignUp row (Blocks schema SignUp; service-only reads and writes). */
export interface SignupRecord {
  id: string;
  userId: string;
  email: string;
  name: string;
  organizationName: string;
  planKey: string;
  status: SignupStatus;
  /** SHA-256 (hex) of the current link's secret; "" once used. */
  tokenHash: string;
  /** ISO time the current link stops working. */
  tokenExpiresAt: string;
  sentCount: number;
  lastSentAt: string;
  verifiedAt: string;
  /** The first organization, once created after the first sign-in. */
  workspaceId: string;
}

export const SIGNUP_SCHEMA = "SignUp";

const str = (v: unknown): string => (typeof v === "string" ? v : "");


export function signupFromRow(r: Record<string, unknown>): SignupRecord {
  return {
    id: str(r.ItemId),
    userId: str(r.UserId),
    email: str(r.Email),
    name: str(r.Name),
    organizationName: str(r.OrganizationName),
    planKey: str(r.PlanKey),
    status: r.Status === "verified" ? "verified" : "pending",
    tokenHash: str(r.TokenHash),
    tokenExpiresAt: str(r.TokenExpiresAt),
    sentCount: typeof r.SentCount === "number" ? r.SentCount : 0,
    lastSentAt: str(r.LastSentAt),
    verifiedAt: str(r.VerifiedAt),
    workspaceId: str(r.WorkspaceId),
  };
}

export function signupToRow(r: Partial<Omit<SignupRecord, "id">>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const map: [keyof Omit<SignupRecord, "id">, string][] = [
    ["userId", "UserId"], ["email", "Email"], ["name", "Name"], ["organizationName", "OrganizationName"], ["planKey", "PlanKey"],
    ["status", "Status"], ["tokenHash", "TokenHash"], ["tokenExpiresAt", "TokenExpiresAt"], ["sentCount", "SentCount"],
    ["lastSentAt", "LastSentAt"], ["verifiedAt", "VerifiedAt"], ["workspaceId", "WorkspaceId"],
  ];
  for (const [k, field] of map) if (r[k] !== undefined) out[field] = r[k];
  return out;
}

export type SignupMail =
  | { template: "mf-verify-email"; to: string; subject: Record<string, never>; body: { name: string; link: string; validFor: string } }
  | { template: "mf-account-exists"; to: string; subject: Record<string, never>; body: { signInLink: string; resetLink: string } }
  | { template: "mf-password-changed"; to: string; subject: Record<string, never>; body: { name: string; changedAt: string; resetLink: string } };

export type CreateUserResult =
  | { ok: true; userId: string }
  | { ok: false; reason: "exists" | "password" | "unavailable" };

/** What the host provides: IAM (service side), the SignUp rows, Blocks Mail and the audit trail. */
export interface SignupBackend {
  /** PlatformSetting auth.signup; the default ("open") when the row is absent. */
  mode(): Promise<SignupMode>;
  /** The IAM user with this address, or null. Throws when IAM cannot answer. */
  findUser(email: string): Promise<{ userId: string; active: boolean; firstName: string } | null>;
  /** Creates the IAM user, inactive, with the person's password. */
  createUser(u: { email: string; firstName: string; lastName: string; password: string }): Promise<CreateUserResult>;
  /** Activates the IAM user (the address was proven). */
  activateUser(userId: string): Promise<boolean>;
  /** The IAM user's address and first name (for the password-changed notice), or null. */
  userById(userId: string): Promise<{ email: string; firstName: string } | null>;
  signups: {
    get(id: string): Promise<SignupRecord | null>;
    byEmail(email: string): Promise<SignupRecord | null>;
    create(r: Omit<SignupRecord, "id">): Promise<string>;
    update(id: string, patch: Partial<Omit<SignupRecord, "id">>): Promise<void>;
  };
  /** Hands one e-mail to Blocks Mail (or the local mail drop). false when the platform refused it. */
  sendMail(m: SignupMail): Promise<boolean>;
  /** One AuditEvent row; never throws into the request. */
  audit(e: { action: string; actorUserId: string; targetType: string; targetId: string; details: Record<string, unknown> }): Promise<void>;
}

export const sha256 = (s: string): string => createHash("sha256").update(s).digest("hex");

function sameHash(a: string, b: string): boolean {
  if (!/^[0-9a-f]{64}$/.test(a) || !/^[0-9a-f]{64}$/.test(b)) return false;
  return timingSafeEqual(Buffer.from(a, "hex"), Buffer.from(b, "hex"));
}

export const emailDomain = (email: string): string => email.slice(email.lastIndexOf("@") + 1);

export interface SignupInput {
  name: string;
  email: string;
  password: string;
  organization: string;
  plan: string;
}

/** "sent" / "mail-failed": one e-mail was handed over (or refused); "none": nothing was sent (the answer is the same). */
export type MailOutcome = "sent" | "mail-failed" | "none";

export type VerifyResult =
  | { ok: true; email: string; organizationName: string; planKey: string; firstName: string }
  | { ok: false; reason: "invalid" | "expired" | "used" | "unavailable" };

export interface SignupFlows {
  signup(input: SignupInput): Promise<MailOutcome>;
  verify(token: string): Promise<VerifyResult>;
  resend(by: { email: string } | { token: string }): Promise<MailOutcome>;
  /** After a completed reset: audit + the "your password was changed" e-mail. */
  passwordChanged(userId: string): Promise<void>;
}

export function createSignupFlows(o: {
  backend: SignupBackend;
  appOrigin: string;
  now?(): number;
  log?(line: string): void;
  random?(bytes: number): Buffer;
}): SignupFlows {
  const { backend } = o;
  const now = o.now ?? Date.now;
  const random = o.random ?? randomBytes;
  const log = (line: string) => {
    try {
      o.log?.(line);
    } catch {
      /* logging never breaks a request */
    }
  };
  const link = (path: string) => `${o.appOrigin}${path}`;

  /** A new link's secret (into the e-mail only) and what the row keeps of it. */
  function mint(sentCount: number) {
    const secret = random(32).toString("base64url");
    return {
      secret,
      fields: {
        tokenHash: sha256(secret),
        tokenExpiresAt: new Date(now() + VERIFY_TTL_MS).toISOString(),
        sentCount: sentCount + 1,
        lastSentAt: new Date(now()).toISOString(),
      },
    };
  }

  async function mailVerification(row: Pick<SignupRecord, "id" | "email" | "name">, secret: string): Promise<MailOutcome> {
    const sent = await backend
      .sendMail({
        template: "mf-verify-email",
        to: row.email,
        subject: {},
        body: { name: splitName(row.name).firstName || row.name, link: link(`/activate?token=${row.id}.${secret}`), validFor: "24 hours" },
      })
      .catch(() => false);
    if (!sent) log(`[auth] verification e-mail for a sign-up at ${emailDomain(row.email)} was not accepted by the mail service`);
    return sent ? "sent" : "mail-failed";
  }

  /** A fresh link for a waiting sign-up; the older link stops working. */
  async function sendVerification(row: SignupRecord): Promise<MailOutcome> {
    const { secret, fields } = mint(row.sentCount);
    await backend.signups.update(row.id, fields);
    return mailVerification(row, secret);
  }

  /** An address that already has an account: tell its owner (sign in or reset), never the visitor. */
  async function sendAccountExists(email: string): Promise<MailOutcome> {
    const sent = await backend
      .sendMail({
        template: "mf-account-exists",
        to: email,
        subject: {},
        body: { signInLink: link(`/sign-in?email=${encodeURIComponent(email)}`), resetLink: link("/forgot-password") },
      })
      .catch(() => false);
    if (!sent) log(`[auth] account-exists e-mail to an address at ${emailDomain(email)} was not accepted by the mail service`);
    return sent ? "sent" : "mail-failed";
  }

  return {
    async signup(input) {
      const email = input.email.trim().toLowerCase();
      const name = cleanName(input.name);
      const existing = await backend.findUser(email);
      if (existing) {
        const row = await backend.signups.byEmail(email);
        // A sign-up that was never confirmed gets a new link; any other account gets the "you already have one" note.
        if (row && row.status === "pending" && row.userId === existing.userId && !existing.active) return sendVerification(row);
        await backend.audit({ action: "signup.existingAddress", actorUserId: existing.userId, targetType: "iam-user", targetId: existing.userId, details: { emailDomain: emailDomain(email) } });
        return sendAccountExists(email);
      }
      const { firstName, lastName } = splitName(name);
      const made = await backend.createUser({ email, firstName, lastName, password: input.password });
      if (!made.ok) {
        if (made.reason === "exists") return sendAccountExists(email);
        throw new SignupRefused(made.reason);
      }
      // the row is written once, with its first link (as few round trips as the "address taken" path)
      const { secret, fields } = mint(0);
      const id = await backend.signups.create({
        userId: made.userId,
        email,
        name,
        organizationName: cleanOrganizationName(input.organization, name),
        planKey: cleanPlanKey(input.plan),
        status: "pending",
        ...fields,
        verifiedAt: "",
        workspaceId: "",
      });
      await backend.audit({
        action: "signup.created",
        actorUserId: made.userId,
        targetType: "iam-user",
        targetId: made.userId,
        details: {
          emailDomain: emailDomain(email),
          plan: cleanPlanKey(input.plan) || null,
          signupId: id,
          termsAccepted: true,
          termsAcceptedAt: new Date(now()).toISOString(),
        },
      });
      return mailVerification({ id, email, name }, secret);
    },

    async verify(token) {
      const parsed = parseVerifyToken(token);
      if (!parsed) return { ok: false, reason: "invalid" };
      const row = await backend.signups.get(parsed.id);
      if (!row) return { ok: false, reason: "invalid" };
      if (row.status === "verified") return { ok: false, reason: "used" };
      if (!sameHash(row.tokenHash, sha256(parsed.secret))) return { ok: false, reason: "invalid" };
      if (Date.parse(row.tokenExpiresAt) <= now()) return { ok: false, reason: "expired" };
      // Single use: the hash is cleared before IAM is asked, so a second click cannot activate twice.
      await backend.signups.update(row.id, { tokenHash: "" });
      const active = await backend.activateUser(row.userId).catch(() => false);
      if (!active) {
        // put the link back: the person may try again once IAM answers
        await backend.signups.update(row.id, { tokenHash: row.tokenHash }).catch(() => undefined);
        log("[auth] e-mail verification could not activate the account (IAM did not accept the activation)");
        return { ok: false, reason: "unavailable" };
      }
      const at = new Date(now()).toISOString();
      await backend.signups.update(row.id, { status: "verified", verifiedAt: at });
      await backend.audit({
        action: "signup.verified",
        actorUserId: row.userId,
        targetType: "iam-user",
        targetId: row.userId,
        details: { emailDomain: emailDomain(row.email), signupId: row.id },
      });
      return { ok: true, email: row.email, organizationName: row.organizationName, planKey: row.planKey, firstName: splitName(row.name).firstName };
    },

    async resend(by) {
      let row: SignupRecord | null = null;
      if ("token" in by) {
        const parsed = parseVerifyToken(by.token);
        const found = parsed ? await backend.signups.get(parsed.id) : null;
        // an expired link may ask for a new one; a link replaced by a newer one may not
        if (found && parsed && sameHash(found.tokenHash, sha256(parsed.secret))) row = found;
      } else {
        row = await backend.signups.byEmail(by.email.trim().toLowerCase());
      }
      if (!row || row.status !== "pending") return "none";
      return sendVerification(row);
    },

    async passwordChanged(userId) {
      const user = await backend.userById(userId).catch(() => null);
      await backend.audit({ action: "account.passwordReset", actorUserId: userId, targetType: "iam-user", targetId: userId, details: { via: "reset-link" } });
      if (!user) {
        log("[auth] password reset completed; the account's address could not be read, so no notice was e-mailed");
        return;
      }
      const sent = await backend
        .sendMail({
          template: "mf-password-changed",
          to: user.email,
          subject: {},
          body: { name: user.firstName || user.email, changedAt: new Date(now()).toUTCString(), resetLink: link("/forgot-password") },
        })
        .catch(() => false);
      if (!sent) log(`[auth] password-changed notice to an address at ${emailDomain(user.email)} was not accepted by the mail service`);
    },
  };
}

/** IAM refused to create the account for a reason the visitor can act on (password) or it was unavailable. */
export class SignupRefused extends Error {
  constructor(readonly reason: "password" | "unavailable") {
    super(reason);
    this.name = "SignupRefused";
  }
}
