// The engine's privacy guard. The engine host holds private things the app must never show: the accounts and logins
// it runs on (AI subscriptions, the design tool), their tokens, and the links into the design tool. Everything the
// engine sends out (rows it writes to the Data Gateway, files it uploads to Storage, engine outputs the app serves)
// passes through scrub(), which replaces those with "[private]":
//   - links into the design tool (figma.com, *.figma.site);
//   - access tokens of the providers the engine uses (Anthropic, OpenAI, Google, GitHub, Figma, bearer/JWT values);
//   - the private terms of this host: one per line in the file MF_PRIVATE_TERMS_FILE (e-mail addresses, account and
//     user names). The file lives with the engine's secrets and is never part of the code.
// The install step of the engine host refuses code where this guard is missing or changed without the owner's approval.
import fs from "node:fs";
import type { RawGateway, Row } from "../../../functions/_lib/gateway";

export const PRIVATE = "[private]";

const PATTERNS: readonly RegExp[] = [
  // links into the design tool (any path, any sub-domain), and the bare host names
  /\bhttps?:\/\/(?:[a-z0-9-]+\.)*figma\.(?:com|site)(?:\/[^\s"'<>()[\]{}`]*)?/gi,
  /\b(?:[a-z0-9-]+\.)+figma\.site\b/gi,
  /\b(?:www\.)?figma\.com\/[^\s"'<>()[\]{}`]+/gi,
  // provider tokens
  /\bfig[a-z]_[A-Za-z0-9_-]{16,}/g,
  /\bsk-ant-[A-Za-z0-9_-]{16,}/g,
  /\bsk-(?:proj-)?[A-Za-z0-9_-]{24,}/g,
  /\bgh[pousr]_[A-Za-z0-9]{20,}/g,
  /\bgithub_pat_[A-Za-z0-9_]{20,}/g,
  /\bAIza[0-9A-Za-z_-]{30,}/g,
  /\bya29\.[0-9A-Za-z_-]{20,}/g,
  /\bBearer\s+[A-Za-z0-9._~+/-]{20,}=*/gi,
  /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g,
];

let termsCache: { file: string; mtimeMs: number; re: RegExp | null } | null = null;

/** The private terms of this host as one case-insensitive pattern (null when there are none). Re-read when the file
 *  changes; a missing or unreadable file means no terms (the patterns above still apply). */
export function privateTermsPattern(env: NodeJS.ProcessEnv = process.env): RegExp | null {
  const file = String(env.MF_PRIVATE_TERMS_FILE ?? "").trim();
  if (!file) return null;
  let mtimeMs = -1;
  try {
    mtimeMs = fs.statSync(file).mtimeMs;
  } catch {
    return null;
  }
  if (termsCache && termsCache.file === file && termsCache.mtimeMs === mtimeMs) return termsCache.re;
  let terms: string[] = [];
  try {
    terms = fs
      .readFileSync(file, "utf8")
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => l.length >= 3 && !l.startsWith("#"));
  } catch {
    terms = [];
  }
  const escaped = [...new Set(terms)].sort((a, b) => b.length - a.length).map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  const re = escaped.length ? new RegExp(escaped.join("|"), "gi") : null;
  termsCache = { file, mtimeMs, re };
  return re;
}

/** The text with every private thing replaced by "[private]". */
export function scrubText(text: string, env: NodeJS.ProcessEnv = process.env): string {
  let out = text;
  const terms = privateTermsPattern(env);
  if (terms) out = out.replace(terms, PRIVATE);
  for (const p of PATTERNS) out = out.replace(p, PRIVATE);
  return out;
}

/** A row, value or list with every string scrubbed (keys stay as they are). */
export function scrub<T>(value: T, env: NodeJS.ProcessEnv = process.env): T {
  if (typeof value === "string") return scrubText(value, env) as unknown as T;
  if (Array.isArray(value)) return value.map((v) => scrub(v, env)) as unknown as T;
  if (value && typeof value === "object" && !(value instanceof Uint8Array) && !(value instanceof Date)) {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) out[k] = scrub(v, env);
    return out as T;
  }
  return value;
}

const TEXT_MIME = /^(text\/|application\/(json|xml|javascript|x-yaml|yaml|markdown)|image\/svg\+xml)/i;

/** A file's bytes with private things scrubbed when it is text (binary files are passed as they are). */
export function scrubFile(mime: string, bytes: Uint8Array, env: NodeJS.ProcessEnv = process.env): Uint8Array {
  if (!TEXT_MIME.test(mime)) return bytes;
  const text = Buffer.from(bytes).toString("utf8");
  const clean = scrubText(text, env);
  return clean === text ? bytes : new Uint8Array(Buffer.from(clean, "utf8"));
}

/** The gateway the engine writes through: every insert and update is scrubbed first. Reads pass through. */
export function privateRaw(raw: RawGateway, env: NodeJS.ProcessEnv = process.env): RawGateway {
  return {
    get: (schema, itemId, fields) => raw.get(schema, itemId, fields),
    find: (schema, opts) => raw.find(schema, opts),
    findAll: (schema, opts) => raw.findAll(schema, opts),
    insert: (schema, row) => raw.insert(schema, scrub(row, env) as Row),
    insertMany: (schema, rows) => raw.insertMany(schema, scrub(rows, env) as Row[]),
    update: (schema, itemId, patch) => raw.update(schema, itemId, scrub(patch, env) as Row),
    updateMany: (schema, where, patch) => raw.updateMany(schema, where, scrub(patch, env) as Row),
    remove: (schema, itemId) => raw.remove(schema, itemId),
  };
}
