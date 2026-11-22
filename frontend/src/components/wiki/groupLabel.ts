/** A wiki group's name in the chosen language (each key written out in full); an unknown group shows its id. */
import { t } from "@/i18n";

export function wikiGroupLabel(group: string): string {
  switch (group) {
    case "overview": return t("wiki.groups.overview", "Overview");
    case "guide": return t("wiki.groups.guide", "Guide");
    case "features": return t("wiki.groups.features", "Features");
    case "logic": return t("wiki.groups.logic", "Logic");
    case "technical": return t("wiki.groups.technical", "Technical");
    case "decisions": return t("wiki.groups.decisions", "Decisions");
    case "releases": return t("wiki.groups.releases", "Releases");
    default: return group;
  }
}
