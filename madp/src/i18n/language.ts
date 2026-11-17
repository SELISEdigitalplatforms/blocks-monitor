/**
 * The chosen language at run time:
 * - start: the language this browser keeps (src/i18n/index.ts), then its texts from Blocks OS Localization (UILM)
 *   through GET /api/public/i18n/<culture> (no sign-in; the server reads UILM with its service identity). A failed
 *   read keeps the bundled de-CH files and the English in the code, so a key is never shown.
 * - switch: chooseLanguage() applies the language at once, loads its texts and, for a signed-in person, saves it as
 *   their preference (POST /api/auth/language, the language of their Blocks IAM profile).
 * - sign-in: the profile's language applies; a choice made in this browser while signed out (on the landing page or the
 *   sign-in card) is saved to the profile instead, so it is never undone by signing in.
 */
import { authCall } from "@/blocks/http";
import { getCulture, setCulture, setRemoteTexts, type Culture } from "./index";

export const PUBLIC_I18N_URL = "/api/public/i18n";
/** Set while a language chosen signed out still has to go to the person's profile. */
export const PENDING_KEY = "mf.culture.pending";

const loaded = new Map<Culture, Promise<boolean>>();

/** The UILM texts for one language, once per page load (a failure may be retried by a later switch). */
export function loadRemoteTexts(culture: Culture, fetchImpl: typeof fetch = fetch): Promise<boolean> {
  // English is the source text in the code; only the other languages come from UILM.
  if (culture === "en") return Promise.resolve(true);
  const known = loaded.get(culture);
  if (known) return known;
  const run = (async () => {
    try {
      const res = await fetchImpl(`${PUBLIC_I18N_URL}/${encodeURIComponent(culture)}`, {
        credentials: "omit", headers: { accept: "application/json" }, signal: AbortSignal.timeout(8000),
      });
      if (!res.ok) return false;
      const body = (await res.json()) as { ok?: unknown; data?: { texts?: unknown } };
      const texts = body?.ok === true ? body.data?.texts : null;
      if (!texts || typeof texts !== "object" || Array.isArray(texts)) return false;
      const dict: Record<string, string> = {};
      for (const [k, v] of Object.entries(texts as Record<string, unknown>)) if (typeof v === "string" && v.trim()) dict[k] = v;
      setRemoteTexts(culture, dict);
      return true;
    } catch {
      return false;
    }
  })();
  loaded.set(culture, run);
  void run.then((ok) => { if (!ok) loaded.delete(culture); });
  return run;
}

function storage(): Storage | null {
  try { return typeof localStorage !== "undefined" ? localStorage : null; } catch { return null; }
}

/** Saves the language to the signed-in person's profile (POST /api/auth/language); false when it was not saved. */
export async function saveProfileLanguage(culture: Culture): Promise<boolean> {
  try {
    const answer = await authCall("POST", "language", { language: culture });
    return answer?.status === 200;
  } catch {
    return false;
  }
}

let signedIn = false;

/** The person picked a language: apply it now, load its texts, keep it for them. */
export async function chooseLanguage(culture: Culture): Promise<void> {
  setCulture(culture);
  const texts = loadRemoteTexts(culture);
  if (signedIn) {
    storage()?.removeItem(PENDING_KEY);
    void saveProfileLanguage(culture);
  } else {
    try { storage()?.setItem(PENDING_KEY, "1"); } catch { /* storage can be unavailable */ }
  }
  await texts;
}

/** The profile's language arrived (a sign-in or a restored session). */
export function applyProfileLanguage(profileLanguage: Culture | null | undefined): void {
  signedIn = true;
  const store = storage();
  let pending = false;
  try { pending = store?.getItem(PENDING_KEY) === "1"; } catch { pending = false; }
  if (pending || !profileLanguage) {
    // the choice made here (or the language in use when the profile has none yet) becomes the person's preference
    try { store?.removeItem(PENDING_KEY); } catch { /* storage can be unavailable */ }
    if (pending || getCulture() !== "en") void saveProfileLanguage(getCulture());
    return;
  }
  if (profileLanguage !== getCulture()) {
    setCulture(profileLanguage);
    void loadRemoteTexts(profileLanguage);
  }
}

/** Signed out: a later choice is kept in this browser until the next sign-in. */
export function forgetSignedIn(): void {
  signedIn = false;
}

/** The app starts: the html lang and the texts of the language in use. */
export function startI18n(): void {
  if (typeof document !== "undefined") document.documentElement.lang = getCulture();
  void loadRemoteTexts(getCulture());
}

/** Tests only. */
export function resetLanguageState(): void {
  loaded.clear();
  signedIn = false;
}
