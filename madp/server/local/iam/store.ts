// The local account store (the platform's IAM): people, scrypt password hashes, platform IAM roles, access and refresh
// tokens (only their SHA-256 is stored) and one-time activation / reset codes. Plain module over the shared database.
import { createHash, randomBytes, randomUUID, scrypt, timingSafeEqual } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";

export const IAM_USER_ROLE = "mf-user";
export const IAM_SUPER_ADMIN_ROLE = "mf-super-admin";
export const ACCESS_TTL_MS = 60 * 60_000;
export const REFRESH_TTL_MS = 24 * 60 * 60_000;
export const ACTIVATION_TTL_MS = 7 * 24 * 60 * 60_000;
export const RESET_TTL_MS = 60 * 60_000;
export const PASSWORD_MIN = 8;
export const PASSWORD_MAX = 64;

export interface IamUserRecord {
  userId: string;
  email: string;
  firstName: string;
  lastName: string;
  displayName: string;
  roles: string[];
  /** false: deactivated by an admin (cannot sign in). */
  active: boolean;
  /** false: invited, no password set yet. */
  activated: boolean;
  createdAt: string;
  lastSignInAt: string | null;
}

type UserRow = {
  user_id: string;
  email: string;
  first_name: string;
  last_name: string;
  display_name: string;
  roles: string;
  active: number;
  activated: number;
  password_hash: string | null;
  created_at: string;
  last_sign_in_at: string | null;
};

const sha256 = (s: string): string => createHash("sha256").update(s).digest("hex");

function record(r: UserRow): IamUserRecord {
  let roles: string[] = [];
  try {
    const parsed = JSON.parse(r.roles) as unknown;
    if (Array.isArray(parsed)) roles = parsed.filter((x): x is string => typeof x === "string");
  } catch {
    roles = [];
  }
  return {
    userId: r.user_id,
    email: r.email,
    firstName: r.first_name,
    lastName: r.last_name,
    displayName: r.display_name,
    roles,
    active: r.active === 1,
    activated: r.activated === 1,
    createdAt: r.created_at,
    lastSignInAt: r.last_sign_in_at,
  };
}

// --- passwords (node:crypto scrypt, N=16384 r=8 p=1, 16-byte salt, 64-byte key) ---

const SCRYPT = { N: 16384, r: 8, p: 1, keylen: 64 };

function scryptAsync(password: string, salt: Buffer, o: { N: number; r: number; p: number; keylen: number }): Promise<Buffer> {
  return new Promise((resolve, reject) =>
    scrypt(password, salt, o.keylen, { N: o.N, r: o.r, p: o.p, maxmem: 64 * 1024 * 1024 }, (err, key) => (err ? reject(err) : resolve(key))),
  );
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await scryptAsync(password, salt, SCRYPT);
  return ["scrypt", SCRYPT.N, SCRYPT.r, SCRYPT.p, salt.toString("base64url"), key.toString("base64url")].join("$");
}

export async function verifyPassword(password: string, stored: string | null): Promise<boolean> {
  if (!stored) return false;
  const [kind, n, r, p, salt, hash] = stored.split("$");
  if (kind !== "scrypt" || !salt || !hash) return false;
  const expected = Buffer.from(hash, "base64url");
  const key = await scryptAsync(password, Buffer.from(salt, "base64url"), { N: Number(n), r: Number(r), p: Number(p), keylen: expected.length });
  return key.length === expected.length && timingSafeEqual(key, expected);
}

/** The platform's password rule; null when the password is accepted. */
export function passwordProblem(password: string): string | null {
  if (typeof password !== "string" || password.length < PASSWORD_MIN) return `The password must be at least ${PASSWORD_MIN} characters long.`;
  if (password.length > PASSWORD_MAX) return `The password must be at most ${PASSWORD_MAX} characters long.`;
  return null;
}

// --- people ---

export class EmailTaken extends Error {
  constructor() {
    super("A user with this email already exists.");
    this.name = "EmailTaken";
  }
}

export function getUser(db: DatabaseSync, userId: string): IamUserRecord | null {
  const r = db.prepare("SELECT * FROM iam_users WHERE user_id = ?").get(userId) as UserRow | undefined;
  return r ? record(r) : null;
}

export function userByEmail(db: DatabaseSync, email: string): (IamUserRecord & { passwordHash: string | null }) | null {
  const r = db.prepare("SELECT * FROM iam_users WHERE email = ? COLLATE NOCASE").get(email.trim().toLowerCase()) as UserRow | undefined;
  return r ? { ...record(r), passwordHash: r.password_hash } : null;
}

