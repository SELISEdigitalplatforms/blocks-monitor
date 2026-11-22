/**
 * milestones.save: the arrangement is one unit (design 8). A stale view writes nothing.
 * Depends only on the scope env contract (./ports, ./records, ./shared) and src/domain by relative path.
 */
import { validateMilestonePlan, type PlanMilestone } from "../../../../src/domain/milestones";
import { SCOPE_OP_PERMISSION } from "../../../../src/domain/scope";
import { isFreshStamp, isOwnLandedWrite } from "../../../_lib/stamps";
import { UniqueConflictError, fail, ok, type ScopeEnv, type ScopeOpDef } from "./ports";
import { SCHEMA, featureRec, milestoneFields, milestoneRec } from "./records";
import { loadProjectScopeRows, loadScopeState, loadVersion, naturalKey, planNumbers, refuseUnlessDraftOpen, scopeStateOf } from "./shared";

type Row = Record<string, any>;

interface SaveArgs {
  projectId: string;
  scopeVersionId: string;
  plan: { id?: string; clientKey?: string; name: string; goal: string; featureRefs: string[] }[];
  expected: { id: string; updatedAt: string }[];
}

const MAX_PLAN = 50;
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const bad = (key: string) => ({ ok: false as const, messageKey: "input.wrongType", params: { key } });

/** Unknown keys are dropped; only the listed shape reaches the handler. */
function parseSave(raw: unknown) {
  if (!isObj(raw)) return bad("args");
  const { projectId, scopeVersionId, plan, expected } = raw;
  if (typeof projectId !== "string" || !projectId) return bad("projectId");
  if (typeof scopeVersionId !== "string" || !scopeVersionId) return bad("scopeVersionId");
  if (!Array.isArray(plan)) return bad("plan");
  if (plan.length > MAX_PLAN) return { ok: false as const, messageKey: "input.tooMany", params: { key: "plan", max: MAX_PLAN } };
  if (!Array.isArray(expected)) return bad("expected");
  const outPlan: SaveArgs["plan"] = [];
  for (const m of plan) {
    if (!isObj(m)) return bad("plan");
    if (typeof m.name !== "string" || typeof m.goal !== "string") return bad("plan");
    if (!Array.isArray(m.featureRefs) || m.featureRefs.some((r) => typeof r !== "string")) return bad("plan");
    const id = typeof m.id === "string" && m.id ? m.id : undefined;
    const clientKey = typeof m.clientKey === "string" && m.clientKey ? m.clientKey : undefined;
    if (!id && !clientKey) return bad("plan");
    outPlan.push({ ...(id ? { id } : { clientKey }), name: m.name, goal: m.goal, featureRefs: m.featureRefs as string[] });
  }
  const outExpected: SaveArgs["expected"] = [];
  for (const e of expected) {
    if (!isObj(e) || typeof e.id !== "string" || typeof e.updatedAt !== "string") return bad("expected");
    outExpected.push({ id: e.id, updatedAt: e.updatedAt });
  }
  return { ok: true as const, value: { projectId, scopeVersionId, plan: outPlan, expected: outExpected } };
}

const rowSort = (a: Row, b: Row) => Number(a.SortOrder ?? 0) - Number(b.SortOrder ?? 0);

async function insertWithNextNumber(
  env: ScopeEnv,
  version: { id: string; number: number },
  m: PlanMilestone,
  sortOrder: number,
  key: string,
): Promise<{ id: string; number: number }> {
  let number = m.number as number;
  for (let attempt = 0; ; attempt++) {
    try {
      const fields = milestoneFields({ ...m, number }, { projectId: env.projectId, scopeVersion: version.number, sortOrder });
      return { id: (await env.db.insert(SCHEMA.milestone, fields, key)).id, number };
    } catch (err) {
      // A race only (the numbers were free at read time): take the next free one, the fix-up below restores the order.
      if (!(err instanceof UniqueConflictError) || attempt >= 3) throw err;
      const state = await loadScopeState(env, version as any);
      const max = Math.max(number, ...(state.milestones as Row[]).map((r) => milestoneRec(r)!.number));
      number = max + 1;
    }
  }
}

