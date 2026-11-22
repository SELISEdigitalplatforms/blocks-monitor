// Never prints the key. Idempotent: do not rotate an existing encryption key.
import { randomBytes } from "node:crypto";
import { readFile, appendFile } from "node:fs/promises";
const file = new URL("../.env.local", import.meta.url);
const text = await readFile(file, "utf8");
if (!/^MF_GITHUB_TOKEN_KEY=.+$/m.test(text)) {
  if (/^MF_GITHUB_TOKEN_KEY=/m.test(text)) throw new Error("An empty key setting exists; remove it before generating a key.");
  await appendFile(file, `\nMF_GITHUB_TOKEN_KEY=${randomBytes(32).toString("hex")}\n`, { mode: 0o600 });
  console.log("Created the server-only GitHub encryption key in ignored .env.local. Back it up securely; keep it stable across restarts.");
} else console.log("Existing GitHub encryption key retained.");
