/**
 * cr.decide: approves or rejects a change request waiting for approval (status review).
 * A change the analysis routes through Scope & success (a new feature or a clash with the locked scope) has two real
 * ways forward: approve it as it is (it waits on the Scope & success page for a new scope version), or approve it with
 * route "fast": the person decides to build it now as a change to what is there. That decision is stored in
 * Analysis.routeDecision (who, when), the planned tickets go on the board and the build can start. An approved
 * scope-route change may take that second way later too (approved -> approved, fast), so it never dead-ends.
 * The approver rule is the release approvals' (changeDecideRight over changeApproverIds): an approver of the
 * project's stage or production policy decides; the requester decides their own change only when no other eligible
 * approver exists, which is stored as SelfApproved and audited as a self-approval.
 * Approve (fast route, or a feature delivery on a product without a Factory scope: route "feature", every increment's
 * tickets at once) creates the planned change tickets from Analysis.tickets in Planned, linked the way
 * change.build links its tickets (ChangeRequestId, PlanRef cr:<id>:<k> or fx:<n>:<id>[:<k>], Source change-request
 * or fix), so change.build builds exactly those. A scope-route change is approved without tickets: it is planned
 * through a new scope version.
 */
import { defineDeliveryOp, enumArg, fail, failFromRule, idArg, strictArgs, stringArg } from "../common";
import type { OpContext } from "../common";
import type { ReadPorts, Row } from "../ports";
import { policyFromRows, readPolicyRows } from "../rows";
import {
  LIMITS,
  changeApproverIds,
  changeCode,
  changeDecideRight,
  checkChangeForDecision,
  checkComment,
} from "../../../../src/domain/delivery";
import {
  allQuestionsAnswered,
  parseChangeAnalysis,
  serializeChangeAnalysis,
  type ChangeAnalysis,
} from "../../../../src/domain/changeAnalysis";
import { insertWithNextNumber } from "../../../../src/domain/numbering";
import { plannedRoleOf } from "../../../../src/domain/ticketRole";
import { ownChange, text } from "./crShared";

type Args = { projectId: string; changeRequestId: string; decision: "approve" | "reject"; note: string; route: "fast" | null };

const readTopTicket = (ports: ReadPorts, projectId: string) =>
  ports.query("Ticket", { ProjectId: projectId }, { sort: [{ field: "Number", dir: "desc" }], limit: 1 });
const readChangeTickets = (ports: ReadPorts, projectId: string, changeRequestId: string) =>
  ports.query("Ticket", { ProjectId: projectId, ChangeRequestId: changeRequestId });

const read = (ports: ReadPorts, args: Args) =>
  Promise.all([
    ports.getById("ChangeRequest", args.changeRequestId),
    readPolicyRows(ports, args.projectId),
    readTopTicket(ports, args.projectId),
    readChangeTickets(ports, args.projectId, args.changeRequestId),
  ]);

const DESCRIPTION_MAX = 10000;
const clip = (s: string, max: number) => (s.length > max ? s.slice(0, max).trimEnd() : s);

/** The rows change.build would create for these planned tickets (same PlanRef, type, source and link). */
function plannedTicketRows(cr: Row, analysis: ChangeAnalysis): Record<string, unknown>[] {
  const crId = text(cr.ItemId);
  const lane = text(cr.Lane);
  const number = typeof cr.Number === "number" ? cr.Number : 1;
  const fix = lane === "fix";
  const code = changeCode({ lane, number });
  return analysis.tickets.map((t, k) => {
    const description = t.description || text(cr.Description);
    return {
      PlanRef: fix ? (k === 0 ? `fx:${number}:${crId}` : `fx:${number}:${crId}:${k}`) : `cr:${crId}:${k}`,
      Title: t.title,
      TicketType: fix || lane === "change" ? "fix" : "story",
      FeatureRef: text(cr.FeatureRef),
      StoryRef: "",
      MilestoneId: "",
      AgentRole: plannedRoleOf({ type: fix || lane === "change" ? "fix" : "story" }),
      Column: "planned",
      Acceptance: [...analysis.acceptanceCriteria],
      SortOrder: k,
      Description: clip(fix ? `${code} · ${description}` : description, DESCRIPTION_MAX),
      IsDone: false,
      Source: fix ? "fix" : "change-request",
      ChangeRequestId: crId,
      EngineJobId: "",
      DependsOn: [],
    };
  });
}

