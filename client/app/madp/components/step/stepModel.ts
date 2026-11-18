import { getCulture, t } from "@/madp/i18n";
/** Pure helpers of the shared step frame (StepFrame.tsx): the one-line status from the checklist chips and the
 *  sign-off line. No React, no DOM. */

type ChipLike = { state?: string; done?: boolean };
const openChip = (c: ChipLike) => (c.state ? c.state === "todo" || c.state === "attention" : !c.done);

/** How many chips still wait for the client ("todo" / "attention", or done: false). */
export function chipsLeft(chips: readonly ChipLike[]): number {
  return chips.filter(openChip).length;
}

/** "Ready" when nothing is open, else "2 things left" / "1 thing left". */
export function chipsStatusText(chips: readonly ChipLike[], readyText = t("project.step.ready", "Ready")): string {
  const left = chipsLeft(chips);
  if (left === 0) return readyText;
  return left === 1 ? t("project.step.thingLeft", "{count} thing left", { count: left }) : t("project.step.thingsLeft", "{count} things left", { count: left });
}

/** The status line from the chips: { tone: "done", text: readyText } or { tone: "todo", text: "2 things left" }. */
export function chipsStatus(chips: readonly ChipLike[], readyText = t("project.step.ready", "Ready")): { tone: "done" | "todo"; text: string } {
  return { tone: chipsLeft(chips) === 0 ? "done" : "todo", text: chipsStatusText(chips, readyText) };
}

/** "26 Oct 2026, 08:45" (the date format the hand-over always used). */
export function formatSignOffTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  if (getCulture() === "de-CH") {
    // Swiss style: 26.10.2026, 08:45
    const date = d.toLocaleDateString("de-CH", { day: "2-digit", month: "2-digit", year: "numeric" });
    const time = d.toLocaleTimeString("de-CH", { hour: "2-digit", minute: "2-digit", hour12: false });
    return `${date}, ${time}`;
  }
  const date = d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
  const time = d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false });
  return `${date}, ${time}`;
}

/** "Signed off by Anna Rossi on 26 Oct 2026, 08:45" (verb and parts optional). */
export function signOffText(o: { verb?: string; by?: string | null; at?: string | null }): string {
  const verb = o.verb?.trim() || t("project.step.signedOff", "Signed off");
  const by = o.by?.trim() ?? "";
  const at = o.at ? formatSignOffTime(o.at) : "";
  if (by && at) return t("project.step.signOffByAt", "{verb} by {by} on {at}", { verb, by, at });
  if (by) return t("project.step.signOffBy", "{verb} by {by}", { verb, by });
  if (at) return t("project.step.signOffAt", "{verb} on {at}", { verb, at });
  return verb;
}

/** The first name of a display name ("Anna Rossi" → "Anna"), for a chip's short value. */
export function firstName(name: string): string {
  const t = name.trim();
  return t ? t.split(/\s+/)[0] ?? t : "";
}
