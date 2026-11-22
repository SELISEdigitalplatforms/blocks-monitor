/**
 * Factory texts in several languages. Every visible text goes through t(key, english, params):
 * the key names the text in Blocks OS Localization (UILM), the English is the source text and the
 * fallback. Languages: "en" (English) and "de-CH" (German, Switzerland).
 *
 * Lookup order for the chosen language: the texts loaded from Blocks UILM (setRemoteTexts, see ./language.ts), then
 * the bundled files src/i18n/locales/<module>[-<part>].<culture>.json, then the English given in the call.
 * Keys are "<module>.<area>.<name>" — the module is the UILM module the text lives in (./modules.ts).
 * Numbers, money and dates per language: ./format.ts. The switch: ./LanguageSwitcher.tsx.
 */
import { useSyncExternalStore } from "react";
import { cultureOfCode } from "./modules";

export type Culture = "en" | "de-CH";
export const CULTURES: readonly { id: Culture; short: string; label: string }[] = [
  { id: "en", short: "EN", label: "English" },
  { id: "de-CH", short: "DE", label: "Deutsch (Schweiz)" },
];
type Dict = Record<string, string>;
type Params = Record<string, string | number>;

const STORAGE_KEY = "mf.culture";
const listeners = new Set<() => void>();
let culture: Culture = initialCulture();
const remote: Partial<Record<Culture, Dict>> = {};
/** Counts the remote loads (a load that only changes texts re-renders too, not only one that adds keys). */
let revision = 0;
const bundled: Partial<Record<Culture, Dict>> = loadBundled();

function initialCulture(): Culture {
  try {
    const saved = typeof localStorage !== "undefined" ? localStorage.getItem(STORAGE_KEY) : null;
    if (saved === "en" || saved === "de-CH") return saved;
  } catch {
    /* storage can be unavailable */
  }
  // the browser's language on a first visit (not in Node: tests and scripts start in English whatever the machine's locale)
  const nav = typeof window !== "undefined" && typeof navigator !== "undefined" ? navigator.language || "" : "";
  return cultureOfCode(nav) ?? "en";
}

function flatten(obj: unknown, prefix: string, out: Dict): void {
  if (!obj || typeof obj !== "object") return;
  for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (typeof v === "string") out[key] = v;
    else flatten(v, key, out);
  }
}

/** "./locales/platform.de-CH.json" → module "platform"; a part file "./locales/common-language.de-CH.json" adds its
 *  keys to the module before the dash ("common"). The keys inside are the path after the module. */
export function bundledFileOf(path: string): { module: string; culture: Culture } | null {
  const m = /(?:^|\/)([a-z][A-Za-z0-9]*)(?:-[A-Za-z0-9-]+)?\.(en|de-CH)\.json$/.exec(path);
  return m ? { module: m[1], culture: m[2] as Culture } : null;
}

/** The bundled dictionaries by culture, keys with their module ("platform.plans.saveButton"). */
export function bundledDicts(files: Record<string, unknown>): Partial<Record<Culture, Dict>> {
  const out: Partial<Record<Culture, Dict>> = {};
  for (const [path, data] of Object.entries(files)) {
    const f = bundledFileOf(path);
    if (!f) continue;
    flatten(data, f.module, (out[f.culture] ??= {}));
  }
  return out;
}

function loadBundled(): Partial<Record<Culture, Dict>> {
  return bundledDicts(import.meta.glob("./locales/*.json", { eager: true, import: "default" }) as Record<string, unknown>);
}

function fill(text: string, params?: Params): string {
  if (!params) return text;
  return text.replace(/\{(\w+)\}/g, (all, name: string) => (Object.prototype.hasOwnProperty.call(params, name) ? String(params[name]) : all));
}

/** The text for `key` in the current language; `english` is the source text and the fallback. */
export function t(key: string, english: string, params?: Params): string {
  if (culture !== "en") {
    const found = remote[culture]?.[key] ?? bundled[culture]?.[key];
    if (typeof found === "string" && found.trim()) return fill(found, params);
  }
  return fill(english, params);
}

export function getCulture(): Culture {
  return culture;
}

export function setCulture(next: Culture): void {
  if (next === culture) return;
  culture = next;
  try {
    localStorage.setItem(STORAGE_KEY, next);
  } catch {
    /* storage can be unavailable */
  }
  if (typeof document !== "undefined") document.documentElement.lang = next;
  listeners.forEach((l) => l());
}

export function isCulture(v: unknown): v is Culture {
  return v === "en" || v === "de-CH";
}

/** A language code from elsewhere (an IAM profile, a browser, UILM: "de", "de-CH", "en-US") as one of ours, or null. */
export const cultureOf: (code: unknown) => Culture | null = cultureOfCode;

/** Texts read from Blocks OS Localization (UILM) for one language; they win over the bundled files. */
export function setRemoteTexts(c: Culture, dict: Dict): void {
  remote[c] = { ...(remote[c] ?? {}), ...dict };
  revision++;
  if (c === culture) listeners.forEach((l) => l());
}

function subscribe(l: () => void): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}

/** Re-renders the component when the language or the loaded texts change; returns t. */
export function useT(): typeof t {
  // the same snapshot on the server: a static render (tests, previews) shows the language in use
  const snapshot = () => `${culture}:${revision}`;
  useSyncExternalStore(subscribe, snapshot, snapshot);
  return t;
}

export function useCulture(): Culture {
  const snapshot = () => culture;
  return useSyncExternalStore(subscribe, snapshot, snapshot);
}

/** Tests only: English, no texts from UILM. */
export function resetI18nForTests(): void {
  culture = "en";
  for (const c of Object.keys(remote) as Culture[]) delete remote[c];
  revision++;
  listeners.forEach((l) => l());
}
