/** The Release page's truth about where the app runs, for every project and above all for an existing product attached
 *  to the Factory as it is live (attachedLive: it was running before the Factory released anything). Pure: no store, no
 *  React; the page and its tests read these rules.
 *   - An environment the records know to be live (a release with an address, or an address documented from the live
 *     product) is never "Not released yet"; one without a version the Factory released says so plainly.
 *   - Every release in the history names its source commit, or says "commit unknown".
 *   - "Idea to first release" is only for a project the Factory started; an attached product shows how long it has been
 *     with the Factory and what the Factory released since.
 *   - "Send vX for approval" says what it moves: the version, from which environment to which, and the change requests
 *     it carries. */
import { changeRequestsToPromote, safeExternalUrl } from "../../domain/delivery";
import type { Environment, GatedEnvironment } from "../../domain/promotion";
import { envName, envWord } from "./releaseUi";
import { t } from "@/i18n";
const DAY_MS = 86_400_000;

/* ── commits ──────────────────────────────────────────────────────────────────────────────────────────────────── */

/** The short form of a source commit (7 characters of a git hash); null for anything that is not one. */
export function shortCommit(sha: string | null | undefined): string | null {
  const s = (sha ?? "").trim();
  return /^[0-9a-f]{7,64}$/i.test(s) ? s.slice(0, 7).toLowerCase() : null;
}

/** "commit 1a2b3c4", or "commit unknown" when the release record does not name one. */
export function commitLabel(sha: string | null | undefined): string {
  const c = shortCommit(sha);
  return c ? t("build.release.where.commit", "commit {commit}", { commit: c }) : t("build.release.where.commitUnknown", "commit unknown");
}

/* ── where it runs ────────────────────────────────────────────────────────────────────────────────────────────── */

/** What the records know about an environment besides the Factory's releases: its address and branch, documented from
 *  the live product (an attached product's staging that ran before the Factory released anything there). */
export interface EnvironmentFact {
  environment: Environment;
  url: string | null;
  branch: string | null;
  /** The version that runs there, when the documentation knows it. */
  version?: string | null;
  /** When it was documented from the live product (null: not documented, e.g. read from the project's own settings). */
  documentedAt: string | null;
}

/** The release fields the rules read. */
export interface CurrentRelease { version: string; url: string; releasedAt: string | null }

/** The key of a release in the documented set: "stage@1.4.0". */
export const releaseKey = (r: { environment: string; version: string }): string => `${r.environment}@${r.version}`;

/** One environment as the page shows it. */
export interface WhereRow {
  env: Environment;
  /** The version that runs there: the Factory's newest release, else the documented one; null when not known. */
  version: string | null;
  /** The address (https only) and its host; null when none is known. */
  url: string | null;
  host: string | null;
  branch: string | null;
  /** Since when the version runs (the Factory's release); null for a documented environment. */
  since: string | null;
  /** live: an address is known · released: a release record without an address yet · none: nothing known. */
  state: "live" | "released" | "none";
  /** True when the Factory released the version there (false: none, or only documented from the live product). */
  factoryRelease: boolean;
  /** The version there is a release documented from the live product (it ran before the Factory released there). */
  documented: boolean;
  /** When the address or branch was documented from the live product; null when it was not. */
  documentedAt: string | null;
}

function hostOf(url: string | null): string | null {
  if (!url) return null;
  try { return new URL(url).host; } catch { return null; }
}

/** Every environment with what the records know: the releases first (the Factory's, or one documented from the live
 *  product: `documented` holds their releaseKey), the documented facts for the rest. */
export function whereItRuns(
  states: Record<Environment, { current: CurrentRelease | null }>,
  facts: readonly EnvironmentFact[],
  documented: ReadonlySet<string> = new Set(),
): Record<Environment, WhereRow> {
  const out = {} as Record<Environment, WhereRow>;
  for (const env of ["dev", "stage", "production"] as const) {
    const cur = states[env].current;
    const fact = facts.find((f) => f.environment === env) ?? null;
    const releaseUrl = safeExternalUrl(cur?.url ?? "");
    const factUrl = safeExternalUrl(fact?.url ?? "");
    const url = releaseUrl ?? factUrl;
    const branch = (fact?.branch ?? "").trim() || null;
    const version = cur?.version ?? ((fact?.version ?? "").trim() || null);
    const curDocumented = Boolean(cur && documented.has(releaseKey({ environment: env, version: cur.version })));
    const usedFact = Boolean(fact && ((!releaseUrl && factUrl) || branch || (!cur && version) || curDocumented));
    out[env] = {
      env, version, url, host: hostOf(url), branch,
      since: cur?.releasedAt ?? null,
      state: url ? "live" : cur ? "released" : "none",
      factoryRelease: Boolean(cur) && !curDocumented,
      documented: curDocumented,
      documentedAt: usedFact ? fact?.documentedAt ?? null : null,
    };
  }
  return out;
}

/** The short value beside an environment's name: "v0.8.0", "Live" (live, version not recorded), or "Not released yet". */
export function whereValue(row: WhereRow): string {
  if (row.version) return `v${row.version}`;
  return row.state === "live" ? t("build.release.where.live", "Live") : t("build.release.where.notReleased", "Not released yet");
}