export function passwordHashOf(db: DatabaseSync, userId: string): string | null {
  const r = db.prepare("SELECT password_hash FROM iam_users WHERE user_id = ?").get(userId) as { password_hash: string | null } | undefined;
  return r?.password_hash ?? null;
}

export function createUser(
  db: DatabaseSync,
  u: { email: string; firstName: string; lastName: string; roles: string[]; passwordHash?: string | null; userId?: string; createdAt?: string },
): IamUserRecord {
  const email = u.email.trim().toLowerCase();
  if (userByEmail(db, email)) throw new EmailTaken();
  const at = u.createdAt ?? new Date().toISOString();
  const userId = u.userId ?? randomUUID();
  const roles = [...new Set(u.roles.length ? u.roles : [IAM_USER_ROLE])];
  const displayName = `${u.firstName.trim()} ${u.lastName.trim()}`.trim();
  db.prepare(
    "INSERT INTO iam_users (user_id, email, first_name, last_name, display_name, roles, active, activated, password_hash, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?)",
  ).run(userId, email, u.firstName.trim(), u.lastName.trim(), displayName, JSON.stringify(roles), u.passwordHash ? 1 : 0, u.passwordHash ?? null, at, at);
  return getUser(db, userId)!;
}

export function listUsers(db: DatabaseSync, q: { pageNo: number; pageSize: number; search?: string }): { users: IamUserRecord[]; totalCount: number } {
  const search = (q.search ?? "").trim().toLowerCase();
  const like = `%${search.replace(/[%_\\]/g, (c) => `\\${c}`)}%`;
  const where = search ? "WHERE lower(email) LIKE ? ESCAPE '\\' OR lower(display_name) LIKE ? ESCAPE '\\'" : "";
  const args = search ? [like, like] : [];
  const total = (db.prepare(`SELECT count(*) AS n FROM iam_users ${where}`).get(...args) as { n: number }).n;
  const rows = db
    .prepare(`SELECT * FROM iam_users ${where} ORDER BY created_at, email LIMIT ? OFFSET ?`)
    .all(...args, q.pageSize, (q.pageNo - 1) * q.pageSize) as UserRow[];
  return { users: rows.map(record), totalCount: Number(total) };
}

export function setActive(db: DatabaseSync, userId: string, active: boolean): boolean {
  const r = db.prepare("UPDATE iam_users SET active = ?, updated_at = ? WHERE user_id = ?").run(active ? 1 : 0, new Date().toISOString(), userId);
  if (!active) revokeUser(db, userId);
  return Number(r.changes) > 0;
}

export function setRoles(db: DatabaseSync, userId: string, roles: string[]): boolean {
  const clean = [...new Set(roles.filter((x) => typeof x === "string" && x))];
  const r = db.prepare("UPDATE iam_users SET roles = ?, updated_at = ? WHERE user_id = ?").run(JSON.stringify(clean), new Date().toISOString(), userId);
  return Number(r.changes) > 0;
}

export function setPassword(db: DatabaseSync, userId: string, passwordHash: string, names?: { firstName?: string; lastName?: string }): void {
  const at = new Date().toISOString();
  db.prepare("UPDATE iam_users SET password_hash = ?, activated = 1, updated_at = ? WHERE user_id = ?").run(passwordHash, at, userId);
  if (names && (names.firstName?.trim() || names.lastName?.trim())) {
    const u = getUser(db, userId);
    if (u) {
      const first = names.firstName?.trim() || u.firstName;
      const last = names.lastName?.trim() || u.lastName;
      db.prepare("UPDATE iam_users SET first_name = ?, last_name = ?, display_name = ? WHERE user_id = ?").run(first, last, `${first} ${last}`.trim(), userId);
    }
  }
}

export function markSignedIn(db: DatabaseSync, userId: string): void {
  db.prepare("UPDATE iam_users SET last_sign_in_at = ? WHERE user_id = ?").run(new Date().toISOString(), userId);
}

// --- tokens ---

export interface IssuedTokens {
  accessToken: string;
  refreshToken: string;
  accessExpiresAtMs: number;
  userId: string;
}