/**
 * Inserts the planned tickets with the next free numbers: all at once, then any that clashed on (ProjectId, Number)
 * one by one with a fresh top number. Stable RequestKeys make a retry return the same rows.
 */
async function insertTickets(ctx: OpContext, crId: string, rows: Record<string, unknown>[], top: number): Promise<string[]> {
  const key = (k: number) => `cr.decide:${crId}:ticket:${k}`;
  const insert = (row: Record<string, unknown>, k: number, n: number) =>
    ctx.ports.insert("Ticket", ctx.stamp({ ProjectId: ctx.projectId, Number: n, ...row }), { requestKey: key(k) });
  const first = await Promise.allSettled(rows.map((row, k) => insert(row, k, top + 1 + k)));
  const ids: string[] = [];
  for (let k = 0; k < rows.length; k++) {
    const r = first[k];
    if (r.status === "fulfilled") {
      ids.push(r.value.itemId);
      continue;
    }
    if (!ctx.ports.isDuplicateKey(r.reason)) throw r.reason;
    const again = await insertWithNextNumber({
      readMax: async () => {
        const t = await readTopTicket(ctx.ports, ctx.projectId);
        return typeof t[0]?.Number === "number" ? t[0].Number : 0;
      },
      insert: (n) => insert(rows[k], k, n),
      isDuplicateKey: ctx.ports.isDuplicateKey,
    });
    ids.push(again.value.itemId);
  }
  return ids;
}

