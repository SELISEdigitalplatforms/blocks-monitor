// Runs an action an agent offered in the team chat (src/domain/chatActions.ts), as the person who taps it, through the
// real ops and with their permission. Each step has its own requestId, so Retry repeats only the step that failed and
// nothing is stored twice:
//   change-request  collab agentChat.act (the change request, with the conversation)  -> delivery cr.submit (sent for
//                   analysis; if that fails the request stays a saved draft)        -> collab agentChat.recordAction
//   preview-fix     delivery milestone.feedback (a fix ticket of the milestone)       -> collab agentChat.recordAction
//   update-design / add-to-scope
//                   project scope.feedback.add (the person's comment on the item)     -> collab agentChat.recordAction
//   parallel-streams
//                   delivery cr.parallelStreams (the number; never above the tech lead's suggestion)
//                                                                                     -> collab agentChat.recordAction
//   continue-increments
//                   delivery cr.continueIncrements (on or off)                       -> collab agentChat.recordAction
import { useCallback, useSyncExternalStore } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { callFunction, newRequestId, type FunctionResult } from "../fn";
import { blocksKeys } from "../data/keys";
import { useDeliveryContext } from "../delivery/context";
import { continueKey, streamsKey } from "../delivery/actions";
import { mergeChatRows } from "./chat";
import { collabErrorMessage } from "./messages";
import type { AgentChatOffer } from "./records";
import type { ChatRole } from "../../domain/agentChat";
import { continueResultId, streamsResultId } from "../../domain/chatActions";
import { parseContinueSetting } from "../../domain/continueIncrements";
import { parseStreamsChoice } from "../../domain/parallelStreams";
import { t } from "@/i18n";

type Caller = <T>(fn: "collab" | "delivery" | "project", op: string, args: Record<string, unknown>, opts?: { requestId?: string }) => Promise<FunctionResult<T>>;

export type ActionStep = "run" | "submit" | "record";
export type ActionState =
  | { phase: "idle" }
  | { phase: "working"; step: ActionStep }
  | { phase: "done"; submitted: boolean }
  | { phase: "failed"; step: ActionStep; message: string };

export const ACTION_STEP_LABEL: Record<ActionStep, string> = {
  get run() { return t("build.chat.actionStep.run", "Working on it…"); },
  get submit() { return t("build.chat.actionStep.submit", "Sending it for analysis…"); },
  get record() { return t("build.chat.actionStep.record", "Saving it in the chat…"); },
};

export interface ActionFlowDeps {
  call: Caller;
  newId: () => string;
  onState: (s: ActionState) => void;
  onRows?: (rows: unknown[]) => void;
  onChanged?: () => void;
}

export interface ActionInput { projectId: string; agentRole: ChatRole; offerId: string; offer: AgentChatOffer }

const idOf = (v: unknown, key: string): string => {
  const x = v && typeof v === "object" ? (v as Record<string, unknown>)[key] : undefined;
  return typeof x === "string" ? x : "";
};

