/** ONE rule for a change request whose build stopped, read by every place that shows it: the change request's page, the
 *  Release page's change list and its "being built" line, Software Engineering's header, Studio, the Queue and the
 *  Board. A change request's build has stopped when its newest build (change.build) failed or was cancelled and nothing
 *  runs for it (the engine then leaves the request at "building"), or when the request itself is "failed" after its
 *  approval: changeStage (./changeFlow.ts) says "buildFailed". Whether a person cancelled it or the system stopped it,
 *  people read the same word everywhere, "Stopped", and the same sentence, "The build of CR-006 stopped"; it starts
 *  again from the change request ("Start the build again", cr.startBuild). Pure. */
import type { DeliveryChangeRequest } from "@/blocks/delivery/types";
import { crStatusLabel } from "@/components/delivery/releaseUi";
import { analysisOf, buildStopped, changeStage } from "./changeFlow";
import { t } from "@/i18n";

/** The one word for it (a chip, a status column, a lane). */
export const STOPPED_WORD = "Stopped";

/** What happens next, in plain words. */
export const STOPPED_NEXT = "It starts again from the change request.";
/** STOPPED_WORD and STOPPED_NEXT in the current language (the constants stay the English source). */
export const stoppedWord = (): string => t("changes.stopped.word", "Stopped");
export const stoppedNext = (): string => t("changes.stopped.next", "It starts again from the change request.");

/** The change request fields the rule reads. */
export type StoppableChange = Pick<DeliveryChangeRequest, "status" | "analysis"> & { decidedAt?: string | null };

/** True when the change request's build stopped: its newest build (`newestBuild`, the change's newest change.build job)
 *  failed or was cancelled while the request is still "building", or the approved request itself failed. A change
 *  request saved before the analysis existed (no Analysis) counts the same way while it is "building". */
export function changeStopped(cr: StoppableChange, newestBuild: { status: string } | null | undefined): boolean {
  const analysis = analysisOf(cr);
  if (!analysis) return cr.status === "building" && buildStopped(newestBuild);
  return changeStage(cr.status, analysis, { decidedAt: cr.decidedAt ?? null }, newestBuild) === "buildFailed";
}

/** "The build of CR-006 stopped" (no full stop: a status line); "The build stopped" when the change can't be named. */
export function stoppedText(code: string | null | undefined): string {
  return code ? t("changes.stopped.buildOf", "The build of {code} stopped", { code }) : t("changes.stopped.build", "The build stopped");
}

/** The stopped build's line for people: the build's own line when it already says how it stopped ("The build of CR-006
 *  stopped while reading the code."), else the rule's sentence about `what` ("CR-006", "milestone 2"); for a change
 *  request (`change`), what happens next. Never the engine's step words (src/blocks/engine/laneLine.ts turns those into
 *  plain words on read). */
export function stoppedLine(what: string | null | undefined, message: string | null | undefined, change = true): string {
  const own = (message ?? "").trim();
  const said = /\bstopped\b/i.test(own) ? own : `${stoppedText(what)}.`;
  const ended = /[.!?]$/.test(said) ? said : `${said}.`;
  return change && !/start (?:it|the build) again/i.test(ended) ? `${ended} ${stoppedNext()}` : ended;
}

/** A change request's state in one word, as the Release page's change list says it ("Stopped", "Being built",
 *  "Released to development", …): "Stopped" by the rule above; an approved request still "building" with nothing
 *  running (the next increment of a feature waits) is "Approved", never "Being built". */
export function changeStatusWord(cr: StoppableChange, newestBuild: { status: string } | null | undefined): string {
  if (changeStopped(cr, newestBuild)) return stoppedWord();
  const analysis = analysisOf(cr);
  const stage = analysis ? changeStage(cr.status, analysis, { decidedAt: cr.decidedAt ?? null }, newestBuild) : null;
  return crStatusLabel(stage === "approved" && cr.status === "building" ? "approved" : cr.status);
}
