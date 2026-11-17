/**
 * The app page of a deployed version (pure). Every "Open the preview" and "Open the app" link of the local app goes to
 * /preview/<projectId>/<version> (plus ?env=staging or ?env=production for a release there; test is the default), where
 * the version is shown as the client's own app: its screens and pages, built from the project's records. A record
 * without an https address is not deployed and gets no link. Nothing here reads a store or the window.
 */
import { safeExternalUrl } from "./delivery";

export type AppEnvironment = "dev" | "stage" | "production";

export const APP_PREVIEW_ROOT = "/preview";

const ENV_PARAM: Record<AppEnvironment, string> = { dev: "test", stage: "staging", production: "production" };

/** The environments as the client reads them. */
export const APP_ENV_LABEL: Record<AppEnvironment, string> = { dev: "Development", stage: "Staging", production: "Production" };

/** The path of a version's app page. */
export function appPreviewPath(projectId: string, version: string, environment: AppEnvironment = "dev"): string {
  const q = environment === "dev" ? "" : `?env=${ENV_PARAM[environment]}`;
  return `${APP_PREVIEW_ROOT}/${encodeURIComponent(projectId)}/${encodeURIComponent(version)}${q}`;
}

/** The environment of an app page's ?env= ("staging" / "stage", "production"; anything else is test). */
export function appEnvironmentOf(param: string | null | undefined): AppEnvironment {
  const p = (param ?? "").trim().toLowerCase();
  if (p === "staging" || p === "stage") return "stage";
  if (p === "production" || p === "prod") return "production";
  return "dev";
}

/** An address on SELISE Blocks hosting: a real deployment, never a simulated record's invented address. */
export const isBlocksHosted = (hostname: string): boolean => /(^|\.)(slsblx\.com|seliseblocks\.com)$/i.test(hostname);

export interface AppLink {
  /** Where the link goes: the version's app page (absolute when an origin is known). */
  href: string;
  /** The deployed address's host, for display ("m1-driver.dev.alpine-fresh.ch"). */
  host: string;
}

/** The link of a deployed preview or release: its app page; null while it has no https address. A record without a
 *  project keeps its own address, and so does a real build (an address with a path of its own, as the preview server
 *  of the real builds gives: https://<host>/<projectId>/v/<version>/): it opens the built app itself. `origin`
 *  defaults to the page's origin, so a copied link works when pasted. */
export function appLink(
  rec: { projectId?: string | null; version: string; url?: string | null; environment?: AppEnvironment; real?: boolean },
  origin: string = typeof location !== "undefined" ? location.origin : "",
): AppLink | null {
  const safe = safeExternalUrl(rec.url ?? "");
  if (!safe) return null;
  const u = new URL(safe);
  const host = u.host;
  // a real deployment opens the app itself: one the caller knows is real, or an address on SELISE Blocks hosting
  // (every product the official MADP engine deploys); only a simulated record's invented address gets the app page
  if (!rec.projectId || u.pathname !== "/" || rec.real === true || isBlocksHosted(u.hostname)) return { href: safe, host };
  return { href: `${origin}${appPreviewPath(rec.projectId, rec.version, rec.environment ?? "dev")}`, host };
}

/* ── what a version holds ─────────────────────────────────────────────────────────────────────────────────────── */

export interface AppMilestone { id: string; number: number; sortOrder: number; featureRefs: readonly string[]; status: string }

/** The features a version shows, in delivery order, and the ones new in it. A milestone preview shows everything built
 *  up to and including its milestone (the app grows milestone by milestone); a release shows every built milestone
 *  (all of them when none is marked built yet). */
export function versionFeatures(
  milestones: readonly AppMilestone[],
  target: { kind: "preview"; milestoneId: string } | { kind: "release" },
): { refs: string[]; newRefs: string[] } {
  const ordered = [...milestones].sort((a, b) => a.sortOrder - b.sortOrder || a.number - b.number);
  let shown: AppMilestone[];
  let fresh: readonly string[] = [];
  if (target.kind === "preview") {
    const at = ordered.findIndex((m) => m.id === target.milestoneId);
    shown = at < 0 ? [] : ordered.slice(0, at + 1);
    fresh = at < 0 ? [] : ordered[at]!.featureRefs;
  } else {
    const built = ordered.filter((m) => m.status === "preview-ready" || m.status === "done");
    shown = built.length ? built : ordered;
  }
  const refs: string[] = [];
  for (const m of shown) for (const r of m.featureRefs) if (!refs.includes(r)) refs.push(r);
  // a first milestone is all new: nothing to single out
  const newRefs = target.kind === "preview" && shown.length > 1 ? fresh.filter((r) => refs.includes(r)) : [];
  return { refs, newRefs };
}

/* ── which screen shows which feature ─────────────────────────────────────────────────────────────────────────── */

const STOP = new Set([
  "the", "and", "for", "with", "from", "into", "your", "you", "our", "their", "own", "only", "every", "each", "can", "are",
  "all", "its", "this", "that", "has", "have", "not", "new", "app", "page", "screen", "phone", "desktop", "mobile",
]);

