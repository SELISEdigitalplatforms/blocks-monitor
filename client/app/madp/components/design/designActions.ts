/** What the design section offers this person, and why an action is off. Pure: the panel computes the facts, this file
 *  turns them into the status chip and the actions (one primary: Approve design, top right like every approval; the
 *  costly Change design and Generate fresh design as quiet secondary actions). The disabled conditions are the panel's
 *  existing ones, unchanged; only the reasons are new. */
import type { ChipTone } from "@/madp/data/types";
import { t } from "@/madp/i18n";
import { designTypical } from "./designProgress";

export interface DesignFacts {
  editable: boolean;
  /** A saved design (prototype) exists. */
  hasPrototype: boolean;
  /** A design job is running or being started. */
  busy: boolean;
  /** The running job is the one that made the design on screen, still saving its last screens (not a new design). */
  finishing?: boolean;
  /** Some reads are still loading or failed. */
  readsUnavailable: boolean;
  /** A read failed (not just loading). */
  readsFailed: boolean;
  /** Screen previews or exports are still missing. */
  incomplete: boolean;
  /** The design matches the latest goals and requirements. */
  current: boolean;
  /** Its live preview is ready. */
  hasPreview: boolean;
  /** The approval is being saved. */
  approving: boolean;
  /** The design brief is confirmed. */
  confirmed: boolean;
  /** A design job may be started (not busy, reads loaded, requirements present). */
  canGenerate: boolean;
  /** There are requirements to design from. */
  hasRequirements: boolean;
  /** The last attempt failed or left nothing usable. */
  unavailable: boolean;
}

export interface DesignAction {
  show: boolean;
  disabled: boolean;
  /** Why it is off (shown next to it and read with it); null when it can be used. */
  reason: string | null;
}

export interface DesignActions {
  /** The primary action: Approve design. */
  approve: DesignAction & { pending: boolean };
  /** The design is approved and current: the chip says so and the approve button gives way. */
  approved: boolean;
  change: DesignAction;
  fresh: DesignAction;
  retry: DesignAction;
}

export const changeHelp = () => t("analysis.design.changeHelp", "Say what to adjust in the journeys, layout or look. The business analyst revises this design in {typical}.", { typical: designTypical() });
export const freshHelp = () => t("analysis.design.freshHelp", "Start over with a new visual direction in a new Figma file. This design and its previews are kept.");
export const retryHelp = () => t("analysis.design.retryHelp", "Starts a new design attempt from the current goals and requirements. It takes {typical}.", { typical: designTypical() });

const loadFailed = () => t("analysis.design.loadFailed", "The design details could not be loaded. Refresh the page to try again.");
const loading = () => t("analysis.design.loading", "Loading the design…");

/** Why a new design job cannot start now (null when it can). */
function generateReason(f: DesignFacts): string | null {
  if (f.busy) return f.finishing ? t("analysis.design.stillFinishing", "This design is still being finished. Wait for it to finish.") : t("analysis.design.beingMade", "A design is being made right now. Wait for it to finish.");
  if (f.readsUnavailable) return f.readsFailed ? loadFailed() : loading();
  if (!f.hasRequirements) return t("analysis.design.addRequirementsFirst", "Add requirements first: the design is made from them.");
  return null;
}

export function designActions(f: DesignFacts): DesignActions {
  const approved = f.confirmed && f.current && !f.busy;
  const approveDisabled = !f.hasPrototype || f.incomplete || f.busy || f.readsUnavailable || !f.current || !f.hasPreview || f.approving || f.confirmed;
  const approveReason = !approveDisabled || f.approving ? null
    : f.readsUnavailable ? (f.readsFailed ? loadFailed() : loading())
    : f.busy ? (f.finishing ? t("analysis.design.waitThisFinish", "Wait for this design to finish, then review it.") : f.hasPrototype ? t("analysis.design.waitNewFinish", "Wait for the new design to finish, then review it.") : t("analysis.design.availableOnceReady", "Available once your design is ready."))
    : !f.hasPrototype ? t("analysis.design.availableOnceDesign", "Available once there is a design to review.")
    : f.incomplete ? t("analysis.design.previewsMissing", "Some screen previews are still missing, so this design cannot be approved yet.")
    : !f.current ? t("analysis.design.noLongerMatches", "This design no longer matches the latest goals and requirements. Request an updated design first.")
    : !f.hasPreview ? t("analysis.design.waitLivePreview", "Wait for the live preview to be ready.")
    : null;
  const generate = generateReason(f);
  const change = !f.editable || !f.hasPrototype ? { show: false, disabled: true, reason: null }
    : { show: true, disabled: f.incomplete || !f.canGenerate,
        reason: generate ?? (f.incomplete ? t("analysis.design.changesOnceSaved", "Changes can be requested once every screen preview is saved.") : null) };
  const fresh = !f.editable || !f.hasPrototype ? { show: false, disabled: true, reason: null }
    : { show: true, disabled: !f.canGenerate, reason: f.canGenerate ? null : generate };
  const retry = !f.editable || f.hasPrototype || !f.unavailable ? { show: false, disabled: true, reason: null }
    : { show: true, disabled: !f.canGenerate, reason: f.canGenerate ? null : generate };
  return {
    approve: { show: f.editable && !approved, disabled: approveDisabled, reason: approveReason, pending: f.approving },
    approved,
    change, fresh, retry,
  };
}

/** Where the design stands (the status chip's state; its label is the words in the chosen language). */
export type DesignState = "making" | "incomplete" | "unavailable" | "preparing" | "stale" | "preview" | "approved" | "review";

/** The status chip: the panel's existing wording, with a tone per state. */
export function designStatus(f: Pick<DesignFacts, "busy" | "incomplete" | "unavailable" | "hasPrototype" | "current" | "hasPreview" | "confirmed">): { state: DesignState; label: string; tone: ChipTone } {
  if (f.busy) return { state: "making", label: t("analysis.design.status.designing", "Designing"), tone: "ai" };
  if (f.incomplete) return { state: "incomplete", label: t("analysis.design.status.previewIncomplete", "Preview incomplete"), tone: "warning" };
  if (f.unavailable) return { state: "unavailable", label: t("analysis.design.status.unavailable", "Design unavailable"), tone: "danger" };
  if (!f.hasPrototype) return { state: "preparing", label: t("analysis.design.status.preparing", "Preparing design"), tone: "neutral" };
  if (!f.current) return { state: "stale", label: t("analysis.design.status.newRevision", "Needs a new revision"), tone: "warning" };
  if (!f.hasPreview) return { state: "preview", label: t("analysis.design.status.preparingPreview", "Preparing live preview"), tone: "neutral" };
  return f.confirmed
    ? { state: "approved", label: t("analysis.design.status.approved", "Approved"), tone: "success" }
    : { state: "review", label: t("analysis.design.status.readyForReview", "Ready for review"), tone: "accent" };
}
