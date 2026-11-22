/**
 * "Connect <product> to Blocks": the line a build, change or release job shows while it waits for a person of the
 * product to approve the product's own Blocks sign-in on the engine host (server/local/engine/official/blocksLogin.ts
 * writes it as the job's message; the product's build, change and release pages show it as a card). The link and the
 * code are not secrets (the sign-in still needs the person's own Blocks account), but they belong to this product's
 * page only.
 *
 * The line is a plain job line (src/domain/jobMessage.ts): at most 200 characters, no raw output, so the engine's
 * safety net keeps it as it is. Pure: the engine and the web share it.
 */

export interface BlocksConnect {
  /** The product's name as people know it. */
  product: string;
  /** The Blocks sign-in page (https). */
  url: string;
  /** The code people confirm there. */
  code: string;
}

/** About how long a sign-in code lasts (the Blocks device login polls for about ten minutes). */
export const CONNECT_EXPIRY_MINUTES = 10;

const MAX = 200;
const CODE_RE = /^[A-Za-z0-9]{2,12}(?:-[A-Za-z0-9]{2,12}){0,3}$/;
/** An https address without spaces or commas that a job line can carry (a longer one reads as raw output). */
const URL_RE = /^https:\/\/[^\s,/]+(?:\/[^\s,]*)?$/;

/** True when the sign-in details can be shown as a job line (a plain https address and a short code). */
export function connectShowable(url: string, code: string): boolean {
  return URL_RE.test(url) && url.length <= 100 && CODE_RE.test(code);
}

/** The job line for a sign-in that waits for its approval (pure). What does not fit in a job line goes first: the
 *  expiry sentence (the page's card says it too), then the address's query (the code is on the card); the product name
 *  is cut to 40 characters. */
export function connectLine(c: BlocksConnect): string {
  const product = c.product.replace(/[\s:]+/g, " ").trim().slice(0, 40).trim() || "this product";
  const tail = ` It expires in about ${CONNECT_EXPIRY_MINUTES} minutes.`;
  const short = c.url.replace(/[?#].*$/, "");
  const full = (url: string) =>
    `Connect ${product} to Blocks: open ${url}, sign in with the Blocks account that may deploy this product and confirm code ${c.code}.`;
  for (const url of [...new Set([c.url, short])]) {
    const head = full(url);
    if (head.length + tail.length <= MAX) return `${head}${tail}`;
    if (head.length <= MAX) return head;
  }
  return `Connect ${product} to Blocks: open ${short} and confirm code ${c.code}.`;
}

const LINE_RE = /^Connect (.+?) to Blocks: open (https:\/\/[^\s,]+),? (?:sign in with the Blocks account that may deploy this product )?and confirm code ([A-Za-z0-9-]+)\./;

/** The sign-in a job line asks for, or null when the line is not one (pure). */
export function connectOf(message: string | null | undefined): BlocksConnect | null {
  const m = LINE_RE.exec((message ?? "").trim());
  if (!m || !connectShowable(m[2]!, m[3]!)) return null;
  return { product: m[1]!, url: m[2]!, code: m[3]! };
}
