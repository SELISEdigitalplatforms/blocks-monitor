/** The reads behind the team: the same Data Gateway hooks the change request and Build pages use (shared cache keys, so
 *  the launcher adds no reads a project page doesn't already make). The panel adds the board and its moves (to name a
 *  feature's builds) and the tech lead's questions. */
import { useMemo } from "react";
import { t, useCulture } from "@/i18n";
import { useDeliveryContext, type DeliveryContext } from "@/blocks/delivery/context";
import {
  useApprovalPolicies, useChangeRequests, useDeliveryJobs, useMilestones, usePreviews, useProjectTicketEvents, useReleases, useTickets,
} from "@/blocks/delivery/hooks";
import { useAgentChat, useChatReplyJobs } from "@/blocks/collab/chat";
import type { EngineJob } from "@/blocks/engine/types";
import type { DeliveryChangeRequest } from "@/blocks/delivery/types";
import { changeRightFor } from "@/components/changes/changeDecide";
import { changeBuildScope } from "@/components/build/model";
import { analystThread, leadThread, type LeadChatRow, type TeamThread } from "./teamMessages";
import { changeWaitJobOf, changesWaiting, type ChangeWait } from "./changeWaiting";

/** The tech lead's thread in the agent chat: the technical role of the existing chat (agentChat.send, chat.reply). */
export const LEAD_CHAT_ROLE = "dev" as const;

const NONE: never[] = [];

export interface TeamData {
  ctx: DeliveryContext;
  changes: DeliveryChangeRequest[];
  analyst: TeamThread;
  lead: TeamThread;
  jobs: EngineJob[];
  /** chat.reply jobs (the answers to technical questions) */
  replyJobs: EngineJob[];
  hasDev: boolean;
  canRun: boolean;
  canAsk: boolean;
  /** the first read of the threads is still on its way: an empty thread is not "no builds yet" */
  loading: boolean;
  /** a read failed: the thread may be incomplete */
  error: string | null;
}

