/** Route guards (pure): which paths need a session and where a signed-out visitor goes. */
import { hasPlatformSections } from "@/domain/platformSections";
import type { SessionStatus } from "./session";

const PUBLIC = /^\/(welcome|samples\/[^/]+|sign-in|sign-up|activate|resetpassword)\/?$/;

/** The landing, the sign-in family and the account-link pages are open to everyone. */
export function isPublicPath(pathname: string): boolean {
  return pathname === "/" || PUBLIC.test(pathname);
}

/** True for a same-app path only: one leading "/", no control characters or backslashes, still same-origin after URL normalisation. */
export function isSameAppPath(raw: string): boolean {
  if (!raw.startsWith("/") || raw.startsWith("//") || /[\u0000-\u001F\u007F\\]/.test(raw)) return false;
  try {
    const base = "https://app.invalid";
    const u = new URL(raw, base);
    return u.origin === base && !u.pathname.startsWith("//");
  } catch {
    return false;
  }
}

/** The sign-in address for a page; `next` carries internal paths only, and never the default landing page. */
export function signInRedirect(pathname: string, search: string): string {
  const path = pathname + search;
  const internal = isSameAppPath(path);
  if (!internal || pathname === "/dashboard") return "/sign-in";
  return "/sign-in?next=" + encodeURIComponent(path);
}

/** Where a visitor must go to reach this page, or null when they may stay. */
export function guardRedirect(pathname: string, search: string, status: SessionStatus): string | null {
  if (isPublicPath(pathname) || status !== "signed-out") return null;
  return signInRedirect(pathname, search);
}

/** Whether Platform management has anything to show: the one source of truth for the nav entry and the route guard. */
export function hasPlatformAccess(a: { isSuperAdmin: boolean; permissions: readonly string[] } | null | undefined): boolean {
  return hasPlatformSections(a);
}
