/** The Projects page, pure rules: the remembered view (grid or list), where a project stands in the four steps, its
 *  newest release, whether a build runs for it and the quick actions that fit where it stands. No React or DOM. */
import { buildTabPath, type JourneyStep } from "@/madp/domain/journey";
import { PHASE_COUNT, phaseNumber, phaseOf } from "@/madp/domain/phases";
import { phaseNameOf } from "@/madp/components/project/stepNames";
import { ENV_LABEL, isActiveJob, releaseRows, type DashJob, type DashProject, type DashRelease, type ReleaseEnv } from "@/madp/domain/dashboard";
import type { EngineJobKind } from "@/madp/domain/engineJob";
import { getCulture, t } from "@/madp/i18n";
import { prefixPath } from "@/madp/lib/pathPrefix";

/* ── the view: grid or list, remembered per browser ───────────────────────── */

export type ProjectsViewMode = "grid" | "list";
export const PROJECTS_VIEW_KEY = "madp-projects-view-v1";
export const DEFAULT_PROJECTS_VIEW: ProjectsViewMode = "grid";

type ViewStore = Pick<Storage, "getItem" | "setItem">;

/** The browser's localStorage, or null where it is not there or refuses (private windows, blocked site data). */
function browserStore(): ViewStore | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

/** The remembered view; the grid when nothing (or something unknown) is stored or the storage refuses. */
export function readProjectsView(store: ViewStore | null = browserStore()): ProjectsViewMode {
  try {
    const v = store?.getItem(PROJECTS_VIEW_KEY);
    return v === "grid" || v === "list" ? v : DEFAULT_PROJECTS_VIEW;
  } catch {
    return DEFAULT_PROJECTS_VIEW;
  }
}

/** Remembers the view; a storage that refuses only means it is not remembered. */
export function writeProjectsView(mode: ProjectsViewMode, store: ViewStore | null = browserStore()): void {
  try {
    store?.setItem(PROJECTS_VIEW_KEY, mode);
  } catch {
    /* not remembered */
  }
}

/* ── where it stands ──────────────────────────────────────────────────────── */

/** "Business Analysis", step 2 of 4, the bar a quarter per step (as the Dashboard's project list). */
export interface JourneyAt { label: string; n: number; total: number; pct: number }

export function journeyAt(step: JourneyStep): JourneyAt {
  const n = phaseNumber(step);
  return { label: phaseNameOf(step), n, total: PHASE_COUNT, pct: (n / PHASE_COUNT) * 100 };
}

/** "5 min ago", "2 d ago" or the date; "" when the time is unknown. */
export function relativeTime(value: unknown, now: number = Date.now()): string {
  if (value === undefined || value === null || value === "") return "";
  const ms = new Date(value as string | number | Date).getTime();
  if (Number.isNaN(ms)) return "";
  const s = Math.max(0, Math.round((now - ms) / 1000));
  if (s < 60) return t("shell.time.justNow", "just now");
  if (s < 3600) return t("shell.time.minutesAgo", "{n} min ago", { n: Math.floor(s / 60) });
  if (s < 86400) return t("shell.time.hoursAgo", "{n} h ago", { n: Math.floor(s / 3600) });
  if (s < 7 * 86400) return t("shell.time.daysAgo", "{n} d ago", { n: Math.floor(s / 86400) });
  return new Date(ms).toLocaleDateString(getCulture() === "de-CH" ? "de-CH" : undefined);
}

/* ── facts from the dashboard's records ───────────────────────────────────── */

/** The jobs that build the app (the Dashboard's "Live now" kinds). */
const BUILD_KINDS: readonly EngineJobKind[] = ["build.run", "change.build"];

/** The projects with a build queued or running. */
export function buildingProjects(jobs: readonly Pick<DashJob, "projectId" | "kind" | "status">[]): Set<string> {
  return new Set(jobs.filter((j) => BUILD_KINDS.includes(j.kind) && isActiveJob(j)).map((j) => j.projectId));
}

/** A project's newest release, on the furthest environment it reached (the Dashboard's rule). */
export interface LatestRelease { version: string; env: ReleaseEnv; envLabel: string; releasedAt: string }

export const versionText = (v: string) => `v${v.replace(/^v/i, "")}`;

export function latestReleases(projects: readonly DashProject[], releases: readonly DashRelease[]): Map<string, LatestRelease> {
  const out = new Map<string, LatestRelease>();
  for (const row of releaseRows(projects, releases)) {
    const env: ReleaseEnv | null = row.production ? "production" : row.stage ? "stage" : row.dev ? "dev" : null;
    const at = env ? row[env] : null;
    if (env && at) out.set(row.projectId, { version: at.version, env, envLabel: ENV_LABEL[env], releasedAt: at.releasedAt });
  }
  return out;
}

/* ── quick actions ────────────────────────────────────────────────────────── */

export type QuickActionId = "docs" | "tests" | "watch";

export interface QuickAction {
  id: QuickActionId;
  label: string;
  /** The tooltip and the accessible name's tail ("Docs: what MADP produced …"). */
  title: string;
  to: string;
  /** "Watch the build" while a build runs for the project. */
  highlight: boolean;
}

/** What people come back for, for where the project stands:
 *   Docs  – what MADP produced (/p/:id/produced), always;
 *   Tests – the automated test results: the Build page's Timeline opened on its Test stage (?stage=test), which holds
 *           the tester's records, from Software Engineering on;
 *   Watch the build – the live build (the Build page's Studio), from Software Engineering on or while a build runs;
 *           highlighted while one runs.
 *  None for a project being deleted. */
export function quickActions(p: { id: string; step: JourneyStep; status?: string }, building = false): QuickAction[] {
  if (p.status === "deleting") return [];
  const out: QuickAction[] = [{ id: "docs", label: t("shell.projects.quick.docs", "Docs"), title: t("shell.projects.quick.docsTitle", "What MADP produced for this project"), to: prefixPath(`/p/${p.id}/produced`), highlight: false }];
  const phase = phaseOf(p.step);
  const engineering = phase === "engineering" || phase === "release";
  if (engineering) {
    out.push({ id: "tests", label: t("shell.projects.quick.tests", "Tests"), title: t("shell.projects.quick.testsTitle", "Automated test results: the Test stage of the build timeline"), to: buildTabPath(p.id, "timeline", null, "test"), highlight: false });
  }
  if (engineering || building) {
    out.push({
      id: "watch", label: t("shell.projects.quick.watch", "Watch the build"), to: buildTabPath(p.id, "studio"), highlight: building,
      title: building ? t("shell.projects.quick.watchRunning", "A build is running: watch it live") : t("shell.projects.quick.watchTitle", "The live build view"),
    });
  }
  return out;
}
