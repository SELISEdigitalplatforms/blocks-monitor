/** The line an item's feedback belongs to: the card floats beside it, and it is highlighted while its card is open. */
import type { HTMLAttributes } from "react";
import { cn } from "@/madp/lib/cn";
import { targetKey, type FeedbackTargetType } from "@/madp/data/feedback";
import { FEEDBACK_ITEM, FEEDBACK_OPEN, useIsFeedbackOpen } from "./feedbackUi";

type DataAttributes = { [k: `data-${string}`]: string | undefined };

export function FeedbackItem({ as: Tag = "div", type, id, className, ...rest }: HTMLAttributes<HTMLElement> & DataAttributes & {
  as?: "div" | "li" | "span"; type: FeedbackTargetType; id: string;
}) {
  const open = useIsFeedbackOpen(type, id);
  return <Tag {...rest} className={cn(className, FEEDBACK_ITEM, open && FEEDBACK_OPEN)} data-feedback-item={targetKey(type, id)} />;
}
