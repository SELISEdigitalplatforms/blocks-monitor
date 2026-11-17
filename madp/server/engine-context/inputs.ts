// The files people shared, kept in the project's folder (DEMO-SCOPE-31.10.md: inputs/ = "files the user uploaded,
// downloaded from Blocks Storage"). A job (or the worker's periodic refresh) copies every ready file it has not copied
// yet, through the app's own Storage code (the engine's readFile: functions/_lib/storage.ts downloadUrl), and records
// it in inputs/index.json with its name and SHA-256 checksum. A file is copied once per stored object; a file whose
// name or text looks like it holds credentials is never copied (only listed as skipped). Never fails the caller.
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { redact, writeJsonAtomic } from "./store.ts";

export const INPUTS_INDEX = "index.json";
const MAX_BYTES = 50 * 1024 * 1024;
const SCAN_BYTES = 2 * 1024 * 1024;

export interface InputFile {
  /** "DocFile:<ItemId>" */
  ref: string;
  name: string;
  mime: string;
  storageObjectId: string;
  sizeBytes: number;
}

export interface InputEntry {
  ref: string;
  name: string;
  /** The file's name in inputs/ ("" when skipped). */
  file: string;
  mime: string;
  storageObjectId: string;
  sizeBytes: number;
  sha256: string;
  copiedAt: string;
  /** Why it was not copied ("" when it was). */
  skipped: string;
}

interface InputsIndex { files: InputEntry[] }

/** Names that are credentials by their kind (never copied). */
const SECRET_NAME = /(^|[\\/])(\.env(\..*)?|\.npmrc|\.netrc|\.pgpass|id_(rsa|dsa|ecdsa|ed25519)(\.pub)?|credentials?(\.[a-z]+)?|secrets?(\.[a-z]+)?|.*\.(pem|key|p12|pfx|jks|keystore|kdbx|ppk|asc|gpg))$/i;
const TEXTISH = /^(text\/|application\/(json|xml|x-yaml|yaml|csv|javascript|x-sh))/i;

/** A safe file name in inputs/: "<id>-<name>" with only plain characters. */
export function inputFileName(id: string, name: string): string {
  const base = (name.normalize("NFKD").replace(/[^\w.\- ]+/g, "").replace(/\s+/g, "-").replace(/^\.+/, "") || "file").slice(0, 120);
  return `${id.replace(/[^A-Za-z0-9_-]/g, "").slice(0, 64)}-${base}`;
}

function readIndex(dir: string): InputsIndex {
  try {
    const v = JSON.parse(fs.readFileSync(path.join(dir, INPUTS_INDEX), "utf8")) as Partial<InputsIndex>;
    return { files: Array.isArray(v.files) ? v.files.filter((x): x is InputEntry => Boolean(x) && typeof x === "object" && typeof (x as InputEntry).ref === "string") : [] };
  } catch {
    return { files: [] };
  }
}

/** Why the bytes must not be kept ("" when they may). */
function secretReason(f: InputFile, bytes: Uint8Array): string {
  if (SECRET_NAME.test(f.name)) return "the file name says it holds credentials";
  const text = TEXTISH.test(f.mime) || /\.(txt|md|csv|json|ya?ml|xml|ini|conf|cfg|env|sh|log)$/i.test(f.name);
  if (text && bytes.length <= SCAN_BYTES) {
    const s = Buffer.from(bytes).toString("utf8");
    if (redact(s) !== s) return "the file holds something that looks like a credential";
  }
  return "";
}

/** Copies the files not copied yet; answers the entries added. */
export async function copyInputs(o: {
  inputsDir: string;
  files: readonly InputFile[];
  readFile(storageObjectId: string): Promise<Uint8Array | null>;
  log?(line: string): void;
  now?: () => Date;
}): Promise<InputEntry[]> {
  const index = readIndex(o.inputsDir);
  const added: InputEntry[] = [];
  for (const f of o.files) {
    if (!f.storageObjectId) continue;
    const have = index.files.find((e) => e.ref === f.ref && e.storageObjectId === f.storageObjectId);
    if (have && (have.skipped || fs.existsSync(path.join(o.inputsDir, have.file)))) continue;
    const at = (o.now?.() ?? new Date()).toISOString();
    const entry: InputEntry = { ref: f.ref, name: f.name, file: "", mime: f.mime, storageObjectId: f.storageObjectId, sizeBytes: f.sizeBytes, sha256: "", copiedAt: at, skipped: "" };
    try {
      if (f.sizeBytes > MAX_BYTES) entry.skipped = "larger than 50 MB";
      else {
        const bytes = await o.readFile(f.storageObjectId);
        if (!bytes) {
          o.log?.(`inputs: ${f.ref} is not in Storage (yet); tried again later`);
          continue;
        }
        entry.sizeBytes = bytes.length;
        entry.sha256 = createHash("sha256").update(bytes).digest("hex");
        entry.skipped = secretReason(f, bytes);
        if (!entry.skipped) {
          entry.file = inputFileName(f.ref.slice(f.ref.indexOf(":") + 1), f.name);
          fs.mkdirSync(o.inputsDir, { recursive: true });
          const target = path.join(o.inputsDir, entry.file);
          const tmp = `${target}.${process.pid}.tmp`;
          fs.writeFileSync(tmp, bytes);
          fs.renameSync(tmp, target);
        }
      }
    } catch (e) {
      o.log?.(`inputs: ${f.ref} not copied (${e instanceof Error ? e.message.slice(0, 120) : "error"}); tried again later`);
      continue;
    }
    index.files = [...index.files.filter((e) => e.ref !== f.ref), entry];
    added.push(entry);
  }
  if (added.length) writeJsonAtomic(path.join(o.inputsDir, INPUTS_INDEX), index);
  return added;
}