/** The steps of one offer; each keeps its requestId for its Retry. */
export function createActionFlow(deps: ActionFlowDeps, input: ActionInput) {
  const ids: Record<ActionStep, string> = { run: deps.newId(), submit: deps.newId(), record: deps.newId() };
  const commentKey = deps.newId();
  let resultId = input.offer.takenId;
  let submitted: boolean | null = null;
  let running = false;
  let finished = false;
  const { projectId, agentRole, offerId, offer } = input;

  async function step<T>(name: ActionStep, run: () => Promise<T>): Promise<T | null> {
    deps.onState({ phase: "working", step: name });
    try {
      return await run();
    } catch (e) {
      deps.onState({ phase: "failed", step: name, message: collabErrorMessage(e) });
      deps.onChanged?.();
      return null;
    }
  }

  async function go(): Promise<boolean> {
    if (running || finished) return finished;
    running = true;
    try {
      if (!resultId) {
        const made = await step("run", async () => {
          if (offer.kind === "change-request") {
            const r = await deps.call<Record<string, unknown>>("collab", "agentChat.act", { projectId, agentRole, offerId }, { requestId: ids.run });
            return idOf(r.data, "changeRequestId");
          }
          if (offer.kind === "parallel-streams") {
            const r = await deps.call<Record<string, unknown>>("delivery", "cr.parallelStreams", { projectId, chosen: Number(offer.targetId) }, { requestId: ids.run });
            const c = parseStreamsChoice((r.data as Record<string, unknown> | null)?.streams ?? null);
            return c ? streamsResultId(c.chosen, c.at) : "";
          }
          if (offer.kind === "continue-increments") {
            const r = await deps.call<Record<string, unknown>>("delivery", "cr.continueIncrements", { projectId, on: offer.targetId === "on" }, { requestId: ids.run });
            const c = parseContinueSetting((r.data as Record<string, unknown> | null)?.continueIncrements ?? null);
            return c ? continueResultId(c.on, c.at) : "";
          }
          if (offer.kind === "preview-fix") {
            const r = await deps.call<Record<string, unknown>>("delivery", "milestone.feedback", { projectId, milestoneId: offer.targetId, text: offer.details }, { requestId: ids.run });
            return idOf(r.data, "ticketId");
          }
          const r = await deps.call<Record<string, unknown>>("project", "scope.feedback.add", {
            projectId, target: { type: offer.targetType || (offer.kind === "update-design" ? "screen" : "feature"), id: offer.targetId },
            commentKey, text: offer.details, attachmentIds: [],
          }, { requestId: ids.run });
          return idOf((r.data as Record<string, unknown>)?.comment, "ItemId");
        });
        if (!made) {
          if (made === "") deps.onState({ phase: "failed", step: "run", message: collabErrorMessage(new Error("unknown")) });
          return false;
        }
        resultId = made;
        deps.onChanged?.();
      }
      if (offer.kind === "change-request" && submitted === null) {
        // a change request goes to the business analyst for analysis; a refusal leaves it a saved draft (said so in the chat)
        deps.onState({ phase: "working", step: "submit" });
        try {
          await deps.call("delivery", "cr.submit", { projectId, changeRequestId: resultId }, { requestId: ids.submit });
          submitted = true;
        } catch {
          submitted = false;
        }
      }
      const recorded = await step("record", async () => {
        const r = await deps.call<{ message?: unknown }>("collab", "agentChat.recordAction", { projectId, agentRole, offerId, resultId }, { requestId: ids.record });
        deps.onRows?.(r.data.message ? [r.data.message] : []);
        return true;
      });
      if (!recorded) return false;
      finished = true;
      deps.onState({ phase: "done", submitted: submitted === true });
      deps.onChanged?.();
      return true;
    } finally {
      running = false;
    }
  }

  return { run: go };
}

interface Entry { flow: ReturnType<typeof createActionFlow> | null; state: ActionState; listeners: Set<() => void> }
const entries = new Map<string, Entry>();
const IDLE: ActionState = { phase: "idle" };

function entryOf(key: string): Entry {
  let e = entries.get(key);
  if (!e) {
    e = { flow: null, state: IDLE, listeners: new Set() };
    entries.set(key, e);
  }
  return e;
}

/** The state of one offer's action and the tap that runs it (Retry is the same tap). One flow per offer, so a remount
 *  never starts it twice. */
export function useChatAction(projectId: string, agentRole: ChatRole, offerId: string, offer: AgentChatOffer) {
  const client = useQueryClient();
  const ctx = useDeliveryContext(projectId);
  const workspaceId = ctx.workspaceId;
  const entry = entryOf(`${projectId}:${offerId}`);
  const subscribe = useCallback((l: () => void) => { entry.listeners.add(l); return () => { entry.listeners.delete(l); }; }, [entry]);
  const state = useSyncExternalStore(subscribe, () => entry.state, () => IDLE);

  const run = useCallback(() => {
    if (!entry.flow) {
      const set = (s: ActionState) => { entry.state = s; entry.listeners.forEach((l) => l()); };
      entry.flow = createActionFlow({
        call: callFunction as unknown as Caller,
        newId: newRequestId,
        onState: set,
        onRows: (rows) => { if (workspaceId) mergeChatRows(client, workspaceId, rows); },
        onChanged: () => {
          if (!workspaceId) return;
          for (const schema of ["AgentChatMessage", "ChangeRequest", "EngineJob", "Ticket", "TicketEvent", "FeedbackThread", "FeedbackComment", "Attachment"]) {
            void client.invalidateQueries({ queryKey: blocksKeys.schema(workspaceId, schema) });
          }
          if (offer.kind === "parallel-streams") void client.invalidateQueries({ queryKey: streamsKey(projectId) });
          if (offer.kind === "continue-increments") void client.invalidateQueries({ queryKey: continueKey(projectId) });
        },
      }, { projectId, agentRole, offerId, offer });
    }
    return entry.flow.run();
  }, [entry, client, workspaceId, projectId, agentRole, offerId, offer]);

  return { state, run, can: ctx.can };
}
