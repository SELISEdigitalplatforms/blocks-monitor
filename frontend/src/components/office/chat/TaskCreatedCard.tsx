import { GitBranch, History, KanbanSquare, Lightbulb, MessageSquare } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/ui/kit";
import { JOURNEY_SLUG, STEP_LABEL, buildTabPath } from "@/domain/journey";
import { stepPath } from "@/domain/phases";
import { stepPathWith } from "@/components/scope/links";
import { searchWithTab } from "@/components/requirements/requirementsTab";
import type { AgentChatTask } from "@/blocks/collab/records";
import { useT } from "@/i18n";

const ICON = { size: 16, strokeWidth: 1.75, "aria-hidden": true } as const;

/** The change request view for a change request code (CR-001 → ?cr=1), which shows the request and when it can be built. */
export function taskChangeLink(projectId: string, code: string): string {
  return `/p/${projectId}/${JOURNEY_SLUG.build}?cr=${Number(code.replace(/\D/g, ""))}`;
}

/** The Build → Board link for a board task: the ticket's ItemId from the card's data or the server link (/p/:id/board?ticket=<ItemId>), else the board alone. */
export function boardTaskPath(projectId: string, task: { id?: string; link?: string } = {}): string {
  const fromLink = task.link ? new URLSearchParams(task.link.split("?")[1] ?? "").get("ticket") : null;
  return buildTabPath(projectId, "board", task.id || fromLink || null);
}

/** What a conversation created, inside the bubble, with the way to open it. */
export function TaskCreatedCard({ task, projectId }: { task: Pick<AgentChatTask, "target" | "code" | "title"> & { id?: string; link?: string; text?: string }; projectId: string }) {
  const navigate = useNavigate();
  const t = useT();

  const fromOffer = task.text !== undefined;
  const spec = task.target === "change-request"
    ? {
      icon: <History {...ICON} />, head: t("studio.office.task.changeRequestHead", "Change request {code}", { code: task.code }),
      // a tapped offer says itself whether it went to analysis; a chat task is saved as a draft
      note: fromOffer ? task.text! : t("studio.office.task.changeRequestNote", "It is saved as a draft. Open it to see when it can be built."),
      action: t("studio.office.task.openChangeRequest", "Open the change request"), run: () => navigate(taskChangeLink(projectId, task.code)),
    }
    : task.target === "ticket" || task.target === "preview-fix"
      ? {
        icon: <KanbanSquare {...ICON} />, head: task.target === "preview-fix" ? t("studio.office.task.previewFeedbackHead", "Preview feedback {code}", { code: task.code }) : t("studio.office.task.boardTaskHead", "Board task"),
        note: task.target === "preview-fix" ? t("studio.office.task.previewFeedbackNote", "It is on the board for the development team.") : t("studio.office.task.boardTaskNote", "It is on the board."),
        action: t("studio.office.task.openBoard", "Open the board"), run: () => navigate(boardTaskPath(projectId, task)),
      }
      : task.target === "streams-setting" || task.target === "continue-setting"
        ? {
          icon: <GitBranch {...ICON} />, head: task.target === "streams-setting" ? t("studio.office.task.parallelStreamsHead", "Parallel streams") : t("studio.office.task.nextIncrementsHead", "Next increments"),
          note: task.text ?? t("studio.office.task.saved", "Saved."), action: t("studio.office.task.openBuildQueue", "Open the build queue"), run: () => navigate(`/p/${projectId}/${JOURNEY_SLUG.build}?tab=queue`),
        }
      : task.target === "screen-comment" || task.target === "scope-comment"
        ? {
          icon: <MessageSquare {...ICON} />, head: task.target === "screen-comment" ? t("studio.office.task.screenCommentHead", "Comment on the screen") : t("studio.office.task.scopeCommentHead", "Comment on the scope"),
          // Scope & success is a section of the Business Analysis page
          note: task.text ?? t("studio.office.task.commentPosted", "Your comment is posted."), action: t("studio.office.task.openStep", "Open {step}", { step: STEP_LABEL.scope }),
          run: () => navigate(stepPath(projectId, "scope")),
        }
        : { icon: <Lightbulb {...ICON} />, head: t("studio.office.task.suggestionHead", "Requirement suggestion"), note: t("studio.office.task.suggestionNote", "It is waiting in MADP suggestions."), action: t("studio.office.task.openSuggestions", "Open the suggestions"), run: () => navigate(stepPathWith(projectId, "requirements", searchWithTab("", "suggestions"))) };

  return (
    <div className="rounded-block bg-surface2 p-3 ring-1 ring-line">
      <div className="flex items-center gap-2 text-[13px] font-medium text-ink">
        <span className="text-accent">{spec.icon}</span>{spec.head}
      </div>
      <p className="mt-1 text-[13px] text-ink">{task.title}</p>
      <p className="mt-0.5 text-[12px] text-ink2">{spec.note}</p>
      <Button size="sm" variant="ghost" className="mt-2.5 !bg-surface hover:!bg-line" onClick={spec.run}>{spec.action}</Button>
    </div>
  );
}
