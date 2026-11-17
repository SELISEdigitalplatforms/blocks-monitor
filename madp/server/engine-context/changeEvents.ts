// The life of each change request as ledger events (engine-host/CHANGE-PROCESS-31.10.md), read from the records:
//
//   change.requested  people   the request left draft (cr.submit queued change.analyse; older requests: their first build)
//   change.analysed   engine   each analysis written (AnalysedAt): kind, route, planned tickets, open questions
//   change.answered   people   each answer in Analysis.questions (answeredBy / answeredAt)
//   change.approved   people   cr.decide (DecidedAt / DecidedByUserId), with selfApproved and the note
//   change.rejected   people
//   change.built      engine   each succeeded change.build of the request, with its commit and branch when the job
//                              that just finished knows them (hooks.ts after)
//   change.released   engine   each Release row that carries the request (dev, stage, production)
//
// Each event links its change request, the request's tickets and, when known, the commit. People's actions are "user"
// events like the other actions of people (userEvents.ts), the engine's are "change" events; both are recorded once, by
// a stable key, by the same recorder (userEvents.ts recordUserActions). Pure.
import type { Row } from "../../functions/_lib/gateway";
import type { ProjectView } from "../local/engine/context.ts";
import { parseChangeAnalysis } from "../../src/domain/changeAnalysis";
import type { UserAction } from "./userEvents.ts";

const str = (v: unknown): string => (typeof v === "string" ? v : "");
const num = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : 0);
const clip = (s: string, max: number): string => {
  const t = s.replace(/\s+/g, " ").trim();
  return t.length <= max ? t : `${t.slice(0, max - 1).replace(/\s+\S*$/, "")}…`;
};
const ISO = /^\d{4}-\d\d-\d\dT/;
const inputOf = (j: Row): Record<string, unknown> => {
  try {
    const v = typeof j.InputJson === "string" ? JSON.parse(j.InputJson) : j.InputJson;
    return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
  } catch {
    return {};
  }
};
const code = (cr: Row): string => (str(cr.Lane) === "fix" ? `FX-${num(cr.Number)}` : `CR-${String(num(cr.Number)).padStart(3, "0")}`);

/** Statuses after an approval (a failed build of an approved request keeps its tickets). */
const APPROVED_SINCE = new Set(["approved", "building", "released-dev", "promoted-stage", "promoted-production"]);

/** What the job that just finished knows about the build it made (hooks.ts buildOf). */
export interface ChangeBuildTrace {
  jobId: string;
  commit: string;
  branch: string;
  buildId: string;
  version: string;
}

/** The change requests' events the records show, oldest first. `current` is the change job finishing now (still
 *  running in the store): a change build counts as built, with its commit when `build` knows it. */