export const milestonesSave: ScopeOpDef = {
  op: "milestones.save",
  kind: "command",
  permission: SCOPE_OP_PERMISSION["milestones.save"],
  parse: parseSave,
  prefetch: (env, args: SaveArgs) =>
    Promise.all([
      loadVersion(env, args.scopeVersionId),
      loadProjectScopeRows(env),
      // Removing a milestone reads it first (an access-checked delete); the stored ones are named by `expected`.
      env.db.warmRemove?.(SCHEMA.milestone, args.expected.slice(0, MAX_PLAN).map((e) => e.id)),
    ]),
  async run(env, args: SaveArgs) {
    // Round 1: the version and the project's scope rows together (narrowed to the version below).
    const [version, allRows] = await Promise.all([loadVersion(env, args.scopeVersionId), loadProjectScopeRows(env)]);
    if (!version) return fail("not_found");
    const refused = refuseUnlessDraftOpen(env, version);
    if (refused) return refused;

    const state = scopeStateOf(allRows, version);
    const stored = (state.milestones as Row[]).map((r) => ({ row: r, rec: milestoneRec(r)! }));
    const byId = new Map(stored.map((s) => [s.rec.id, s]));

    // The whole arrangement is one unit; a retry of this very request may find its own earlier writes. A stamp is
    // fresh when it is the stored one or the caller's own write that this save's answer issued.
    if (env.attempt <= 1) {
      const expected = new Map(args.expected.map((e) => [e.id, e.updatedAt]));
      const asked = new Map(args.plan.flatMap((m, i) => (m.id ? [[m.id, { Name: m.name, Goal: m.goal, FeatureRefs: m.featureRefs, SortOrder: i, Number: i + 1 }] as const] : [])));
      for (const s of stored) {
        const exp = expected.get(s.rec.id);
        if (exp === undefined) return fail("conflict", "milestones.stale");
        if (exp === s.rec.updatedAt || isFreshStamp({ expected: exp, stored: s.row, callerUserId: env.userId })) continue;
        // The caller's own earlier save of exactly these values landed after their answer timed out: nothing to resolve, nothing to write again.
        const values = asked.get(s.rec.id);
        if (values && isOwnLandedWrite({ stored: s.row, callerUserId: env.userId, values })) continue;
        return fail("conflict", "milestones.stale");
      }
    }
    for (const m of args.plan) if (m.id && !byId.has(m.id)) return fail("not_found");

    const features = (state.features as Row[]).map((r) => ({ row: r, rec: featureRec(r)! }));
    const isExcluded = (f: { row: Row; rec: any }) => f.rec.priority === "excluded" || f.row.Status === "dropped";
    const included = features.filter((f) => !isExcluded(f)).map((f) => f.rec.ref as string);
    const excluded = features.filter(isExcluded).map((f) => f.rec.ref as string);

    // Numbers come from the order (Number = position + 1), never from the client.
    const draft: PlanMilestone[] = args.plan.map((m) => ({
      ...(m.id ? { id: m.id } : { clientKey: m.clientKey }),
      name: m.name,
      goal: m.goal,
      featureRefs: m.featureRefs,
    }));
    const issues = validateMilestonePlan(draft, included, "save", excluded);
    if (issues.length) return fail("invalid_input", "milestones.invalid", { issues });

    const keyOf = (m: PlanMilestone): string => m.id ?? `new:${m.clientKey}`;
    const keys = draft.map(keyOf);
    const numbers = planNumbers(state.milestones, keys);
    const first = new Map([...numbers.direct, ...numbers.temp].map((w) => [w.id, w.number]));

    const keep = new Set(draft.filter((m) => m.id).map((m) => m.id as string));
    const removedIds = stored.filter((s) => !keep.has(s.rec.id)).map((s) => s.rec.id as string);

    // ONE round: removals, updates, inserts and the first Number move of every milestone. A target held by another
    // row (also a row removed in this save) goes through a temporary Number; the final one is written in env.after.
    const ids: string[] = new Array(draft.length);
    const current = new Map<string, number>(stored.map((s) => [s.rec.id as string, s.rec.number]));
    const written = new Set<string>();
    const writes: Promise<unknown>[] = removedIds.map((id) => env.db.remove(SCHEMA.milestone, id));
    draft.forEach((m, i) => {
      if (m.id) {
        const cur = byId.get(m.id)!.rec;
        const move = first.get(m.id);
        const same =
          cur.name === m.name &&
          cur.goal === m.goal &&
          cur.sortOrder === i &&
          JSON.stringify(cur.featureRefs) === JSON.stringify(m.featureRefs);
        if (!same || move !== undefined) {
          written.add(m.id);
          if (move !== undefined) current.set(m.id, move);
          writes.push(
            env.db.update(SCHEMA.milestone, m.id, { Name: m.name, Goal: m.goal, FeatureRefs: m.featureRefs, SortOrder: i, ...(move !== undefined ? { Number: move } : {}) }),
          );
        }
        ids[i] = m.id;
      } else {
        const key = keyOf(m);
        writes.push(
          insertWithNextNumber(env, version, { ...m, number: first.get(key) ?? (numbers.final.get(key) as number) }, i, naturalKey(env, "milestone", m.clientKey as string)).then((r) => {
            ids[i] = r.id;
            current.set(key, r.number);
          }),
        );
      }
    });
    await Promise.all(writes);

    // The bookkeeping round: the final Number of every milestone that is not on it yet.
    const late = () =>
      draft.flatMap((m, i) => {
        const key = keyOf(m);
        const want = numbers.final.get(key) as number;
        return current.get(key) === want ? [] : [env.db.update(SCHEMA.milestone, ids[i], { Number: want })];
      });
    if (draft.some((m) => current.get(keyOf(m)) !== numbers.final.get(keyOf(m)))) env.after(() => Promise.all(late()));

    // No read-back: the stored row plus this save's patch, with the stamp this request issued.
    const rows = draft.map((m, i): Row => {
      const patch = { Number: numbers.final.get(keyOf(m)) as number, SortOrder: i, Name: m.name, Goal: m.goal, FeatureRefs: m.featureRefs };
      if (m.id) {
        const base = byId.get(m.id)!.row;
        return { ...base, ...patch, ...(written.has(m.id) || current.get(m.id) !== numbers.final.get(m.id) ? { LastUpdatedDate: env.issuedStamp } : {}) } as Row;
      }
      return {
        ItemId: ids[i],
        ProjectId: env.projectId,
        ScopeVersion: version.number,
        Status: "planned",
        ...patch,
        CreatedDate: env.issuedStamp,
        LastUpdatedDate: env.issuedStamp,
        CreatedByUserId: env.userId,
        UpdatedByUserId: env.userId,
      } as Row;
    });
    return ok({ milestones: [...rows].sort(rowSort), removedIds });
  },
};

export const MILESTONE_HANDLERS: ScopeOpDef[] = [milestonesSave];