export const crDecideOp = defineDeliveryOp({
  permission: "release.approve",
  overlap: true,
  validate(raw: unknown): Args {
    const a = strictArgs(raw, ["projectId", "changeRequestId", "decision", "note", "route"]);
    return {
      projectId: idArg(a.projectId, "projectId"),
      changeRequestId: idArg(a.changeRequestId, "changeRequestId"),
      decision: enumArg(a.decision, "decision", ["approve", "reject"] as const),
      note: a.note === undefined || a.note === null ? "" : stringArg(a.note, "note", LIMITS.approvalComment * 2),
      route: a.route === undefined || a.route === null || a.route === "" ? null : enumArg(a.route, "route", ["fast"] as const),
    };
  },
  prefetch: (ports: ReadPorts, args: Args) => read(ports, args),
  async handler(ctx, args: Args) {
    const note = args.note.trim();
    if (note) {
      const c = checkComment(note, LIMITS.approvalComment);
      if (!c.ok) return fail("invalid_input", "delivery.cr.noteTooLong", { field: "note" });
    }
    const { changeRequestId } = args;
    const [row, policies, top, existingTickets] = await read(ctx.ports, args);
    await ctx.authorized(); // the membership check ran alongside the reads
    const cr = ownChange(ctx, row);
    const stored = parseChangeAnalysis(cr.Analysis);
    // An approved change on the scope route may still be built as a change (the second way forward, never a dead end).
    const reroute = args.decision === "approve" && args.route === "fast" && text(cr.Status) === "approved" && stored?.route === "scope";
    // A repeat of that decision (a retry or a second click) answers with what is stored, once the right is checked.
    const repeat = args.decision === "approve" && args.route === "fast" && text(cr.Status) === "approved" && !!stored?.routeDecision;
    if (!reroute && !repeat) {
      const status = checkChangeForDecision({ status: text(cr.Status) });
      if (!status.ok) return failFromRule(status);
    }
    if (!stored) return fail("conflict", "delivery.cr.noAnalysis");
    if (!allQuestionsAnswered(stored)) return fail("conflict", "delivery.cr.openQuestions");
    if (args.route === "fast" && args.decision !== "approve") return fail("invalid_input", "delivery.args.invalid", { field: "route" });
    // The person's decision to build it in the fast lane: recorded in the analysis (who, when); the analysis keeps its words.
    const asChange = args.route === "fast" && stored.route === "scope";
    const analysis: ChangeAnalysis = asChange
      ? { ...stored, route: "fast", routeDecision: { route: "fast", by: ctx.caller.userId, at: ctx.now } }
      : stored;

    // The release approvers: every step of the project's stage and production policies.
    const steps = (["stage", "production"] as const).flatMap((env) => {
      const p = policyFromRows(env, policies.policyRows, policies.policyStepRows);
      return p.status === "ok" ? p.policy.steps : [];
    });
    const members = ctx.activeMemberIds;
    const approverIds = changeApproverIds(steps, members);
    const requesterId = text(cr.RequestedByUserId) || text(cr.CreatedByUserId) || null;
    const right = changeDecideRight(ctx.caller.userId, { requesterId, approverIds, activeMemberIds: members });
    if (!right.ok) {
      return right.reason === "ownRequest"
        ? fail("forbidden", "delivery.cr.ownRequest", { approvers: right.others.length })
        : fail("forbidden", "delivery.cr.notApprover");
    }
    if (repeat) {
      return { changeRequestId, status: "approved", selfApproved: cr.SelfApproved === true, route: "fast", ticketIds: existingTickets.map((t) => text(t.ItemId)) };
    }
    const approve = args.decision === "approve";
    const selfApproved = approve && right.self;
    const next = approve ? "approved" : "rejected";

    // Approve on a route that builds (fast, or a feature delivery): the planned tickets first, so a failure leaves the
    // change in review to retry.
    let ticketIds: string[] = [];
    let titles: string[] = [];
    if (approve && analysis.route !== "scope" && analysis.tickets.length > 0) {
      if (existingTickets.length > 0) {
        ticketIds = existingTickets.map((t) => text(t.ItemId));
      } else {
        const rows = plannedTicketRows(cr, analysis);
        const topNumber = typeof top[0]?.Number === "number" ? top[0].Number : 0;
        ticketIds = await insertTickets(ctx, changeRequestId, rows, topNumber);
        titles = rows.map((r) => String(r.Title));
      }
    }

    await ctx.after(() =>
      Promise.all([
        ctx.ports.update(
          "ChangeRequest",
          changeRequestId,
          ctx.touch({
            Status: next,
            DecidedAt: ctx.now,
            DecidedByUserId: ctx.caller.userId,
            DecisionNote: note || (reroute ? text(cr.DecisionNote) : ""),
            SelfApproved: selfApproved,
            ...(asChange ? { Analysis: serializeChangeAnalysis(analysis) } : {}),
          }),
        ),
        ...titles.map((title, k) =>
          ctx.ports.insert(
            "TicketEvent",
            ctx.stamp({
              ProjectId: ctx.projectId, TicketId: ticketIds[k], Kind: "move", FromColumn: "", ToColumn: "planned",
              AuthorUserId: "", AuthorLabel: "planner", Text: `Created in Planned: ${title}.`, At: ctx.now, IsAuto: true,
              EngineJobId: "",
            }),
            { requestKey: `cr.decide:${changeRequestId}:ticket:${k}:planned` },
          ),
        ),
        ctx.audit("cr.decide", "ChangeRequest", changeRequestId, {
          decision: args.decision,
          selfApproved,
          ...(selfApproved ? { reason: "only approver" } : {}),
          route: analysis.route,
          ...(asChange ? { routeDecision: "fast", from: reroute ? "approved" : "review" } : {}),
          tickets: ticketIds.length,
        }),
      ]),
    );
    return { changeRequestId, status: next, selfApproved, route: analysis.route, ticketIds };
  },
});
