/** Pure helpers of the Blocks release page. Nothing here reads a store or invents a value. */
import type { Environment, GatedEnvironment } from "../../domain/promotion";
import { promotionCandidate } from "../../domain/delivery";
import { appLink } from "../../domain/appPreview";
import { t } from "@/i18n";

/** An environment's name, as everywhere in the app (Release step, dashboard, assistant): "Staging". */
export function envName(env: Environment): string {
  return env === "dev" ? t("build.release.env.dev", "Development")
    : env === "stage" ? t("build.release.env.stage", "Staging")
      : t("build.release.env.production", "Production");
}

/** An environment's name inside a sentence: "staging" ("Staging" in German, where nouns keep their capital). */
export function envWord(env: Environment): string {
  return env === "dev" ? t("build.release.envWord.dev", "development")
    : env === "stage" ? t("build.release.envWord.stage", "staging")
      : t("build.release.envWord.production", "production");
}

/** The environments in plain words; each read in the current language when it is read (envName). */
export const ENV_LABEL: Record<Environment, string> = {
  get dev() { return envName("dev"); },
  get stage() { return envName("stage"); },
  get production() { return envName("production"); },
};

/** "Released · going live in a moment" */
export const waitingText = (): string => t("build.release.link.waiting", "Released · going live in a moment");
/** "Not deployed yet" */
export const notDeployedText = (): string => t("build.release.link.notDeployed", "Not deployed yet");
/** The English texts, for code that reads them as constants; the page reads waitingText() and notDeployedText(). */
export const WAITING_TEXT = "Released · going live in a moment";
export const NOT_DEPLOYED_TEXT = "Not deployed yet";

const CR_STATUS_TEXT: Record<string, () => string> = {
  draft: () => t("build.release.crStatus.draft", "Draft"),
  analysing: () => t("build.release.crStatus.analysing", "Being analysed"),
  questions: () => t("build.release.crStatus.questions", "Questions for you"),
  review: () => t("build.release.crStatus.review", "Waiting for approval"),
  approved: () => t("build.release.crStatus.approved", "Approved"),
  rejected: () => t("build.release.crStatus.rejected", "Rejected"),
  failed: () => t("build.release.crStatus.failed", "Stopped"),
  building: () => t("build.release.crStatus.building", "Being built"),
  "released-dev": () => t("build.release.crStatus.releasedDev", "Released to development"),
  "promoted-stage": () => t("build.release.crStatus.promotedStage", "On staging"),
  "promoted-production": () => t("build.release.crStatus.promotedProduction", "In production"),
};

/** A change request's status in plain words, in the current language (each read when it is read). */
export const CR_STATUS_LABEL: Record<string, string> = Object.defineProperties({} as Record<string, string>,
  Object.fromEntries(Object.entries(CR_STATUS_TEXT).map(([k, f]) => [k, { get: f, enumerable: true }])));

export function crStatusLabel(status: string): string {
  return CR_STATUS_TEXT[status]?.() ?? status;
}

export type ReleaseLinkState =
  | { kind: "link"; href: string; host: string }
  | { kind: "waiting"; text: string }
  | { kind: "none"; text: string };

/** What an environment card shows for a release: a link only for an https address (it opens the version's app page;
 *  `host` is the address to show); stage or production without one is "released, going live" (the engine deploys it;
 *  never shown as live before); dev without one is "Not deployed yet". */
export function releaseLinkState(
  env: Environment,
  release: { url?: string | null; version?: string; projectId?: string | null } | null,
): ReleaseLinkState {
  const link = release ? appLink({ url: release.url, version: release.version ?? "", projectId: release.projectId, environment: env }) : null;
  if (link) return { kind: "link", href: link.href, host: link.host };
  if (release && env !== "dev") return { kind: "waiting", text: waitingText() };
  return { kind: "none", text: notDeployedText() };
}

interface RequestLike { status: string }

/** The one primary action of the page: request approval first, then promote. */
export function primaryActionFor(a: {
  candidate: string | null;
  pending: RequestLike | null;
  forCandidate: RequestLike | null;
}): "request" | "promote" | null {
  if (!a.candidate) return null;
  const c = a.forCandidate;
  if (c && (c.status === "pending" || c.status === "approved")) return "promote";
  if (!a.pending) return "request";
  return null;
}

/** Which gated environment the promotion card shows: ?env= wins, then the first with a candidate, then stage. */
export function pickTarget(param: string | null, states: Parameters<typeof promotionCandidate>[0]): GatedEnvironment {
  if (param === "stage" || param === "production") return param;
  for (const t of ["stage", "production"] as const) if (promotionCandidate(states, t)) return t;
  return "stage";
}
