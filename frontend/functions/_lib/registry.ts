import type { OpDef, OpSpec } from "./types";

/** Operation.Op and AuditEvent.Action store op names, and S1 allows no digits there. */
export const S1_OP_PATTERN = /^[a-z][a-zA-Z]*([.][a-z][a-zA-Z-]*)+$/;

const BRANDED = new WeakSet<object>();

/** The only way to make an op: shape-checked, frozen and branded so the build can tell it from look-alikes. */
export function defineOp<A, R>(spec: OpSpec<A, R>): OpDef<A, R> {
  if (!spec || typeof spec !== "object") throw new TypeError("defineOp needs a spec object.");
  if (typeof spec.op !== "string" || spec.op === "") throw new TypeError("defineOp: op must be a non-empty string.");
  const name = spec.op;
  if (spec.kind !== "command" && spec.kind !== "view") throw new TypeError(`defineOp ${name}: kind must be "command" or "view".`);
  if (!["self", "workspace", "project", "platform", "engine"].includes(spec.scope)) {
    throw new TypeError(`defineOp ${name}: unknown scope.`);
  }
  if (typeof spec.handler !== "function") throw new TypeError(`defineOp ${name}: handler must be a function.`);
  if (typeof spec.args !== "function" && (typeof spec.args !== "object" || spec.args === null)) {
    throw new TypeError(`defineOp ${name}: args must be a validator or a function.`);
  }
  const def = Object.freeze({ ...spec }) as unknown as OpDef<A, R>;
  BRANDED.add(def);
  return def;
}

export function isOpDef(x: unknown): x is OpDef {
  return typeof x === "object" && x !== null && BRANDED.has(x);
}

function isPlainRecord(x: unknown): x is Record<string, unknown> {
  if (typeof x !== "object" || x === null || Array.isArray(x)) return false;
  const proto = Object.getPrototypeOf(x) as unknown;
  return proto === Object.prototype || proto === null;
}

function looksLikeOp(x: Record<string, unknown>): boolean {
  return typeof x.op === "string" && typeof x.handler === "function";
}

const MAX_DEPTH = 3;

/**
 * Collects every defineOp() definition reachable from the exports of the op files: single exports, arrays and
 * plain records of either. The same definition twice counts once; two different definitions of one name, or an
 * op-shaped object that defineOp did not make, throw.
 */
export function collectOps(modules: ReadonlyArray<readonly [file: string, mod: Record<string, unknown>]>): OpDef[] {
  const found = new Map<string, { def: OpDef; file: string }>();

  const add = (def: OpDef, file: string): void => {
    const prev = found.get(def.op);
    if (!prev) {
      found.set(def.op, { def, file });
      return;
    }
    if (prev.def === def) return;
    throw new Error(`Duplicate op "${def.op}" defined in ${prev.file} and ${file}.`);
  };

  const visit = (value: unknown, file: string, exportName: string, depth: number): void => {
    if (isOpDef(value)) return add(value, file);
    if (Array.isArray(value)) {
      if (depth < MAX_DEPTH) for (const item of value) visit(item, file, exportName, depth + 1);
      return;
    }
    if (!isPlainRecord(value)) return;
    if (looksLikeOp(value)) {
      throw new Error(`${file}: export "${exportName}" looks like an op but was not made with defineOp().`);
    }
    if (depth < MAX_DEPTH) for (const item of Object.values(value)) visit(item, file, exportName, depth + 1);
  };

  for (const [file, mod] of modules) {
    for (const [exportName, value] of Object.entries(mod)) visit(value, file, exportName, 0);
  }
  return [...found.values()].map((e) => e.def).sort((a, b) => (a.op < b.op ? -1 : a.op > b.op ? 1 : 0));
}
