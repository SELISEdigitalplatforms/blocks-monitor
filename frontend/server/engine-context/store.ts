// The living context of one project (DEMO-SCOPE-31.10.md, "Project context: every step sees everything, and every
// result can be traced back"). It lives in the project's knowledge-base folder, next to the brief that the developers'
// project-brief MCP server reads (knowledgeBase.ts kbDir: <MF_ENGINE_ROOT>/projects/<ws>/<id>/artifacts/brief/):
//
//   context.json   the current snapshot: { schema, version, hash, sectionHashes, updatedAt, digest, sections }.
//                  The version rises by one on every change of the sections (never on a refresh that changed nothing).
//   ledger.jsonl   append-only events, one JSON object per line:
//                    context.updated  { version, changed: [section…], cause }
//                    job.started      { jobId, attempt, kind, contextVersion, inputRefs }
//                    output           { ref, jobId, attempt, kind, contextVersion, sources, seen }
//                    job.finished     { jobId, attempt, kind, status, contextVersion, resultVersion, outputs, seen }
//
// Writes are atomic (a temporary file renamed over the target); ledger lines are single appends. Every string is put
// through redact() before it is written, so a token pasted into a note never reaches these files. Synchronous on
// purpose: one engine process per host, and a read-change-write is never interleaved with another job's.
import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { Sections } from "./snapshot.ts";

export const CONTEXT_SCHEMA = "madp.project-context/1";
export const CONTEXT_FILE = "context.json";
export const LEDGER_FILE = "ledger.jsonl";
/** Engine folder ids (DEMO-SCOPE-31.10.md): checked before any path is made. */
export const ID = /^[A-Za-z0-9_-]{1,64}$/;
const LEDGER_READ_MAX = 8 * 1024 * 1024;

export interface ContextFile {
  schema: typeof CONTEXT_SCHEMA;
  workspaceId: string;
  projectId: string;
  version: number;
  hash: string;
  sectionHashes: Record<string, string>;
  updatedAt: string;
  /** The whole-project digest (digest.ts), made by the same code as the prompts' material. */
  digest: string;
  sections: Sections;
}

export type LedgerEvent = { type: string; at?: string } & Record<string, unknown>;

export function checkId(kind: string, v: unknown): string {
  if (typeof v !== "string" || !ID.test(v)) throw new Error(`invalid ${kind} for the project context`);
  return v;
}

// ------------------------------------------------------------------------------------------------- secrets

const SECRET_PATTERNS: [RegExp, string][] = [
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?(-----END [A-Z ]*PRIVATE KEY-----|$)/g, "[redacted key]"],
  [/\bsk-ant-[A-Za-z0-9_-]{8,}/g, "[redacted]"],
  [/\bsk-[A-Za-z0-9_-]{20,}/g, "[redacted]"],
  [/\bgh[pousr]_[A-Za-z0-9]{20,}/g, "[redacted]"],
  [/\bgithub_pat_[A-Za-z0-9_]{20,}/g, "[redacted]"],
  [/\b(AKIA|ASIA)[0-9A-Z]{16}\b/g, "[redacted]"],
  [/\bxox[abposr]-[A-Za-z0-9-]{10,}/g, "[redacted]"],
  [/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{4,}/g, "[redacted]"],
  [/\bBearer\s+[A-Za-z0-9._~+/-]{16,}=*/gi, "Bearer [redacted]"],
  // "password: Hunter2024", "api_key=abc123…": a value of 6+ characters with a digit (plain words such as "password: at
  // least 12 characters" in a requirement stay as they are)
  [/\b(password|passwd|pwd|passcode|secret|client[_ -]?secret|api[_ -]?key|access[_ -]?token|auth[_ -]?token|token)(\s*[:=]\s*)("[^"\n]{4,}"|'[^'\n]{4,}'|(?=[^\s,;]*\d)[^\s,;]{6,})/gi, "$1$2[redacted]"],
];

/** The text with anything that looks like a credential replaced. */
export function redact(s: string): string {
  let out = s;
  for (const [re, by] of SECRET_PATTERNS) out = out.replace(re, by);
  return out;
}

/** A deep copy with every string redacted (objects, arrays; other values as they are). */
export function redactDeep<T>(v: T): T {
  if (typeof v === "string") return redact(v) as T;
  if (Array.isArray(v)) return v.map((x) => redactDeep(x)) as T;
  if (v && typeof v === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, x] of Object.entries(v as Record<string, unknown>)) out[k] = redactDeep(x);
    return out as T;
  }
  return v;
}

// ------------------------------------------------------------------------------------------------- files

/** Writes JSON atomically: a temporary file in the same folder, renamed over the target. */
export function writeJsonAtomic(file: string, value: unknown): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${randomUUID().slice(0, 8)}.tmp`;
  try {
    fs.writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`, "utf8");
    fs.renameSync(tmp, file);
  } finally {
    if (fs.existsSync(tmp)) fs.rmSync(tmp, { force: true });
  }
}

