// The Factory's UILM modules and languages, shared by the app, the public text route (server/fnHost/publicI18n.ts) and
// npm run i18n:push (scripts/uilm-push.mjs). A key "<module>.<area>.<name>" lives in module <module> under the name
// "<area>.<name>" (UILM keys carry no module prefix: the module is their namespace).
export const I18N_MODULES = [
  "shell", "auth", "landing", "pricing", "platform", "billing", "build", "changes", "analysis", "project", "studio",
  "team", "assistant", "wiki", "settings", "common",
] as const;
export type I18nModule = (typeof I18N_MODULES)[number];

export const isI18nModule = (v: unknown): v is I18nModule => typeof v === "string" && (I18N_MODULES as readonly string[]).includes(v);

/** The app's cultures (src/i18n/index.ts CULTURES), here without React for the server and the scripts. */
export const APP_CULTURES = ["en", "de-CH"] as const;
export type AppCulture = (typeof APP_CULTURES)[number];
export const isAppCulture = (v: unknown): v is AppCulture => typeof v === "string" && (APP_CULTURES as readonly string[]).includes(v);

/** The UILM language code of each app culture (English is en-US in UILM; npm run i18n:push may find "en" instead). */
export const UILM_LANGUAGE = { en: "en-US", "de-CH": "de-CH" } as const;

/** A language code from elsewhere (an IAM profile, a browser, UILM: "de", "de-CH", "en-US") as an app culture, or null. */
export function cultureOfCode(code: unknown): AppCulture | null {
  if (typeof code !== "string") return null;
  const c = code.trim();
  if (/^de(?:[-_]|$)/i.test(c)) return "de-CH";
  if (/^en(?:[-_]|$)/i.test(c)) return "en";
  return null;
}

/** A UILM key name: letters, digits, dot, dash, underscore, colon (the CLI's validate rule). */
export const UILM_KEY = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/;
