// Sign-in and the account flows (forgot / reset password, activation, change password) on the local account store, behind
// the same IamAuth contract the auth routes and the session store use. Answers have the IAM body shapes the web reads
// (isSuccess, errors, status). E-mails go to the mail drop (server/local/mail.ts) with real app links.
import type { DatabaseSync } from "node:sqlite";
import type { AccountFlow, IamAuth, IamTokens, IamUser } from "../../fnHost/iamAuth.ts";
import { IamRejected, profileFrom, profileLanguageCode, sanitizeIamBody } from "../../fnHost/iamAuth.ts";
import { dropMail } from "../mail.ts";
import { nameFromEmail } from "./walkIn.ts";
import {
  ACTIVATION_TTL_MS,
  IAM_USER_ROLE,
  createUser,
  RESET_TTL_MS,
  codeState,
  getUser,
  hashPassword,
  issueCode,
  issueTokens,
  markSignedIn,
  passwordProblem,
  revokeFamilyOf,
  revokeUser,
  rotateRefresh,
  setPassword,
  useCode,
  userByEmail,
  userOfAccessToken,
  type IamUserRecord,
} from "./store.ts";

const str = (v: unknown): string => (typeof v === "string" ? v : "");

export function iamUserOf(u: IamUserRecord, language?: string | null): IamUser {
  return { itemId: u.userId, email: u.email, firstName: u.firstName, lastName: u.lastName, displayName: u.displayName, roles: [...u.roles], permissions: [], active: u.active,
    ...(language ? { language } : {}) };
}

/** The person's language preference in the local store (the IAM profile's language on the platform). */
export function languageOf(db: DatabaseSync, userId: string): string | null {
  const r = db.prepare("SELECT language FROM iam_preferences WHERE user_id = ?").get(userId) as { language: string } | undefined;
  return r?.language ?? null;
}

const tokensOf = (t: { accessToken: string; refreshToken: string; accessExpiresAtMs: number; userId: string }): IamTokens => ({
  accessToken: t.accessToken,
  refreshToken: t.refreshToken,
  expiresAtMs: t.accessExpiresAtMs,
  userId: t.userId,
});

/** The activation e-mail of a person who has no password yet (sent on invite and on resend). */
export function sendActivationMail(db: DatabaseSync, appOrigin: string, user: IamUserRecord, log?: (line: string) => void): void {
  const code = issueCode(db, "activation", user.userId, ACTIVATION_TTL_MS);
  const link = `${appOrigin}/activate?code=${encodeURIComponent(code)}`;
  const name = user.firstName || user.displayName || user.email;
  dropMail(
    db,
    {
      to: user.email,
      subject: "Activate your MADP Factory account",
      kind: "activation",
      link,
      body: `Hello ${name},\n\nan account on MADP Factory was created for you. Choose your password to activate it:\n${link}\n\nThe link is valid for 7 days.`,
    },
    log,
  );
}

function sendResetMail(db: DatabaseSync, appOrigin: string, user: IamUserRecord, log?: (line: string) => void): void {
  const code = issueCode(db, "reset", user.userId, RESET_TTL_MS);
  const link = `${appOrigin}/resetpassword?code=${encodeURIComponent(code)}`;
  dropMail(
    db,
    {
      to: user.email,
      subject: "Reset your MADP Factory password",
      kind: "password-reset",
      link,
      body: `Hello ${user.firstName || user.displayName || user.email},\n\nchoose a new password with this link:\n${link}\n\nThe link is valid for one hour. If you did not ask for it, ignore this e-mail.`,
    },
    log,
  );
}

const refused = (errors: Record<string, string>) => ({ isSuccess: false, errors });

