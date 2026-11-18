// Shared flat gateway-filter rule (pure). Live fact (LIVE-QA-1 QA-01, 20.10.2026): the
// Blocks Data Gateway matches ItemId only at the TOP LEVEL of a filter. {ItemId:x},
// {ItemId:x,WorkspaceId:w} and {ItemId:{$in:[...]}} work; {$and:[{ItemId:x}]} and
// {$and:[{ItemId:{$in:[x]}}]} match nothing. Other fields inside $and work.
// So every builder emits one flat object (implicit AND of its keys) through this module,
// which is the only place operator spellings ($in, $eq, $and) are written.

export type FilterScalar = string | number | boolean;
export type FilterCondition =
  | { readonly field: string; readonly op: "eq"; readonly value: FilterScalar }
  | { readonly field: string; readonly op: "in"; readonly values: readonly FilterScalar[] };
export interface FlatFilter {
  /** The gateway filter (one flat object, implicit AND of its keys); undefined when there is no condition or nothing can match. */
  readonly filter: Record<string, unknown> | undefined;
  /** True when no row can match (an empty IN list, or ItemId conditions without a common value): callers skip the gateway call. */
  readonly matchesNothing: boolean;
}

export const ITEM_ID_FIELD = "ItemId";

const FIELD = /^[A-Za-z][A-Za-z0-9]*$/;
const NOTHING: FlatFilter = { filter: undefined, matchesNothing: true };

function sameList(a: readonly FilterScalar[], b: readonly FilterScalar[]): boolean {
  return a.length === b.length && a.every((v, i) => v === b[i]);
}

export function flattenConditions(conditions: readonly FilterCondition[]): FlatFilter {
  for (const c of conditions) {
    if (typeof c.field !== "string" || !FIELD.test(c.field)) throw new TypeError("invalid filter field name");
  }
  if (conditions.length === 0) return { filter: undefined, matchesNothing: false };
  if (conditions.some((c) => c.op === "in" && c.values.length === 0)) return NOTHING;

  const groups = new Map<string, FilterCondition[]>();
  for (const c of conditions) {
    const g = groups.get(c.field);
    if (g) g.push(c);
    else groups.set(c.field, [c]);
  }

  const out: Record<string, unknown> = {};
  const extras: Record<string, unknown>[] = [];

  for (const [field, group] of groups) {
    if (field === ITEM_ID_FIELD) {
      if (group.length === 1) {
        const c = group[0];
        out[field] = c.op === "eq" ? c.value : { $in: [...c.values] };
        continue;
      }
      const sets = group.map((c): FilterScalar[] => (c.op === "eq" ? [c.value] : [...new Set(c.values)]));
      let common = sets[0];
      for (const s of sets.slice(1)) common = common.filter((v) => s.includes(v));
      if (common.length === 0) return NOTHING;
      out[field] = group.some((c) => c.op === "eq") ? common[0] : { $in: common };
      continue;
    }

    const eqs: FilterScalar[] = [];
    const ins: (readonly FilterScalar[])[] = [];
    for (const c of group) {
      if (c.op === "eq") {
        if (!eqs.includes(c.value)) eqs.push(c.value);
      } else if (!ins.some((l) => sameList(l, c.values))) ins.push(c.values);
    }
    if (eqs.length > 0 && ins.length > 0) out[field] = { $eq: eqs[0], $in: [...ins[0]] };
    else if (eqs.length > 0) out[field] = eqs[0];
    else out[field] = { $in: [...ins[0]] };
    for (const v of eqs.slice(1)) extras.push({ [field]: v });
    for (const l of ins.slice(1)) extras.push({ [field]: { $in: [...l] } });
  }

  if (extras.length > 0) out.$and = extras;
  return { filter: out, matchesNothing: false };
}
