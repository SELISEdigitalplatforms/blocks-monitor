import type { RawGateway, Row } from "../../../functions/_lib/gateway";
import { f } from "../../../functions/_lib/filter";
import { capKey } from "../../../functions/_lib/ids";
import { normaliseEmailAddress } from "../../../src/domain/notificationEmail";
import { plainFailureMessage } from "../../../src/domain/jobMessage";

const text = (v: unknown): string => typeof v === "string" ? v : "";
export const BUILD_FAILURE_KINDS = ["build.run", "change.build"];

/** Project readers who still have active workspace access, including the owner. */
export function buildFailureRecipients(project: Row, members: Row[]): string[] {
  const readers = new Set(Array.isArray(project.ReaderIds) ? project.ReaderIds : []);
  return [...new Set(members.filter(m => m.WorkspaceId === project.WorkspaceId && m.Status === "active"
    && readers.has(m.UserId)).map(m => text(m.UserId)).filter(Boolean))];
}

export interface BuildFailureNotifierOptions {
  /** The engine log: an alert written without its e-mail because the address could not be read. */
  log?: (line: string) => void;
}

/** Every recipient gets the in-app alert (the bell); the e-mail goes with it when the recipient's address can be read
 *  (EmailStatus "pending" + emailTo: the doorbell workflow sends it). When it cannot (the IAM lookup is refused or
 *  fails, the user has no usable address, or another recipient has the same address) the alert is written in-app only
 *  (EmailStatus "none", no emailTo): an unreadable address never holds the alert back. Inserts are idempotent
 *  (RequestKey per event and recipient), and a failure whose alerts are all written is settled: this notifier does not
 *  read it again (the worker's reconciliation passes it every minute). Only a failed read or insert is thrown, so the
 *  next pass writes what is missing. */
export function createBuildFailureNotifier(raw: RawGateway, emailOf: (id: string) => Promise<string | null>, o: BuildFailureNotifierOptions = {}) {
  const settled = new Set<string>();
  return async (job: Row): Promise<void> => {
    if (job.Status !== "failed" || !BUILD_FAILURE_KINDS.includes(text(job.Kind))) return;
    // FinishedAt distinguishes capacity-refunded retries whose Attempts value stays the same.
    const eventKey = `build-failed:${text(job.ItemId)}:${text(job.FinishedAt) || String(job.Attempts)}`;
    if (settled.has(eventKey)) return;
    const project = await raw.get("Project", text(job.ProjectId), ["ItemId", "WorkspaceId", "Name", "ReaderIds", "Status"]);
    if (!project || project.Status !== "active") {
      settled.add(eventKey);
      return;
    }
    const members = await raw.findAll("Membership", {
      where: f.and(f.eq("WorkspaceId", text(project.WorkspaceId)), f.eq("Status", "active")),
      fields: ["UserId", "WorkspaceId", "Status"],
    });
    const existing = await raw.findAll("Notification", { where: f.eq("EventKey", eventKey), fields: ["RecipientUserId"] });
    const done = new Set(existing.map(r => r.RecipientUserId));
    const emails = new Set<string>();
    let unread = 0;
    let why = "";
    for (const id of buildFailureRecipients(project, members)) {
      if (done.has(id)) continue;
      let address: string | null = null;
      try {
        address = normaliseEmailAddress(await emailOf(id));
      } catch (e) {
        unread += 1;
        why ||= e instanceof Error ? e.message.replace(/\s+/g, " ").slice(0, 120) : "error";
      }
      const emailTo = address && !emails.has(address) ? address : null;
      if (emailTo) emails.add(emailTo);
      await raw.insert("Notification", {
        RecipientUserId: id, WorkspaceId: project.WorkspaceId, ProjectId: job.ProjectId,
        EventKey: eventKey, Kind: "job.failed", IsRead: false, EmailStatus: emailTo ? "pending" : "none",
        Link: `/p/${encodeURIComponent(text(job.ProjectId))}/build`,
        ParamsJson: JSON.stringify({ projectId: job.ProjectId, projectName: project.Name, workspaceId: project.WorkspaceId,
          jobKind: job.Kind, failure: plainFailureMessage(text(job.Kind), text(job.Message)), failedAt: job.FinishedAt,
          ...(emailTo ? { emailTo, emailTemplate: "mf-build-failed" } : {}) }),
        CreatedByUserId: id, UpdatedByUserId: id,
        RequestKey: capKey(`notify:${eventKey}:${id}`),
      });
    }
    if (unread > 0) {
      o.log?.(`[engine] build failure alert ${text(job.ItemId).slice(0, 8)}: in-app only for ${unread} ${unread === 1 ? "person" : "people"}; the e-mail address could not be read (${why})`);
    }
    settled.add(eventKey);
  };
}
