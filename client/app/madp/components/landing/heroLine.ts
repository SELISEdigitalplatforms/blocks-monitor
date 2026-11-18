/** The hero line's shared facts, kept free of three.js so the page can use them without loading the 3D chunk. */
import { STAGES } from "@/madp/data/pipeline";
import { t } from "@/madp/i18n";

/** stations sit at equal arc length along the 3D path (arc fraction 0..1) */
export const STATION_U0 = 0.13;
export const STATION_U7 = 0.875;
export const STATION_U = STAGES.map((_, i) => STATION_U0 + (i * (STATION_U7 - STATION_U0)) / (STAGES.length - 1));

export interface LegendStop { readonly phase: string; readonly label: string }

/** the human role behind each stop of the legend, by stage id ("brief" and "live" frame the stages); each text is read
 *  in the chosen language when it is used */
const LEGEND_BY_ID: Record<string, LegendStop> = {
  brief: { get phase() { return t("landing.legend.briefPhase", "Brief"); }, get label() { return t("landing.legend.briefRole", "Product Owner"); } },
  "01": { get phase() { return t("landing.legend.planPhase", "Plan"); }, get label() { return t("landing.legend.planRole", "Business Analyst"); } },
  "02": { get phase() { return t("landing.legend.buildPhase", "Build"); }, get label() { return t("landing.legend.buildRole", "Software Engineer"); } },
  "03": { get phase() { return t("landing.legend.reviewPhase", "Review"); }, get label() { return t("landing.legend.reviewRole", "Code Reviewer"); } },
  "04": { get phase() { return t("landing.legend.testPhase", "Test"); }, get label() { return t("landing.legend.testRole", "QA Engineer"); } },
  "05": { get phase() { return t("landing.legend.securityPhase", "Security"); }, get label() { return t("landing.legend.securityRole", "Security Engineer"); } },
  "06": { get phase() { return t("landing.legend.docsPhase", "Docs"); }, get label() { return t("landing.legend.docsRole", "Technical Writer"); } },
  "07": { get phase() { return t("landing.legend.releasePhase", "Release"); }, get label() { return t("landing.legend.releaseRole", "Release Manager"); } },
  deploy: { get phase() { return t("landing.legend.deployPhase", "Deploy"); }, get label() { return t("landing.legend.deployRole", "DevOps Engineer"); } },
  live: { get phase() { return t("landing.legend.livePhase", "Live"); }, get label() { return t("landing.legend.liveRole", "End users"); } },
};

/** what the legend under the hero names: the brief, each stage's human role, the deploy, the live app */
export const LEGEND: readonly LegendStop[] = [
  LEGEND_BY_ID.brief,
  ...STAGES.map((s) => LEGEND_BY_ID[s.id]),
  LEGEND_BY_ID.live,
];

/** the legend read in order, for screen readers, in the chosen language */
export function legendLabel(): string {
  return t("landing.legend.readOut", "From the {first}'s brief to {last}: {roles}", {
    first: LEGEND[0].label,
    last: LEGEND[LEGEND.length - 1].label,
    roles: LEGEND.slice(1, -1).map((s) => s.label).join(", "),
  });
}

/** the same sentence in the language the page opened in (kept for older callers; the hero reads legendLabel()) */
export const LEGEND_LABEL = legendLabel();

/** map the pulse position on the path to the legend's evenly spaced stops */
export function legendFraction(head: number): number {
  const keys = [0, ...STATION_U, 1];
  const last = keys.length - 1;
  if (head <= 0) return 0;
  if (head >= 1) return 1;
  for (let i = 0; i < last; i++) {
    if (head <= keys[i + 1]) return (i + (head - keys[i]) / (keys[i + 1] - keys[i])) / last;
  }
  return 1;
}
