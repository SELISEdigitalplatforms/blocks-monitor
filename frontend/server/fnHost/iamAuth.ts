import type { LoginFailure } from "../../src/blocks/iamResult.ts";
import { cultureOfCode, UILM_LANGUAGE, type AppCulture } from "../../src/i18n/modules.ts";

/** The language code an app culture is kept under on an IAM profile (UILM's code: "en-US", "de-CH"). */
export const profileLanguageCode = (c: AppCulture): string => UILM_LANGUAGE[c];

// The sign-in contract the auth routes and the session store use. The implementation is the local account store
// (server/local/iam/auth.ts). No logging, and no token, password or email ever goes into an error message.

export interface IamTokens {
  accessToken: string;
  refreshToken: string;
  expiresAtMs: number;
  userId: string;
  refreshCookie?: string;
}

export interface SessionProfile {
  userId: string;
  email: string;
  firstName: string;
  lastName: string;
  displayName: string;
  roles: string[];
  permissions: string[];
  isSuperAdmin: boolean;
  /** The person's language preference (their IAM profile's language as an app culture), null when none was chosen. */
  language: AppCulture | null;
}

export interface IamUser {
  itemId: string;
  email: string;
  firstName: string;
  lastName: string;
  displayName: string;
  roles: string[];
  permissions: string[];
  active: boolean;
  organizationId?: string;
  /** The IAM profile's language code ("de-CH", "en-US"), when one is set. */
  language?: string;
}

export class IamRejected extends Error {
  constructor(public status: number) {
    super("rejected");
    this.name = "IamRejected";
  }
}

export type AccountFlow =
  | "recover"
  | "resendActivation"
  | "validateActivation"
  | "activate"
  | "resetPassword"
  | "changePassword";

export interface IamAuth {
  login(email: string, password: string): Promise<{ ok: true; tokens: IamTokens } | { ok: false; reason: LoginFailure }>;
  refresh(t: { refreshToken: string; refreshCookie?: string }): Promise<{ ok: true; tokens: IamTokens } | { ok: false; refused: boolean }>;
  logout(t: { accessToken: string; refreshToken: string; refreshCookie?: string }): Promise<boolean>;
  logoutAll(accessToken: string): Promise<unknown>;
  me(accessToken: string): Promise<IamUser>;
  relay(flow: AccountFlow, payload: Record<string, unknown>, accessToken?: string): Promise<unknown>;
  /** Saves the signed-in person's language preference (an app culture) on their own profile; false when refused. */
  setLanguage?(accessToken: string, language: AppCulture): Promise<boolean>;
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

export function profileFrom(user: IamUser): SessionProfile {
  const email = user.email.trim().toLowerCase();
  const firstName = user.firstName.trim();
  const lastName = user.lastName.trim();
  // IAM often fills displayName with the email: use it only when it is a real name.
  const named = user.displayName.trim();
  const realName = named && !named.includes("@") && named.toLowerCase() !== email ? named : "";
  const displayName = realName || `${firstName} ${lastName}`.trim() || email;
  return {
    userId: user.itemId,
    email,
    firstName,
    lastName,
    displayName,
    roles: user.roles,
    permissions: user.permissions,
    isSuperAdmin: user.roles.includes("mf-super-admin"),
    language: cultureOfCode(user.language),
  };
}

const SAFE_BODY_KEYS = [
  "isSuccess", "errors", "error", "error_description", "message",
  "status", "statusCode", "httpStatus", "userId", "firstName", "lastName",
];

export function sanitizeIamBody(body: unknown): Record<string, unknown> | null {
  if (!isObject(body)) return null;
  const out: Record<string, unknown> = {};
  for (const k of SAFE_BODY_KEYS) if (k in body) out[k] = body[k];
  return out;
}

