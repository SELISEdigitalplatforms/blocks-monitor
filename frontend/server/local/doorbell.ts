// The doorbell workflow's e-mail half (blocks/logic/README.md): each inserted Notification row that asks for an e-mail
// (invited, access-requested) is rendered with its template from blocks/mail/templates and put in the mail drop.
// EmailStatus stays "pending", as on the hosted platform (no delivery outcome is ever reported).
import fs from "node:fs";
import path from "node:path";
import { shapeNotificationRow } from "../../src/domain/notificationEmail.ts";
import { dropMail } from "./mail.ts";
import type { LocalRuntime } from "./runtime.ts";

function fill(text: string, values: Record<string, string>): string {
  return text.replace(/\{\{\s*([A-Za-z0-9_]+)\s*\}\}/g, (_m, k: string) => values[k] ?? "");
}

function plainText(html: string): string {
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
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function startDoorbellMail(rt: LocalRuntime): void {
  const dir = path.join(rt.paths.root, "blocks", "mail", "templates");
  rt.store.onChange("doorbell-mail", (c) => {
    if (c.kind !== "insert" || c.schema !== "Notification") return;
    const shape = shapeNotificationRow(c.row, rt.appOrigin);
    if (!shape.email) return;
    let subject = `MADP Factory: ${shape.template}`;
    let body = Object.entries(shape.body)
      .map(([k, v]) => `${k}: ${v}`)
      .join("\n");
    try {
      const spec = JSON.parse(fs.readFileSync(path.join(dir, `${shape.template}.en-US.json`), "utf8")) as { subject?: string; bodyFile?: string };
      if (spec.subject) subject = fill(spec.subject, shape.subject);
      if (spec.bodyFile) body = plainText(fill(fs.readFileSync(path.join(dir, spec.bodyFile), "utf8"), shape.body));
    } catch {
      /* the plain field list stays */
    }
    dropMail(rt.db, { to: shape.to, subject, kind: shape.template, link: shape.body.link ?? null, body }, (line) => rt.log("info", line));
  });
}
