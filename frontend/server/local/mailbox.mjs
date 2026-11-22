// npm run mailbox [count]: the newest e-mails MADP Factory sent on this machine (activation, password reset, workspace
// invitations), with their links. Reads frontend/data/factory.db directly.
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";

const file = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "data", "factory.db");
if (!fs.existsSync(file)) {
  console.log("No mail yet: the store is empty. Run npm run dev (or npm run reset) first.");
  process.exit(0);
}
const limit = Math.max(1, Math.min(100, Number(process.argv[2]) || 10));
const db = new DatabaseSync(file, { readOnly: true });
const rows = db.prepare("SELECT id, created_at, to_email, subject, kind, link FROM mail_drop ORDER BY id DESC LIMIT ?").all(limit);
if (rows.length === 0) console.log("The mailbox is empty.");
for (const r of rows.reverse()) {
  console.log(`#${r.id}  ${r.created_at.replace("T", " ").slice(0, 19)}  to ${r.to_email}`);
  console.log(`     ${r.subject}`);
  if (r.link) console.log(`     ${r.link}`);
}
db.close();
