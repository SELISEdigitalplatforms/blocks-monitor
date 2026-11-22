/** Pure: how a question's owner is shown. A person's id is never shown: their name, "You", or nothing. */
import { t } from "@/i18n";
const ID_LIKE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const isPersonId = (owner: string): boolean => ID_LIKE.test(owner.trim());

/** `name` is the member's name, or "" when it isn't known (a former member, still loading). */
export function ownerShown(owner: string, o: { selfId: string | null; name: string }): string {
  const v = owner.trim();
  if (!v) return "";
  if (!isPersonId(v)) return v;
  if (o.selfId && v.toLowerCase() === o.selfId.toLowerCase()) return t("analysis.requirements.ownerYou", "You");
  return o.name && !isPersonId(o.name) ? o.name : "";
}
