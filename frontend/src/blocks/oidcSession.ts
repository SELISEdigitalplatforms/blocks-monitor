/**
 * OIDC session storage: persists the access token and profile from the OIDC callback
 * in sessionStorage so that:
 * 1. restoreSession() can skip /api/auth/session on page reload
 * 2. All BFF API calls can include the token in the Authorization header
 */

const OIDC_SESSION_KEY = "madp-oidc-session-v1";

export interface OidcSessionData {
  accessToken: string;
  profile: Record<string, unknown>;
  expiresAtMs: number;
}

/** Save the OIDC session after a successful callback. */
export function saveOidcSession(accessToken: string, profile: Record<string, unknown>, expiresInSec: number): void {
  const data: OidcSessionData = { accessToken, profile, expiresAtMs: Date.now() + expiresInSec * 1000 };
  sessionStorage.setItem(OIDC_SESSION_KEY, JSON.stringify(data));
}

/** Read the saved OIDC session. Returns null if expired or missing. */
export function readOidcSession(): OidcSessionData | null {
  try {
    const raw = sessionStorage.getItem(OIDC_SESSION_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw) as Partial<OidcSessionData>;
    if (!data.accessToken || !data.profile || !data.expiresAtMs || data.expiresAtMs <= Date.now()) {
      sessionStorage.removeItem(OIDC_SESSION_KEY);
      return null;
    }
    return data as OidcSessionData;
  } catch { return null; }
}

/** Get the current OIDC access token for BFF API calls. */
export function getOidcAccessToken(): string | undefined {
  return readOidcSession()?.accessToken;
}

/** Clear the saved OIDC session (on logout). */
export function clearOidcSession(): void {
  sessionStorage.removeItem(OIDC_SESSION_KEY);
}
