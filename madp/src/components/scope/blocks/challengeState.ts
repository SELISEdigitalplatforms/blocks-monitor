/** What really happened to an accepted second-opinion point, read from the stored records (pure).
 *  - A fix that moves work between milestones is applied by the business analyst on accept (scope.challenge.decide
 *    queues milestones.suggest with the fix as its note): its state is that job's state.
 *  - Any other fix is put in the scope by the person ("Put it in the scope"): it counts as in the scope once its feature
 *    or story was changed after the decision, or, for a new feature, once a feature with that text exists. */
import type { EngineJob } from "@/blocks/engine/types";

export type AcceptedState =
  | { kind: "replanning" }
  | { kind: "replanned"; at: string | null }
  | { kind: "replan-failed" }
  | { kind: "edit-milestones" }
  | { kind: "in-scope"; at: string | null }
  | { kind: "not-yet" };

export interface AcceptedPoint {
  status: string;
  question: string;
  suggestedFix: string;
  finalText: string;
  decidedAt: string | null;
  target: { type: "feature" | "story"; id: string } | null;
}

interface Changed { id: string; key: string; updatedAt: string }
interface FeatureLike extends Changed { description: string; name: string }

/** The same rule the decide op uses to queue the re-plan: a fix that names a milestone. */
export function movesMilestones(fix: string): boolean {
  return /\bmilestones?\b/i.test(fix);
}

const noteOf = (job: EngineJob): string => {
  try {
    const input = JSON.parse(job.inputJson ?? "{}") as { note?: unknown };
    return typeof input.note === "string" ? input.note : "";
  } catch {
    return "";
  }
};
const flat = (s: string) => s.replace(/\s+/g, " ").trim();
const time = (s: string | null | undefined) => (s ? Date.parse(s) : NaN);
/** Clock skew between the browser, the function and the worker. */
const SKEW_MS = 2 * 60_000;

/** The re-plan job this accepted fix queued: a milestones.suggest job whose note is this fix (it may be cut with "…"). */
export function replanJobOf(fix: string, decidedAt: string | null, jobs: readonly EngineJob[]): EngineJob | null {
  const text = flat(fix);
  if (!text) return null;
  const decided = time(decidedAt);
  const matches = jobs.filter((j) => {
    if (j.kind !== "milestones.suggest") return false;
    const note = flat(noteOf(j)).replace(/…$/, "").trim();
    if (!note || !text.startsWith(note)) return false;
    const made = time(j.createdAt);
    return !Number.isFinite(decided) || !Number.isFinite(made) || made >= decided - SKEW_MS;
  });
  return matches.sort((a, b) => (time(b.createdAt) || 0) - (time(a.createdAt) || 0))[0] ?? null;
}

export function acceptedState(point: AcceptedPoint, jobs: readonly EngineJob[], features: readonly FeatureLike[], stories: readonly Changed[]): AcceptedState | null {
  if (point.status !== "accepted") return null;
  const fix = point.finalText || point.suggestedFix;
  const job = replanJobOf(fix, point.decidedAt, jobs);
  if (job) {
    if (job.status === "succeeded") return { kind: "replanned", at: job.finishedAt ?? job.updatedAt };
    if (job.status === "failed" || job.status === "cancelled") return { kind: "replan-failed" };
    return { kind: "replanning" };
  }
  if (movesMilestones(fix)) return { kind: "edit-milestones" };
  const decided = time(point.decidedAt);
  const after = (r: Changed) => Number.isFinite(decided) && time(r.updatedAt) > decided;
  const t = point.target;
  if (t) {
    const list: readonly Changed[] = t.type === "feature" ? features : stories;
    const row = list.find((r) => r.id === t.id || r.key === t.id);
    return row && after(row) ? { kind: "in-scope", at: row.updatedAt } : { kind: "not-yet" };
  }
  const head = flat(fix).slice(0, 60).toLowerCase();
  const added = features.find((f) => after(f) && head !== "" && flat(`${f.name} ${f.description}`).toLowerCase().includes(head));
  return added ? { kind: "in-scope", at: added.updatedAt } : { kind: "not-yet" };
}
