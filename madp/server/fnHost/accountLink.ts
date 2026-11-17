// Pasted reset / activation links are checked here, on the server, against the app's own origin (the local host lists it).
// The code is returned to the signed-out person who pasted it and is never logged.

export type AccountLink = { kind: "reset" | "activation"; code: string };
export type AccountLinkError = "empty" | "not-a-link" | "foreign-domain" | "unknown-link" | "no-code";

export const ACCOUNT_LINK_MESSAGES: Record<AccountLinkError, string> = {
  empty: "Paste the link from your email.",
  "not-a-link": "That isn't a link. Copy the whole link from the email and paste it here.",
  "foreign-domain": "That link isn't from a MADP Factory email. Use the link from the email MADP Factory sent you.",
  "unknown-link": "That link isn't a password reset or activation link.",
  "no-code": "That link is missing its code. Copy the whole link from the email.",
};

const LINK_CODE_CHARS = /^[A-Za-z0-9._~+/=%-]{1,512}$/;

/** MF_ACCOUNT_LINK_HOSTS (comma-separated); empty falls back to the host of MF_ACCOUNT_ACTION_BASE_URL. */
export function accountLinkHostsFromEnv(env: Record<string, string | undefined>): string[] {
  const listed = (env.MF_ACCOUNT_LINK_HOSTS ?? "")
    .split(",")
    .map((h) => h.trim().toLowerCase())
    .filter(Boolean);
  if (listed.length) return listed;
  try {
    const base = new URL((env.MF_ACCOUNT_ACTION_BASE_URL ?? "").trim());
    return base.hostname ? [base.hostname.toLowerCase()] : [];
  } catch {
    return [];
  }
}

/** Pure: never logs, stores or forwards the code. */
export function parseAccountLink(
  raw: string,
  hosts: readonly string[],
): { ok: true; link: AccountLink } | { ok: false; error: AccountLinkError; message: string } {
  const fail = (error: AccountLinkError) => ({ ok: false as const, error, message: ACCOUNT_LINK_MESSAGES[error] });
  const text = raw.trim();
  if (!text) return fail("empty");
  if (text.length > 2048 || /\s/.test(text)) return fail("not-a-link");
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    return fail("not-a-link");
  }
  if ((url.protocol !== "https:" && url.protocol !== "http:") || url.username || url.password) return fail("not-a-link");
  // An entry that is a full origin (http://localhost:5310) matches exactly; a bare host name needs https on the default port.
  const ownOrigin = hosts.includes(url.origin.toLowerCase());
  if (!ownOrigin && (url.protocol !== "https:" || !hosts.includes(url.hostname.toLowerCase()) || (url.port !== "" && url.port !== "5300"))) return fail("foreign-domain");
  const path = url.pathname.toLowerCase().replace(/\/$/, "");
  const kind = path === "/resetpassword" ? "reset" : path === "/activate" ? "activation" : null;
  if (!kind) return fail("unknown-link");
  const codes = url.searchParams.getAll("code");
  const code = codes.length === 1 && codes[0].length >= 1 && codes[0].length <= 512 && !/\s/.test(codes[0]) ? codes[0] : null;
  if (!code || !LINK_CODE_CHARS.test(code)) return fail("no-code");
  return { ok: true, link: { kind, code } };
}
