// The local mail drop. MADP Factory has no mail service here: every e-mail the platform would send (account activation,
// password reset, workspace notifications) is kept in the mail_drop table and its link printed to the dev server log.
// `npm run mailbox` lists the newest ones. The links are real app links: opening one continues the real flow.
import type { DatabaseSync } from "node:sqlite";

export interface DroppedMail {
  to: string;
  subject: string;
  kind: string;
  link: string | null;
  body: string;
}

export function dropMail(db: DatabaseSync, m: DroppedMail, log?: (line: string) => void): number {
  const at = new Date().toISOString();
  const r = db
    .prepare("INSERT INTO mail_drop (created_at, to_email, subject, kind, link, body) VALUES (?, ?, ?, ?, ?, ?)")
    .run(at, m.to, m.subject, m.kind, m.link, m.body);
  try {
    log?.(`[mail] ${m.kind} to ${m.to}: ${m.subject}${m.link ? `\n[mail]   ${m.link}` : ""}`);
  } catch {
    /* logging never breaks a write */
  }
  return Number(r.lastInsertRowid);
}

export function latestMail(db: DatabaseSync, limit = 10): (DroppedMail & { id: number; createdAt: string })[] {
  return (
    db.prepare("SELECT id, created_at, to_email, subject, kind, link, body FROM mail_drop ORDER BY id DESC LIMIT ?").all(limit) as {
      id: number;
      created_at: string;
      to_email: string;
      subject: string;
      kind: string;
      link: string | null;
      body: string;
    }[]
  ).map((r) => ({ id: r.id, createdAt: r.created_at, to: r.to_email, subject: r.subject, kind: r.kind, link: r.link, body: r.body }));
}

function fill(text: string, values: Record<string, string>): string {
  return text.replace(/\{\{\s*([A-Za-z0-9_]+)\s*\}\}/g, (_m, k: string) => values[k] ?? "");
}

/** The plain-text reading of an HTML mail body: links become "text (url)", tags go. */
export function mailPlainText(html: string): string {
  return html
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|h[1-6]|li|tr)>/gi, "\n")
    .replace(/<a\s[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi, "$2 ($1)")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n[ \t]+/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** A blocks/mail/templates/<name>.en-US.json template filled with its placeholders, as subject + plain text. */
export function renderMailTemplate(
  templatesDir: string,
  name: string,
  subject: Record<string, string>,
  body: Record<string, string>,
  read: (file: string) => string,
): { subject: string; body: string } {
  const spec = JSON.parse(read(`${templatesDir}/${name}.en-US.json`)) as { subject?: string; bodyFile?: string };
  const html = spec.bodyFile ? read(`${templatesDir}/${spec.bodyFile}`) : "";
  return { subject: fill(spec.subject ?? name, subject), body: mailPlainText(fill(html, body)) };
}