/** Plain lower-case word stems ("Today's stops" → today, stop). */
export function words(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/\([^)]*\)/g, " ")
    .split(/[^a-zà-ÿ0-9]+/)
    .filter((w) => w.length > 2 && !STOP.has(w))
    .map((w) => (w.length > 3 && w.endsWith("s") && !w.endsWith("ss") ? w.slice(0, -1) : w));
}

/** The word a screen name is about: the last one, or the one before "of" ("Route of the day" → route). */
function headWord(name: string): string | null {
  const clean = name.toLowerCase().replace(/\([^)]*\)/g, " ");
  const before = clean.split(/\s+of\s+/)[0] ?? clean;
  const w = words(before);
  return w.length ? w[w.length - 1]! : null;
}

export interface AppFeature { ref: string; name: string; description: string; screenIds?: readonly string[] }
export interface AppScreen { id: string; name: string; featureRefs?: readonly string[]; sortOrder: number }

/** Each screen's feature: an explicit link first, else the feature whose name and description share the most words with
 *  the screen's name (its title counts twice, the word the name is about once more); ties go to the earlier feature.
 *  A screen sharing no word with any feature belongs to none (a sign-in, a start page). */
export function screenFeatures(features: readonly AppFeature[], screens: readonly AppScreen[]): Map<string, string | null> {
  const out = new Map<string, string | null>();
  const known = new Set(features.map((f) => f.ref));
  const prepared = features.map((f) => ({ ref: f.ref, title: new Set(words(f.name)), desc: new Set(words(f.description)) }));
  for (const s of screens) {
    const linked = features.find((f) => f.screenIds?.includes(s.id))?.ref ?? s.featureRefs?.find((r) => known.has(r)) ?? null;
    if (linked) { out.set(s.id, linked); continue; }
    const mine = [...new Set(words(s.name))];
    const head = headWord(s.name);
    let best: string | null = null;
    let bestScore = 0;
    for (const f of prepared) {
      let score = 0;
      for (const w of mine) score += f.title.has(w) ? 2 : f.desc.has(w) ? 1 : 0;
      if (head && score > 0) score += f.title.has(head) ? 2 : f.desc.has(head) ? 1 : 0;
      if (score > bestScore) { best = f.ref; bestScore = score; }
    }
    out.set(s.id, best);
  }
  return out;
}

/* ── the pages of the app ─────────────────────────────────────────────────────────────────────────────────────── */

export interface AppPage {
  id: string;
  title: string;
  /** The feature the page belongs to (null: a general screen such as the sign-in). */
  featureRef: string | null;
  /** The designed screen the page shows; null for a page drawn from the feature's user stories. */
  screenId: string | null;
  isNew: boolean;
}

/** The app's pages in order: the general screens first, then every shown feature with its screens (or one page drawn
 *  from its stories when it has none). Screens of features that are not in this version stay out. */
/** A screen's name as a page title, without a designer's note in brackets ("Order status (phone)" → "Order status"). */
const pageTitle = (name: string): string => name.replace(/\s*\([^)]*\)\s*$/, "").trim() || name;

export function appPages(a: {
  features: readonly AppFeature[];
  screens: readonly AppScreen[];
  refs: readonly string[];
  newRefs: readonly string[];
}): AppPage[] {
  const byRef = new Map(a.features.map((f) => [f.ref, f]));
  const owner = screenFeatures(a.features, a.screens);
  const screens = [...a.screens].sort((x, y) => x.sortOrder - y.sortOrder);
  const pages: AppPage[] = screens
    .filter((s) => owner.get(s.id) === null)
    .map((s) => ({ id: `screen:${s.id}`, title: pageTitle(s.name), featureRef: null, screenId: s.id, isNew: false }));
  for (const ref of a.refs) {
    const f = byRef.get(ref);
    if (!f) continue;
    const isNew = a.newRefs.includes(ref);
    const own = screens.filter((s) => owner.get(s.id) === ref);
    if (own.length) for (const s of own) pages.push({ id: `screen:${s.id}`, title: pageTitle(s.name), featureRef: ref, screenId: s.id, isNew });
    else pages.push({ id: `feature:${ref}`, title: f.name, featureRef: ref, screenId: null, isNew });
  }
  return pages;
}

/** Two letters for the app's mark ("Spare Parts Webshop" → SP). */
export function appInitials(name: string): string {
  const w = name.split(/\s+/).filter((x) => /^[\p{L}\p{N}]/u.test(x));
  return ((w[0]?.[0] ?? "") + (w[1]?.[0] ?? w[0]?.[1] ?? "")).toUpperCase() || "·";
}

/** Text that reads well on a brand colour: dark on a light colour, white otherwise. */
export function inkOn(rgb: readonly [number, number, number]): "#ffffff" | "#111827" {
  const [r, g, b] = rgb.map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.45 ? "#111827" : "#ffffff";
}
