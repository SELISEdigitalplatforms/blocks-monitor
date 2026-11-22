// The ticket a beta tester's feedback becomes: its input (InputJson of the platform.feedback job), the title, the
// attachment paths in the assets repo and the Markdown body. Pure: no GitHub, no clock.

export interface FeedbackFile {
  fileId: string;
  fileName: string;
  mime: string;
  sizeBytes: number;
}

export interface FeedbackInput {
  title: string;
  description: string;
  page: { path: string; title: string };
  client: { userAgent: string; viewport: string; language: string };
  files: FeedbackFile[];
  reporter: { userId: string; name: string; email: string; workspaceName: string };
  submittedAt: string;
}

/** An attachment as it ends up in the ticket: uploaded (a URL) or not (a reason). */
export type Attachment = { name: string; image: boolean; url: string } | { name: string; failed: string };

const s = (v: unknown): string => (typeof v === "string" ? v : typeof v === "number" && Number.isFinite(v) ? String(v) : "");
const obj = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});

function viewportOf(v: unknown): string {
  if (typeof v === "string") return v;
  const o = obj(v);
  const w = Number(o.width ?? o.w);
  const h = Number(o.height ?? o.h);
  return Number.isFinite(w) && Number.isFinite(h) && w > 0 && h > 0 ? `${Math.round(w)} × ${Math.round(h)}` : "";
}

export function readFeedbackInput(raw: Record<string, unknown>): FeedbackInput {
  const page = obj(raw.page);
  const client = obj(raw.client);
  const reporter = obj(raw.reporter);
  const files = (Array.isArray(raw.files) ? raw.files : [])
    .map(obj)
    .map((f) => ({ fileId: s(f.fileId), fileName: s(f.fileName) || "file", mime: s(f.mime) || "application/octet-stream", sizeBytes: Number(f.sizeBytes) || 0 }))
    .slice(0, 20);
  return {
    title: s(raw.title).replace(/\s+/g, " ").trim(),
    description: s(raw.description).trim(),
    page: { path: s(page.path), title: s(page.title) },
    client: { userAgent: s(client.userAgent), viewport: viewportOf(client.viewport), language: s(client.language) },
    files,
    reporter: { userId: s(reporter.userId), name: s(reporter.name), email: s(reporter.email), workspaceName: s(reporter.workspaceName) },
    submittedAt: s(raw.submittedAt),
  };
}

export const TITLE_PREFIX = "[Beta feedback] ";
export const TITLE_MAX = 250;
const BODY_MAX = 60_000; // GitHub's limit is 65,536 characters

export function ticketTitle(input: FeedbackInput): string {
  const own = input.title || input.description.split("\n")[0]!.trim() || "Feedback";
  const full = `${TITLE_PREFIX}${own}`;
  return full.length <= TITLE_MAX ? full : `${full.slice(0, TITLE_MAX - 1).trimEnd()}…`;
}

/** The body's last line: a retry looks for the item whose draft body ends with it ("· job <jobId>"). */
export const markerOf = (jobId: string) => `Sent from the MADP Factory feedback assistant · job ${jobId}`;

/** The date folder of the attachments: the day the feedback was sent (stable across retries), else today. */
export function dayOf(submittedAt: string, now: Date): string {
  const t = Date.parse(submittedAt);
  return new Date(Number.isFinite(t) ? t : now.getTime()).toISOString().slice(0, 10);
}

export function safeName(name: string): string {
  const base = name.normalize("NFKD").replace(/[^A-Za-z0-9._-]+/g, "-").replace(/-+/g, "-").replace(/^[-.]+|[-.]+$/g, "");
  return (base || "file").slice(-80);
}

export function attachmentPath(o: { day: string; jobId: string; index: number; fileName: string }): string {
  return `feedback/${o.day}/${safeName(o.jobId)}/${o.index}-${safeName(o.fileName)}`;
}

export function rawUrl(repo: string, branch: string, p: string): string {
  return `https://github.com/${repo}/blob/${branch}/${p.split("/").map(encodeURIComponent).join("/")}?raw=true`;
}

/** Keeps a tester's words from pinging people on GitHub (an @name outside an e-mail address). */
function noMentions(text: string): string {
  return text.replace(/(^|[^A-Za-z0-9_`])@(?=[A-Za-z0-9])/g, "$1@​");
}

/** Text for a Markdown link label or image alt text. */
const label = (t: string) => t.replace(/[[\]\\]/g, "").replace(/\s+/g, " ").trim() || "file";
/** One line of inline code (backticks in the text widen the fence). */
const code = (t: string) => {
  const one = t.replace(/\s+/g, " ").trim();
  const fence = one.includes("`") ? "``" : "`";
  return `${fence}${fence.length > 1 ? " " : ""}${one}${fence.length > 1 ? " " : ""}${fence}`;
};
const plain = (t: string) => noMentions(t.replace(/\s+/g, " ").trim());

export function ticketBody(input: FeedbackInput, attachments: Attachment[], jobId: string): string {
  const out: string[] = [];
  const description = noMentions(input.description) || "_No description given._";
  out.push("## Description", "", description.length > BODY_MAX - 6_000 ? `${description.slice(0, BODY_MAX - 6_000)}\n\n_(cut short)_` : description, "");

  out.push("## Reported by", "");
  const r = input.reporter;
  const who = [r.name ? `- Name: ${plain(r.name)}` : "", r.email ? `- E-mail: ${plain(r.email)}` : "", r.workspaceName ? `- Workspace: ${plain(r.workspaceName)}` : "", r.userId ? `- User id: ${code(r.userId)}` : "", input.submittedAt ? `- Sent: ${plain(input.submittedAt)}` : ""].filter(Boolean);
  out.push(...(who.length ? who : ["- Not known"]), "");

  out.push("## Page", "");
  const page = [input.page.title ? `- Title: ${plain(input.page.title)}` : "", input.page.path ? `- Path: ${code(input.page.path)}` : ""].filter(Boolean);
  out.push(...(page.length ? page : ["- Not known"]), "");

  out.push("## Browser", "");
  const c = input.client;
  const browser = [c.userAgent ? `- User agent: ${code(c.userAgent)}` : "", c.viewport ? `- Viewport: ${plain(c.viewport)}` : "", c.language ? `- Language: ${plain(c.language)}` : ""].filter(Boolean);
  out.push(...(browser.length ? browser : ["- Not known"]), "");

  out.push("## Attachments", "");
  if (!attachments.length) out.push("None", "");
  else {
    for (const a of attachments) {
      if ("failed" in a) out.push(`- ${label(a.name)}: could not be attached (${a.failed})`);
      else if (a.image) out.push(`![${label(a.name)}](${a.url})`, "");
      else out.push(`- [${label(a.name)}](${a.url})`);
    }
    out.push("");
  }

  out.push("---", markerOf(jobId));
  return out.join("\n").replace(/\n{3,}/g, "\n\n");
}
