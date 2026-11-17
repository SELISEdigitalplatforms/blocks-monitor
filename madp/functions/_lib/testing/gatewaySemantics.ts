// Test kit only: the live SELISE Blocks Data Gateway filter semantics, proven live on 20.10.2026 (LIVE-QA-1 QA-01).
// The live gateway matches ItemId only at the TOP LEVEL of a filter; inside $and/$or an ItemId condition matches nothing.
type Row = Record<string, unknown>;

const isPlain = (x: unknown): x is Record<string, unknown> =>
  typeof x === "object" && x !== null && !Array.isArray(x) && Object.getPrototypeOf(x) === Object.prototype;

const isScalar = (x: unknown): x is string | number | boolean =>
  typeof x === "string" || typeof x === "number" || typeof x === "boolean";

function eq(rowValue: unknown, want: unknown): boolean {
  return Array.isArray(rowValue) ? rowValue.some((v) => v === want) : rowValue === want;
}

function compare(rowValue: unknown, want: unknown, test: (c: number) => boolean): boolean {
  if (!isScalar(rowValue) || !isScalar(want) || typeof rowValue !== typeof want) return false;
  return test(rowValue < want ? -1 : rowValue > want ? 1 : 0);
}

function operatorsHold(rowValue: unknown, ops: Record<string, unknown>): boolean {
  const keys = Object.keys(ops);
  const dollar = keys.filter((k) => k.startsWith("$")).length;
  if (dollar !== keys.length) throw new TypeError("unsupported filter operator: mixed operator and plain keys");
  for (const [op, v] of Object.entries(ops)) {
    switch (op) {
      case "$eq":
        if (!eq(rowValue, v)) return false;
        break;
      case "$ne":
        if (eq(rowValue, v)) return false;
        break;
      case "$in":
        if (!Array.isArray(v)) throw new TypeError("unsupported filter operator: $in needs an array");
        if (!v.some((x) => eq(rowValue, x))) return false;
        break;
      case "$nin":
        if (!Array.isArray(v)) throw new TypeError("unsupported filter operator: $nin needs an array");
        if (v.some((x) => eq(rowValue, x))) return false;
        break;
      case "$gt":
        if (!compare(rowValue, v, (c) => c > 0)) return false;
        break;
      case "$gte":
        if (!compare(rowValue, v, (c) => c >= 0)) return false;
        break;
      case "$lt":
        if (!compare(rowValue, v, (c) => c < 0)) return false;
        break;
      case "$lte":
        if (!compare(rowValue, v, (c) => c <= 0)) return false;
        break;
      case "$exists":
        if ((rowValue !== undefined && rowValue !== null) !== Boolean(v)) return false;
        break;
      default:
        throw new TypeError("unsupported filter operator");
    }
  }
  return true;
}

function fieldMatches(rowValue: unknown, want: unknown): boolean {
  if (isPlain(want) && Object.keys(want).length > 0 && Object.keys(want).every((k) => k.startsWith("$"))) {
    return operatorsHold(rowValue, want);
  }
  if (isPlain(want)) return operatorsHold(rowValue, want); // mixed or empty: throws / rejects as unsupported
  if (!isScalar(want)) throw new TypeError("unsupported filter value");
  return eq(rowValue, want);
}

function clauses(value: unknown, key: string): Record<string, unknown>[] {
  if (!Array.isArray(value) || value.length === 0 || !value.every(isPlain)) {
    throw new TypeError(`${key} needs a non-empty array of filter objects`);
  }
  return value;
}

function evaluate(filter: Record<string, unknown>, row: Row, nested: boolean): boolean {
  for (const [key, want] of Object.entries(filter)) {
    if (key === "$and") {
      if (!clauses(want, key).every((c) => evaluate(c, row, true))) return false;
    } else if (key === "$or") {
      if (!clauses(want, key).some((c) => evaluate(c, row, true))) return false;
    } else if (key.startsWith("$")) {
      throw new TypeError("unsupported filter operator");
    } else if (key === "ItemId") {
      // the live defect: ItemId inside $and/$or matches nothing
      if (nested || !fieldMatches(row.ItemId, want)) return false;
    } else if (key === "_id") {
      if (!fieldMatches(row.ItemId, want)) return false;
    } else if (!fieldMatches(row[key], want)) {
      return false;
    }
  }
  return true;
}

export function wireMatches(filter: Record<string, unknown>, row: Record<string, unknown>): boolean {
  if (!isPlain(filter)) throw new TypeError("a gateway filter must be a plain object");
  return evaluate(filter, row, false);
}