/** The line under an environment's name: since when its version runs, or that it is live without a Factory release. */
export function whereLine(row: WhereRow, formatDate: (at: string) => string): string | null {
  const since = row.since ? formatDate(row.since) : "";
  if (row.factoryRelease) return since ? t("build.release.where.since", "Since {date}", { date: since }) : null;
  const when = row.documentedAt ? formatDate(row.documentedAt) : "";
  const documented = when ? t("build.release.where.documentedOn", "documented from the live product on {date}", { date: when })
    : t("build.release.where.documented", "documented from the live product");
  if (row.documented) {
    return since ? `${t("build.release.where.since", "Since {date}", { date: since })} · ${documented}`
      : when ? t("build.release.where.documentedOnStart", "Documented from the live product on {date}", { date: when })
        : t("build.release.where.documentedStart", "Documented from the live product");
  }
  if (row.state !== "live") return null;
  const known = row.version ? "" : ` ${t("build.release.where.versionUnknown", "The version it runs is not recorded yet.")}`;
  return row.documentedAt
    ? `${t("build.release.where.liveBefore", "Live before the Factory released here")} · ${documented}.${known}`
    : `${t("build.release.where.liveNoRelease", "Live · the Factory has not released a version here yet.")}${known}`;
}

/* ── idea to first release ────────────────────────────────────────────────────────────────────────────────────── */

export type FirstReleaseFact =
  /** A project the Factory started: whole days from its start to its first release to development. */
  | { kind: "idea"; days: number; from: string; to: string }
  /** An existing product attached as it is live: since when it is with the Factory, and the releases made since. */
  | { kind: "attached"; since: string | null; releases: number; firstAt: string | null }
  | { kind: "unknown" };

/** "Idea to first release" only for a project the Factory started; an attached live product was running long before. */
export function firstReleaseFact(input: {
  attached: boolean;
  createdDate: string | null | undefined;
  devReleases: readonly { releasedAt: string | null }[];
}): FirstReleaseFact {
  const dated = input.devReleases.map((r) => r.releasedAt).filter((d): d is string => Boolean(d) && Number.isFinite(Date.parse(d!)))
    .sort((a, b) => Date.parse(a) - Date.parse(b));
  const firstAt = dated[0] ?? null;
  if (input.attached) {
    const since = input.createdDate && Number.isFinite(Date.parse(input.createdDate)) ? input.createdDate : null;
    return { kind: "attached", since, releases: input.devReleases.length, firstAt };
  }
  const a = Date.parse(input.createdDate ?? "");
  const b = Date.parse(firstAt ?? "");
  if (!Number.isFinite(a) || !Number.isFinite(b) || b < a) return { kind: "unknown" };
  return { kind: "idea", days: Math.floor((b - a) / DAY_MS), from: input.createdDate!, to: firstAt! };
}

/* ── what "Send vX for approval" moves ────────────────────────────────────────────────────────────────────────── */

const list = (xs: readonly string[], max = 4): string => {
  const shown = xs.length > max ? [...xs.slice(0, max - 1), t("build.release.move.more", "{count} more", { count: xs.length - (max - 1) })] : [...xs];
  return shown.length <= 1 ? shown.join("")
    : t("build.release.move.list", "{items} and {last}", { items: shown.slice(0, -1).join(", "), last: shown[shown.length - 1]! });
};

/** The primary button's words: "Send v0.8.0 to Staging for approval". */
export function sendLabel(version: string, target: GatedEnvironment): string {
  return t("build.release.move.send", "Send v{version} to {env} for approval", { version, env: envName(target) });
}

/** What a release sent for approval moves, in one or two plain sentences: "Once approved, v0.8.0 goes from development
 *  to staging with CR-001, CR-002 and CR-004. Staging runs v0.7.0 until then." */
export function promotionMoveText<C extends { id: string; status: string; version: string | null; lane: string; number: number }>(input: {
  target: GatedEnvironment;
  version: string;
  where: Record<Environment, WhereRow>;
  changes: readonly C[];
  code: (c: C) => string;
}): string {
  const from = input.target === "stage" ? "dev" : "stage";
  const carried = changeRequestsToPromote(input.changes, input.target, input.version)
    .sort((a, b) => a.number - b.number).map(input.code);
  const head = carried.length
    ? t("build.release.move.headWith", "Once approved, v{version} goes from {from} to {to} with {changes}.",
      { version: input.version, from: envWord(from), to: envWord(input.target), changes: list(carried) })
    : t("build.release.move.head", "Once approved, v{version} goes from {from} to {to}.", { version: input.version, from: envWord(from), to: envWord(input.target) });
  const there = input.where[input.target];
  const until = there.version
    ? ` ${t("build.release.move.runsUntil", "{env} runs v{version} until then.", { env: envName(input.target), version: there.version })}`
    : there.state === "live" ? ` ${t("build.release.move.keepsUntil", "{env} keeps what it runs now until then.", { env: envName(input.target) })}` : "";
  return head + until;
}

/* ── the first release note ───────────────────────────────────────────────────────────────────────────────────── */

/** The first release's note: what the milestones delivered for a project the Factory built; for an existing product
 *  attached as it is live, the product as it was (it had no milestones; its changes follow as change requests). */
export function firstNoteText(attached: boolean, changes = 0): string {
  if (!attached) return t("build.release.notes.first", "The first release: everything the milestones delivered.");
  return changes > 0
    ? t("build.release.notes.firstAttachedChanges", "The first release through the Factory: the product as it was live, with these changes.")
    : t("build.release.notes.firstAttached", "The first release through the Factory: the product as it was live, before any change request.");
}

/* ── milestones on the Release page ───────────────────────────────────────────────────────────────────────────── */

/** What the Release page takes from the milestones. An attached live product's milestones are documented from it (its
 *  released history and open change requests): never what its first release delivered, never "the locked scope plans N
 *  milestones", never a Factory scope that hides "Add a feature"; their previews show only once one exists. */
export function releaseMilestones(attached: boolean, previews: number): { inNotes: boolean; inHero: boolean; mayScope: boolean; showPreviews: boolean } {
  return { inNotes: !attached, inHero: !attached, mayScope: !attached, showPreviews: !attached || previews > 0 };
}
