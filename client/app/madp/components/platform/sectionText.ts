// Platform management's section titles, sentences and group names in the current language. The English stays in
// domain/platformSections.ts (pure, read by the route guard); the screens read it through these helpers at render time.
// Every key is written out as a t() call so npm run i18n:push finds it; a test checks the English matches the domain.
import { t } from "@/madp/i18n";
import type { PlatformGroup, PlatformSectionKey } from "@/madp/domain/platformSections";

const LABEL: Readonly<Record<PlatformSectionKey, () => string>> = {
  "overview": () => t("platform.sections.overview.label", "Overview"),
  "organizations": () => t("platform.sections.organizations.label", "Organizations"),
  "people": () => t("platform.sections.people.label", "People"),
  "roles": () => t("platform.sections.roles.label", "Roles & permissions"),
  "plans": () => t("platform.sections.plans.label", "Plans"),
  "credits": () => t("platform.sections.credits.label", "Credits & coupons"),
  "usage": () => t("platform.sections.usage.label", "Usage & costs"),
  "engine": () => t("platform.sections.engine.label", "Engine & capacity"),
  "ai-accounts": () => t("platform.sections.aiAccounts.label", "Model accounts"),
  "settings": () => t("platform.sections.settings.label", "Settings"),
  "audit": () => t("platform.sections.audit.label", "Audit"),
};

const SUMMARY: Readonly<Record<PlatformSectionKey, () => string>> = {
  "overview": () => t("platform.sections.overview.summary", "What the platform spends, how busy the engine is, and what waits for you."),
  "organizations": () => t("platform.sections.organizations.summary", "Every organization on the platform, its members and its roles."),
  "people": () => t("platform.sections.people.summary", "Everyone who can sign in, and the people waiting for an account."),
  "roles": () => t("platform.sections.roles.summary", "The roles people hold on the platform and what each one may do."),
  "plans": () => t("platform.sections.plans.summary", "The plans organizations choose from: price, monthly credit, human help and parallel work."),
  "credits": () => t("platform.sections.credits.summary", "Credit balances, purchase requests waiting for a decision, and coupons."),
  "usage": () => t("platform.sections.usage.summary", "What the engine's work cost, by organization, project, person, model or day."),
  "engine": () => t("platform.sections.engine.summary", "The engine hosts, how loaded they are, and the work running now."),
  "ai-accounts": () => t("platform.sections.aiAccounts.summary", "The model accounts the engine works with, their limits and when they rotate."),
  "settings": () => t("platform.sections.settings.summary", "Who may sign up, and the platform's own settings."),
  "audit": () => t("platform.sections.audit.summary", "Every change made on the platform, by whom and when."),
};

const GROUP: Readonly<Record<PlatformGroup, () => string>> = {
  Organization: () => t("platform.groups.organization", "Organization"),
  Business: () => t("platform.groups.business", "Business"),
  Operations: () => t("platform.groups.operations", "Operations"),
  System: () => t("platform.groups.system", "System"),
};

/** The section's title (Overview, Plans, …). */
export function platformSectionLabel(key: PlatformSectionKey): string {
  return LABEL[key]();
}

/** The one sentence under the section's title. */
export function platformSectionSummary(key: PlatformSectionKey): string {
  return SUMMARY[key]();
}

/** A navigation group's name (Organization, Business, Operations, System). */
export function platformGroupLabel(group: PlatformGroup): string {
  return GROUP[group]();
}