export function changeActionsOf(p: ProjectView, o: { current?: { jobId: string; at: string } | null; build?: ChangeBuildTrace | null } = {}): UserAction[] {
  const out: UserAction[] = [];
  const add = (a: UserAction) => {
    if (a.at && ISO.test(a.at)) out.push(a);
  };
  const jobs = p.rows("EngineJob");
  const tickets = p.tickets();
  for (const cr of p.changeRequests()) {
    const id = str(cr.ItemId);
    if (!id) continue;
    const ref = `ChangeRequest:${id}`;
    const status = str(cr.Status);
    const mine = (kind: string) =>
      jobs.filter((j) => j.Kind === kind && str(inputOf(j).changeRequestId) === id).sort((a, b) => str(a.CreatedDate).localeCompare(str(b.CreatedDate)));
    const analyses = mine("change.analyse");
    const builds = mine("change.build");
    const ticketRefs = tickets.filter((t) => t.ChangeRequestId === id).map((t) => `Ticket:${str(t.ItemId)}`);
    const base = { changeRequest: code(cr), title: clip(str(cr.Title), 160), lane: str(cr.Lane), tickets: ticketRefs };

    // requested: the first analysis queued (cr.submit), else the first build (requests from before the analysis)
    if (status !== "draft") {
      const first = analyses.find((j) => inputOf(j).refine !== true) ?? builds[0];
      add({
        key: `change.requested:${id}`, action: "change.requested", ref, type: "user",
        by: (first && str(first.RequestedByUserId)) || str(cr.RequestedByUserId) || str(cr.CreatedByUserId),
        at: (first && str(first.CreatedDate)) || str(cr.CreatedDate),
        detail: base,
      });
    }

    const a = parseChangeAnalysis(cr.Analysis);
    const analysedAt = str(cr.AnalysedAt);
    if (a && analysedAt) {
      // the analysis job that wrote it: the last one finished by then
      const job = [...analyses].reverse().find((j) => !str(j.FinishedAt) || str(j.FinishedAt) >= analysedAt) ?? analyses[analyses.length - 1];
      add({
        key: `change.analysed:${id}:${analysedAt}`, action: "change.analysed", ref, type: "change", by: "", at: analysedAt,
        detail: {
          ...base, ...(job ? { jobId: str(job.ItemId) } : {}),
          kind: a.kind, route: a.route, scopeChange: a.scopeChange, plannedTickets: a.tickets.length,
          openQuestions: a.questions.filter((q) => q.answer === null).length, acceptanceCriteria: a.acceptanceCriteria.length,
          ...(a.contextVersion !== null ? { analysedFromVersion: a.contextVersion } : {}),
        },
      });
      for (const q of a.questions) {
        if (q.answer === null || !q.answeredAt) continue;
        add({
          key: `change.answered:${id}:${q.id}:${q.answeredAt}`, action: "change.answered", ref, type: "user", by: q.answeredBy ?? "", at: q.answeredAt,
          detail: { ...base, question: clip(q.text, 200), answer: clip(q.answer, 300) },
        });
      }
    }

    const decidedAt = str(cr.DecidedAt);
    const decision = status === "rejected" ? "rejected" : APPROVED_SINCE.has(status) || (status === "failed" && ticketRefs.length > 0) ? "approved" : "";
    if (decidedAt && decision) {
      add({
        key: `change.decided:${id}:${decidedAt}`, action: `change.${decision}`, ref, type: "user", by: str(cr.DecidedByUserId), at: decidedAt,
        detail: {
          ...base, selfApproved: cr.SelfApproved === true, ...(str(cr.DecisionNote).trim() ? { note: clip(str(cr.DecisionNote), 300) } : {}),
          // a scope-route change the person decided to build now as a change (cr.decide route "fast")
          ...(decision === "approved" && parseChangeAnalysis(cr.Analysis)?.routeDecision ? { routeDecision: "build as a change" } : {}),
        },
      });
    }

    for (const j of builds) {
      const jobId = str(j.ItemId);
      const now = o.current?.jobId === jobId ? o.current : null;
      const at = str(j.FinishedAt) || now?.at || "";
      if ((j.Status !== "succeeded" && !now) || !at) continue;
      const b = o.build && o.build.jobId === jobId ? o.build : null;
      add({
        key: `change.built:${id}:${jobId}`, action: "change.built", ref, type: "change", by: "", at,
        detail: { ...base, jobId, ...(b ? { commit: b.commit, branch: b.branch, buildId: b.buildId, ...(b.version ? { version: b.version } : {}) } : { branch: `change/${id}` }) },
      });
    }

    for (const r of p.releases()) {
      const ids = Array.isArray(r.ChangeRequestIds) ? (r.ChangeRequestIds as unknown[]) : [];
      if (!ids.includes(id) || !str(r.ReleasedAt)) continue;
      add({
        key: `change.released:${id}:${str(r.ItemId)}`, action: "change.released", ref, type: "change", by: str(r.ReleasedByUserId), at: str(r.ReleasedAt),
        detail: { ...base, release: `Release:${str(r.ItemId)}`, environment: str(r.Environment), version: str(r.Version) },
      });
    }
  }
  return out.sort((x, y) => x.at.localeCompare(y.at) || x.key.localeCompare(y.key));
}
