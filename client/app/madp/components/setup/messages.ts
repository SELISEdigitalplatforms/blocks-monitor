/** Error messages for the business agent's document review. */
import { messageFor } from "@/madp/blocks/projects/messages";
import { t } from "@/madp/i18n";

export function setupMessage(e: unknown): string {
  const key = (e as { messageKey?: unknown } | null)?.messageKey;
  if (key === "project.setupNothingToSave") return t("shell.setup.nothingToSave", "There is nothing to save yet.");
  return messageFor(e);
}