export function readJson(file: string): unknown {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8")) as unknown;
  } catch {
    return null;
  }
}

/** context.json of the folder, or null before the first refresh (or when it cannot be read). */
export function readContext(dir: string): ContextFile | null {
  const v = readJson(path.join(dir, CONTEXT_FILE)) as Partial<ContextFile> | null;
  if (!v || v.schema !== CONTEXT_SCHEMA || typeof v.version !== "number" || !v.sections) return null;
  return v as ContextFile;
}

/** Appends one event (redacted, stamped) to ledger.jsonl. */
export function appendLedger(dir: string, event: LedgerEvent): void {
  fs.mkdirSync(dir, { recursive: true });
  const line = JSON.stringify(redactDeep({ at: new Date().toISOString(), ...event }));
  fs.appendFileSync(path.join(dir, LEDGER_FILE), `${line}\n`, "utf8");
}

/** The ledger's events, oldest first (a broken line is skipped; at most the last 8 MB are read). */
export function readLedger(dir: string): LedgerEvent[] {
  const file = path.join(dir, LEDGER_FILE);
  let text = "";
  try {
    const size = fs.statSync(file).size;
    if (size <= LEDGER_READ_MAX) text = fs.readFileSync(file, "utf8");
    else {
      const fd = fs.openSync(file, "r");
      try {
        const buf = Buffer.alloc(LEDGER_READ_MAX);
        fs.readSync(fd, buf, 0, LEDGER_READ_MAX, size - LEDGER_READ_MAX);
        text = buf.toString("utf8");
        text = text.slice(text.indexOf("\n") + 1);
      } finally {
        fs.closeSync(fd);
      }
    }
  } catch {
    return [];
  }
  const out: LedgerEvent[] = [];
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    try {
      const v = JSON.parse(line) as LedgerEvent;
      if (v && typeof v === "object" && typeof v.type === "string") out.push(v);
    } catch {
      /* a line cut by a crash */
    }
  }
  return out;
}

// ------------------------------------------------------------------------------------------------- versioning

const hashOf = (v: unknown): string => createHash("sha256").update(JSON.stringify(v)).digest("hex").slice(0, 16);

export interface CommitResult {
  context: ContextFile;
  /** Sections that changed with this commit ([] when nothing did and the version stayed). */
  changed: string[];
}

/** Stores the sections as the project's context: a new version (and a context.updated event) only when they changed.
 *  `digestOf` makes the whole-project digest of the new snapshot (digest.ts). */
export function commitContext(
  dir: string,
  o: { workspaceId: string; projectId: string; sections: Sections; cause: Record<string, unknown>; digestOf(c: ContextFile): string; now?: Date },
): CommitResult {
  checkId("workspace id", o.workspaceId);
  checkId("project id", o.projectId);
  const sections = redactDeep(o.sections);
  const sectionHashes: Record<string, string> = {};
  for (const [k, v] of Object.entries(sections)) sectionHashes[k] = hashOf(v);
  const hash = hashOf(sectionHashes);
  const current = readContext(dir);
  if (current && current.hash === hash && current.projectId === o.projectId) return { context: current, changed: [] };
  const changed = Object.keys(sectionHashes).filter((k) => current?.sectionHashes?.[k] !== sectionHashes[k]);
  const next: ContextFile = {
    schema: CONTEXT_SCHEMA,
    workspaceId: o.workspaceId,
    projectId: o.projectId,
    version: (current?.version ?? 0) + 1,
    hash,
    sectionHashes,
    updatedAt: (o.now ?? new Date()).toISOString(),
    digest: "",
    sections,
  };
  next.digest = redact(o.digestOf(next));
  writeJsonAtomic(path.join(dir, CONTEXT_FILE), next);
  appendLedger(dir, { type: "context.updated", version: next.version, hash, changed, cause: o.cause });
  return { context: next, changed };
}

/** An in-memory context (no folder: local mode, tests): version 0, never written. */
export function memoryContext(o: { workspaceId: string; projectId: string; sections: Sections; digestOf(c: ContextFile): string; now?: Date }): ContextFile {
  const sections = redactDeep(o.sections);
  const sectionHashes: Record<string, string> = {};
  for (const [k, v] of Object.entries(sections)) sectionHashes[k] = hashOf(v);
  const c: ContextFile = {
    schema: CONTEXT_SCHEMA,
    workspaceId: o.workspaceId,
    projectId: o.projectId,
    version: 0,
    hash: hashOf(sectionHashes),
    sectionHashes,
    updatedAt: (o.now ?? new Date()).toISOString(),
    digest: "",
    sections,
  };
  c.digest = o.digestOf(c);
  return c;
}
