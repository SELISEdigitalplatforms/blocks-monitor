import { useState } from "react";
import { Check, GitBranch, History, KanbanSquare, MessageSquare, RotateCcw } from "lucide-react";
import { Button } from "@/ui/kit";
import { ACTION_PERMISSION } from "@/domain/chatActions";
import { ACTION_BUTTON_TEXT as ACTION_BUTTON } from "@/components/engine/jobWords";
import type { AgentChatOffer } from "@/blocks/collab/records";
import { ACTION_STEP_LABEL, useChatAction } from "@/blocks/collab/chatActions";
import type { ChatRole } from "./types";
import { t, useT } from "@/i18n";

const ICON = { size: 16, strokeWidth: 1.75, "aria-hidden": true } as const;

const HEAD: Record<AgentChatOffer["kind"], () => string> = {
  "change-request": () => t("studio.office.offer.changeRequest", "Change request"),
  "preview-fix": () => t("studio.office.offer.previewFix", "Feedback on the preview"),
  "update-design": () => t("studio.office.offer.updateDesign", "Comment on the screen"),
  "add-to-scope": () => t("studio.office.offer.addToScope", "Comment on the scope"),
  "parallel-streams": () => t("studio.office.offer.parallelStreams", "Parallel streams"),
  "continue-increments": () => t("studio.office.offer.continueIncrements", "Next increments"),
};

/** What the agent offers to do, under its answer: what will be sent, and the one button that does it as you. */
export function ChatActionCard({ projectId, role, offerId, offer }: { projectId: string; role: ChatRole; offerId: string; offer: AgentChatOffer }) {
  useT();
  const { state, run, can } = useChatAction(projectId, role, offerId, offer);
  const [open, setOpen] = useState(false);
  const allowed = ACTION_PERMISSION[offer.kind].every((p) => can(p as Parameters<typeof can>[0]));
  const taken = Boolean(offer.takenId) && state.phase !== "working" && state.phase !== "failed";
  const working = state.phase === "working";
  const long = offer.details.length > 220;
  const icon = offer.kind === "change-request" ? <History {...ICON} /> : offer.kind === "preview-fix" ? <KanbanSquare {...ICON} />
    : offer.kind === "parallel-streams" || offer.kind === "continue-increments" ? <GitBranch {...ICON} /> : <MessageSquare {...ICON} />;

  return (
    <div className="max-w-[92%] rounded-block bg-surface2 p-3 ring-1 ring-line" data-chat-offer={offer.kind}>
      <div className="flex items-center gap-2 text-[13px] font-medium text-ink">
        <span className="text-accent">{icon}</span>{HEAD[offer.kind]()}
      </div>
      <p className="mt-1 text-[13px] font-medium text-ink [overflow-wrap:anywhere]">{offer.title}</p>
      <p className={`mt-0.5 whitespace-pre-wrap text-[12.5px] leading-snug text-ink2 [overflow-wrap:anywhere] ${long && !open ? "line-clamp-4" : ""}`}>{offer.details}</p>
      {long && (
        <button type="button" className="mt-1 text-[12px] font-medium text-accent underline-offset-2 hover:underline" onClick={() => setOpen((v) => !v)}>
          {open ? t("studio.office.offer.showLess", "Show less") : t("studio.office.offer.showAll", "Show all")}
        </button>
      )}
      {taken || state.phase === "done" ? (
        <p role="status" className="mt-2 flex items-center gap-1.5 text-[12.5px] text-[rgb(var(--c-success-text))]">
          <Check size={14} strokeWidth={2} aria-hidden />{offer.takenCode && offer.takenCode !== "Comment"
            ? t("studio.office.offer.doneWithCode", "Done: {code}", { code: offer.takenCode })
            : t("studio.office.offer.done", "Done")}
        </p>
      ) : (
        <div className="mt-2.5 flex flex-wrap items-center gap-2">
          <Button size="sm" variant={state.phase === "failed" ? "ghost" : "primary"} disabled={!allowed || working}
            icon={state.phase === "failed" ? <RotateCcw size={14} strokeWidth={1.75} aria-hidden /> : undefined}
            onClick={() => void run()}>
            {working ? ACTION_STEP_LABEL[state.step] : state.phase === "failed" ? t("studio.office.offer.tryAgain", "Try again") : ACTION_BUTTON[offer.kind]}
          </Button>
          {!allowed && <span className="text-[12px] text-ink3">{t("studio.office.offer.notAllowed", "Your role can't do this; the project team can.")}</span>}
        </div>
      )}
      {state.phase === "failed" && <p role="alert" className="mt-1.5 text-[12.5px] text-danger [overflow-wrap:anywhere]">{state.message}</p>}
    </div>
  );
}
