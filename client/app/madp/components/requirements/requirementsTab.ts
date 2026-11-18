/**
 * URL tab state for the Requirements & objective page.
 * Pure helpers: the active tab lives in the `?tab=` query parameter, so a
 * reload or a shared link keeps it. Unknown values fall back to the default.
 */
import { t } from "@/madp/i18n";

export const REQ_TABS = ['objective', 'summary', 'must', 'workflows', 'questions', 'suggestions', 'design'] as const;

export type ReqTab = (typeof REQ_TABS)[number];

export const DEFAULT_REQ_TAB: ReqTab = 'objective';

export const TAB_PARAM = 'tab';

/** Getters: each label is read at render time, so it comes in the current language. */
export const REQ_TAB_LABEL: Record<ReqTab, string> = {
  get objective() { return t("analysis.requirements.tabObjective", "Objective"); },
  get summary() { return t("analysis.requirements.tabSummary", "Summary"); },
  get must() { return t("analysis.requirements.tabMust", "What it must do"); },
  get workflows() { return t("analysis.requirements.tabWorkflows", "Workflows & limits"); },
  get questions() { return t("analysis.requirements.tabQuestions", "Open questions"); },
  get suggestions() { return t("analysis.requirements.tabSuggestions", "Suggestions"); },
  get design() { return t("analysis.requirements.tabDesign", "Look & feel"); },
};

export function isReqTab(v: unknown): v is ReqTab {
  return typeof v === 'string' && (REQ_TABS as readonly string[]).includes(v);
}

export function tabFromSearch(search: string | URLSearchParams | null | undefined): ReqTab {
  if (search == null) return DEFAULT_REQ_TAB;
  const params = typeof search === 'string' ? new URLSearchParams(search) : search;
  const value = params.get(TAB_PARAM);
  return isReqTab(value) ? value : DEFAULT_REQ_TAB;
}

export function searchWithTab(search: string | URLSearchParams, tab: ReqTab): URLSearchParams {
  const next = new URLSearchParams(typeof search === 'string' ? search : search.toString());
  next.set(TAB_PARAM, tab);
  return next;
}