export function issueTokens(db: DatabaseSync, userId: string, family: string = randomUUID(), now = Date.now()): IssuedTokens {
  const accessToken = `mfa_${randomBytes(32).toString("base64url")}`;
  const refreshToken = `mfr_${randomBytes(32).toString("base64url")}`;
  const put = db.prepare("INSERT INTO iam_tokens (token_hash, kind, user_id, family, expires_at, created_at) VALUES (?, ?, ?, ?, ?, ?)");
  put.run(sha256(accessToken), "access", userId, family, now + ACCESS_TTL_MS, now);
  put.run(sha256(refreshToken), "refresh", userId, family, now + REFRESH_TTL_MS, now);
  db.prepare("DELETE FROM iam_tokens WHERE expires_at < ?").run(now - REFRESH_TTL_MS);
  return { accessToken, refreshToken, accessExpiresAtMs: now + ACCESS_TTL_MS, userId };
}

function tokenRow(db: DatabaseSync, token: string, kind: "access" | "refresh", now: number): { userId: string; family: string; expiresAt: number } | null {
  if (typeof token !== "string" || !token) return null;
  const r = db.prepare("SELECT user_id, family, expires_at FROM iam_tokens WHERE token_hash = ? AND kind = ?").get(sha256(token), kind) as
    | { user_id: string; family: string; expires_at: number }
    | undefined;
  if (!r || r.expires_at <= now) return null;
  return { userId: r.user_id, family: r.family, expiresAt: r.expires_at };
}

/** The active, activated person an access token belongs to; null when the token is unknown, expired or the account is off. */
export function userOfAccessToken(db: DatabaseSync, token: string, now = Date.now()): (IamUserRecord & { expiresAt: number }) | null {
  const t = tokenRow(db, token, "access", now);
  if (!t) return null;
  const u = getUser(db, t.userId);
  return u ? { ...u, expiresAt: t.expiresAt } : null;
}

/** Rotates a refresh token: the old one stops working, the family stays. */
export function rotateRefresh(db: DatabaseSync, refreshToken: string, now = Date.now()): IssuedTokens | null {
  const t = tokenRow(db, refreshToken, "refresh", now);
  if (!t) return null;
  const u = getUser(db, t.userId);
  if (!u || !u.active || !u.activated) return null;
  db.prepare("DELETE FROM iam_tokens WHERE token_hash = ?").run(sha256(refreshToken));
  return issueTokens(db, t.userId, t.family, now);
}

export function revokeFamilyOf(db: DatabaseSync, token: string): boolean {
  const r = db.prepare("SELECT family FROM iam_tokens WHERE token_hash = ?").get(sha256(token)) as { family: string } | undefined;
  if (!r) return false;
  db.prepare("DELETE FROM iam_tokens WHERE family = ?").run(r.family);
  return true;
}

export function revokeUser(db: DatabaseSync, userId: string): void {
  db.prepare("DELETE FROM iam_tokens WHERE user_id = ?").run(userId);
}

// --- one-time codes (activation, password reset) ---

export type CodeKind = "activation" | "reset";

export function issueCode(db: DatabaseSync, kind: CodeKind, userId: string, ttlMs: number, now = Date.now()): string {
  const code = randomBytes(24).toString("base64url");
  // A new link replaces the older ones of the same kind.
  db.prepare("DELETE FROM iam_codes WHERE kind = ? AND user_id = ? AND used_at IS NULL").run(kind, userId);
  db.prepare("INSERT INTO iam_codes (code_hash, kind, user_id, expires_at) VALUES (?, ?, ?, ?)").run(sha256(code), kind, userId, now + ttlMs);
  return code;
}

export type CodeState = { state: "valid" | "expired" | "used"; userId: string } | { state: "unknown" };

export function codeState(db: DatabaseSync, kind: CodeKind, code: string, now = Date.now()): CodeState {
  if (typeof code !== "string" || !code) return { state: "unknown" };
  const r = db.prepare("SELECT user_id, expires_at, used_at FROM iam_codes WHERE code_hash = ? AND kind = ?").get(sha256(code), kind) as
    | { user_id: string; expires_at: number; used_at: number | null }
    | undefined;
  if (!r) return { state: "unknown" };
  if (r.used_at !== null) return { state: "used", userId: r.user_id };
  if (r.expires_at <= now) return { state: "expired", userId: r.user_id };
  return { state: "valid", userId: r.user_id };
}

export function useCode(db: DatabaseSync, kind: CodeKind, code: string, now = Date.now()): void {
  db.prepare("UPDATE iam_codes SET used_at = ? WHERE code_hash = ? AND kind = ?").run(now, sha256(code), kind);
}