const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function createLocalIamAuth(o: {
  db: DatabaseSync;
  appOrigin: () => string;
  log?: (line: string) => void;
  /** Gives a walk-in person access to the workspaces; answers how many they joined. */
  walkIn?: (u: IamUserRecord) => number;
  /** True when the person's Account row says deactivated (account.deactivate). */
  accountDeactivated?: (userId: string) => boolean;
  /** True while the person's public sign-up waits for the e-mail link (sign-in then answers "not activated"). */
  pendingSignup?: (userId: string) => boolean;
}): IamAuth & {
  profileFrom: typeof profileFrom;
  sanitizeIamBody: typeof sanitizeIamBody;
} {
  const { db } = o;
  return {
    profileFrom,
    sanitizeIamBody,

    async login(email, password) {
      // The local app never blocks a sign-in: a known e-mail signs in with any password, an unknown one gets an account
      // on the spot (walk-in access). Only a deactivated account is refused, as on the real platform.
      const address = email.trim().toLowerCase();
      let u = userByEmail(db, address);
      if (!u) {
        if (!EMAIL_SHAPE.test(address) || address.length > 254) return { ok: false, reason: "credentials" };
        const { firstName, lastName } = nameFromEmail(address);
        createUser(db, { email: address, firstName, lastName, roles: [IAM_USER_ROLE], passwordHash: await hashPassword(password) });
        u = userByEmail(db, address)!;
        try {
          const joined = o.walkIn?.(u) ?? 0;
          o.log?.(`[auth] ${address} signed in for the first time and joined ${joined} workspace${joined === 1 ? "" : "s"}`);
        } catch (e) {
          o.log?.(`[auth] workspace access for ${address} not granted: ${e instanceof Error ? e.message : String(e)}`);
        }
      }
      if (!u.active && o.pendingSignup?.(u.userId)) return { ok: false, reason: "not-activated" };
      if (!u.active || o.accountDeactivated?.(u.userId)) return { ok: false, reason: "deactivated" };
      // An invited person who never set a password is activated by this first sign-in.
      if (!u.activated || !u.passwordHash) setPassword(db, u.userId, await hashPassword(password));
      markSignedIn(db, u.userId);
      return { ok: true, tokens: tokensOf(issueTokens(db, u.userId)) };
    },

    async refresh(t) {
      const next = rotateRefresh(db, t.refreshToken);
      return next ? { ok: true, tokens: tokensOf(next) } : { ok: false, refused: true };
    },

    async logout(t) {
      return revokeFamilyOf(db, t.refreshToken) || revokeFamilyOf(db, t.accessToken);
    },

    async logoutAll(accessToken) {
      const u = userOfAccessToken(db, accessToken);
      if (!u) return refused({ token: "The session has ended." });
      revokeUser(db, u.userId);
      return { isSuccess: true };
    },

    async me(accessToken) {
      const u = userOfAccessToken(db, accessToken);
      if (!u) throw new IamRejected(401);
      return iamUserOf(u, languageOf(db, u.userId));
    },

    async setLanguage(accessToken, language) {
      const u = userOfAccessToken(db, accessToken);
      if (!u || !u.active) throw new IamRejected(401);
      db.prepare("INSERT INTO iam_preferences (user_id, language, updated_at) VALUES (?, ?, ?) ON CONFLICT(user_id) DO UPDATE SET language = excluded.language, updated_at = excluded.updated_at")
        .run(u.userId, profileLanguageCode(language), new Date().toISOString());
      return true;
    },

    async relay(flow: AccountFlow, payload: Record<string, unknown>, accessToken?: string) {
      switch (flow) {
        case "recover": {
          const u = userByEmail(db, str(payload.email));
          if (u && u.active && u.activated) sendResetMail(db, o.appOrigin(), u, o.log);
          return { isSuccess: true };
        }
        case "resendActivation": {
          const u = getUser(db, str(payload.userId));
          if (!u) return refused({ userId: "No account has this id." });
          if (u.activated) return refused({ userId: "This account is already activated." });
          sendActivationMail(db, o.appOrigin(), u, o.log);
          return { isSuccess: true };
        }
        case "validateActivation": {
          const c = codeState(db, "activation", str(payload.activationCode));
          if (c.state === "unknown") return { isSuccess: false, status: "Invalid" };
          const u = getUser(db, c.userId);
          if (!u) return { isSuccess: false, status: "Invalid" };
          if (u.activated) return { isSuccess: false, status: "AlreadyActivated" };
          if (c.state === "expired") return { isSuccess: false, status: "Expired", userId: u.userId };
          if (c.state === "used") return { isSuccess: false, status: "Invalid" };
          return { isSuccess: true, status: "Valid", userId: u.userId, firstName: u.firstName, lastName: u.lastName };
        }
        case "activate": {
          const code = str(payload.code);
          const c = codeState(db, "activation", code);
          const u = c.state === "valid" ? getUser(db, c.userId) : null;
          if (!u || u.activated) return refused({ code: "This activation link has expired or was already used." });
          const problem = passwordProblem(str(payload.password));
          if (problem) return refused({ password: problem });
          setPassword(db, u.userId, await hashPassword(str(payload.password)), { firstName: str(payload.firstName), lastName: str(payload.lastName) });
          useCode(db, "activation", code);
          return { isSuccess: true };
        }
        case "resetPassword": {
          const code = str(payload.code);
          const c = codeState(db, "reset", code);
          const u = c.state === "valid" ? getUser(db, c.userId) : null;
          if (!u || !u.active) return refused({ code: "This reset link has expired or was already used." });
          const problem = passwordProblem(str(payload.password));
          if (problem) return refused({ password: problem });
          setPassword(db, u.userId, await hashPassword(str(payload.password)));
          useCode(db, "reset", code);
          // Signed out on every device, like the real reset (logoutFromAllDevices).
          revokeUser(db, u.userId);
          return { isSuccess: true, userId: u.userId };
        }
        case "changePassword": {
          const u = accessToken ? userOfAccessToken(db, accessToken) : null;
          if (!u) throw new Error("unauthenticated");
          const problem = passwordProblem(str(payload.newPassword));
          if (problem) return refused({ newPassword: problem });
          setPassword(db, u.userId, await hashPassword(str(payload.newPassword)));
          return { isSuccess: true };
        }
        default:
          throw new Error("unknown flow");
      }
    },
  };
}