/** What both the launcher and the panel read: change requests, delivery jobs, releases, approval policies. */
function useBase(projectId: string) {
  const ctx = useDeliveryContext(projectId);
  const changeList = useChangeRequests(ctx);
  const changes = changeList.data;
  const { jobs, isLoading: jobsLoading, error: jobsError } = useDeliveryJobs(ctx);
  const releases = useReleases(ctx).data;
  const policies = useApprovalPolicies(ctx).data;
  const hasDev = releases.some((r) => r.environment === "dev");
  const canRun = ctx.can("build.run");
  const canAsk = ctx.can("comment");
  const rightOf = useMemo(() => {
    const cache = new Map<string, ReturnType<typeof changeRightFor>>();
    return (cr: { id: string; createdByUserId: string | null }) => {
      let r = cache.get(cr.id);
      if (!r) {
        r = changeRightFor({ userId: ctx.userId, requesterId: cr.createdByUserId, policies, activeMemberIds: ctx.activeMemberIds, canApprove: ctx.can("release.approve") });
        cache.set(cr.id, r);
      }
      return r;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ctx.userId, ctx.activeMemberIds, ctx.permissions, policies]);
  const loading = ctx.status === "loading" || changeList.isLoading || jobsLoading;
  const error = ctx.status === "error" ? ctx.error ?? t("team.data.projectUnread", "The project could not be read.") : changeList.error ?? jobsError;
  return { ctx, changes, jobs, hasDev, canRun, canAsk, rightOf, loading, error };
}

function chatRows(rows: readonly { id: string; role: "user" | "agent"; kind: "text" | "task-created"; text: string; authorUserId: string; engineJobId: string; at: string; task: { target: string; code: string; title: string } | null }[]): LeadChatRow[] {
  return rows.map((r) => ({ id: r.id, role: r.role, kind: r.kind, text: r.text, authorUserId: r.authorUserId, engineJobId: r.engineJobId, at: r.at, task: r.task }));
}

/** The launcher's light read: the dots only (the names of builds come with the panel). `withChat`: the questions too
 *  (once the panel was opened in this session). */
export function useTeamSummary(projectId: string, withChat: boolean): { analyst: TeamThread; lead: TeamThread } {
  const b = useBase(projectId);
  const chat = useAgentChat(withChat ? projectId : null, LEAD_CHAT_ROLE).messages;
  // the threads are worded in the current language: a switch words them again
  const culture = useCulture();
  return useMemo(() => {
    const nameOf = b.ctx.memberName;
    return {
      analyst: analystThread({ projectId, changes: b.changes, jobs: b.jobs, meId: b.ctx.userId, nameOf, rightOf: b.rightOf, canRun: b.canRun, hasDev: b.hasDev }),
      lead: leadThread({ projectId, changes: b.changes, jobs: b.jobs, milestones: NONE, previews: NONE, chat: chatRows(chat), meId: b.ctx.userId, nameOf, canRun: b.canRun }),
    };
  }, [projectId, b.changes, b.jobs, b.ctx.userId, b.ctx.memberName, b.rightOf, b.canRun, b.hasDev, chat, culture]);
}

/** What the project's change requests wait for from the signed-in person: the Team panel's own rule on its own reads
 *  (no read of its own), for "Next for you" and other places that name it. `loading` until the reads have answered. */
export function useChangeWaits(projectId: string): { waits: ChangeWait[]; loading: boolean } {
  const b = useBase(projectId);
  return useMemo(() => ({
    loading: b.loading,
    waits: b.loading ? [] : changesWaiting({ changes: b.changes, jobs: b.jobs.map(changeWaitJobOf), canRun: b.canRun, rightOf: b.rightOf, now: Date.now() }),
  }), [b.loading, b.changes, b.jobs, b.canRun, b.rightOf]);
}

/** The panel's full read. */
export function useTeam(projectId: string): TeamData {
  const b = useBase(projectId);
  const milestones = useMilestones(b.ctx).data;
  const previews = usePreviews(b.ctx).data;
  const tickets = useTickets(b.ctx).data;
  const events = useProjectTicketEvents(b.ctx).data;
  const chatRead = useAgentChat(projectId, LEAD_CHAT_ROLE);
  const chat = chatRead.messages;
  const replyJobs = useChatReplyJobs(projectId);
  const culture = useCulture();
  return useMemo(() => {
    const nameOf = b.ctx.memberName;
    // the Build page's own naming of a change build (which increment of a feature it is for)
    const incrementOf = (job: EngineJob) => {
      const s = changeBuildScope({ job, changes: b.changes, tickets, events, jobs: b.jobs });
      return s?.change.increment ? { n: s.change.increment.n, of: s.change.increment.of } : null;
    };
    return {
      ctx: b.ctx,
      changes: b.changes,
      jobs: b.jobs,
      replyJobs,
      hasDev: b.hasDev,
      canRun: b.canRun,
      canAsk: b.canAsk,
      loading: b.loading || chatRead.isLoading,
      error: b.error ?? chatRead.error,
      analyst: analystThread({ projectId, changes: b.changes, jobs: b.jobs, tickets, meId: b.ctx.userId, nameOf, rightOf: b.rightOf, canRun: b.canRun, hasDev: b.hasDev }),
      lead: leadThread({
        projectId, changes: b.changes, jobs: b.jobs, milestones, previews, tickets, incrementOf, chat: chatRows(chat),
        meId: b.ctx.userId, nameOf, canRun: b.canRun, canAsk: b.canAsk,
      }),
    };
  }, [projectId, b.ctx, b.changes, b.jobs, b.hasDev, b.canRun, b.canAsk, b.rightOf, b.loading, b.error, chatRead.isLoading, chatRead.error, milestones, previews, tickets, events, chat, replyJobs, culture]);
}
