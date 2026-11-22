// Test kit only: S1's schemas, validations and unique indexes, loaded once, and the row check every fake gateway shares.
import fs from "node:fs";
import path from "node:path";
import { ROOT } from "../../../scripts/functions-common.mjs";
import { OpError } from "../errors";

type FieldRule = {
  required?: boolean;
  enum?: string[];
  pattern?: string;
  min?: number;
  max?: number;
  minLength?: number;
  maxLength?: number;
};
type SchemaField = { name: string; type: string; isArray?: boolean };
type Loaded = {
  fields: Map<string, Map<string, SchemaField>>;
  rules: Record<string, Record<string, FieldRule>>;
  indexes: Record<string, string[][]>;
};

// Columns the platform adds to every row; RequestKey is allowed until lane S2 puts it into the schemas (PENDING_S2).
const SYSTEM_FIELDS = new Set([
  "CreatedDate", "CreatedBy", "LastUpdatedDate", "LastUpdatedBy", "Language", "OrganizationIds", "Tags",
  "IsDeleted", "DeletedDate", "DeletedBy", "RequestKey",
]);

let loaded: Loaded | null = null;

function readJson(file: string): any {
  return JSON.parse(fs.readFileSync(path.join(ROOT, "blocks", "data", file), "utf8"));
}

function load(): Loaded {
  if (loaded) return loaded;
  const dir = path.join(ROOT, "blocks", "data", "schemas");
  const fields = new Map<string, Map<string, SchemaField>>();
  for (const file of fs.readdirSync(dir).filter((f) => f.endsWith(".json")).sort()) {
    const doc = JSON.parse(fs.readFileSync(path.join(dir, file), "utf8")) as { schemaName: string; fields: SchemaField[] };
    fields.set(doc.schemaName, new Map(doc.fields.map((f) => [f.name, f])));
  }
  const indexes: Record<string, string[][]> = {};
  for (const s of readJson("indexes.json").schemas as { schemaName: string; indexes: { fields: string[]; unique: boolean }[] }[]) {
    indexes[s.schemaName] = s.indexes.filter((i) => i.unique).map((i) => i.fields.map((f) => f.split(":")[0] as string));
  }
  loaded = { fields, rules: readJson("validations.json").schemas, indexes };
  return loaded;
}

function bad(schema: string, field: string, rule: string): never {
  throw new OpError("internal", "fn.invalidRow", { schema, field, rule });
}

function checkValue(schema: string, field: string, value: unknown, rule: FieldRule | undefined, isArray: boolean): void {
  if (value === undefined || value === null) return;
  if (isArray !== Array.isArray(value)) bad(schema, field, isArray ? "array" : "scalar");
  const items = Array.isArray(value) ? value : [value];
  for (const item of items) {
    if (!rule) continue;
    if (typeof item === "string") {
      if (item === "" && !rule.enum) continue;
      if (rule.enum && !rule.enum.includes(item)) bad(schema, field, "enum");
      if (rule.pattern && !new RegExp(rule.pattern).test(item)) bad(schema, field, "pattern");
      if (rule.maxLength !== undefined && item.length > rule.maxLength) bad(schema, field, "maxLength");
      if (rule.minLength !== undefined && item.length < rule.minLength) bad(schema, field, "minLength");
    } else if (typeof item === "number") {
      if (rule.min !== undefined && item < rule.min) bad(schema, field, "min");
      if (rule.max !== undefined && item > rule.max) bad(schema, field, "max");
    }
  }
}

/** Throws OpError('internal', 'fn.invalidRow', { schema, field, rule }) like the hosted gateway's validation failure. */
export function assertRowValid(
  schema: string,
  row: Record<string, unknown>,
  opts: { partial?: boolean; read?: boolean } = {},
): void {
  const { fields, rules } = load();
  const known = fields.get(schema);
  if (!known) bad(schema, "", "schema");
  const schemaRules = rules[schema] ?? {};
  for (const [name, value] of Object.entries(row)) {
    const def = known.get(name);
    if (!def) {
      if (SYSTEM_FIELDS.has(name) || (opts.read && name === "ItemId")) continue;
      bad(schema, name, "unknown");
    }
    checkValue(schema, name, value, schemaRules[name], def.isArray === true);
  }
  if (opts.partial) return;
  for (const [name, rule] of Object.entries(schemaRules)) {
    if (!rule.required) continue;
    const value = row[name];
    if (value === undefined || value === null || value === "") bad(schema, name, "required");
  }
}

/** Sorted names of the schemas that have both WorkspaceId and ReaderIds. */
export function aclSchemasFromS1(): string[] {
  return [...load().fields.entries()]
    .filter(([, f]) => f.has("WorkspaceId") && f.has("ReaderIds"))
    .map(([name]) => name)
    .sort();
}

/** Unique indexes per schema, plus ['RequestKey'] for every schema. */
export function uniqueIndexesFromS1(): Record<string, string[][]> {
  const { fields, indexes } = load();
  const out: Record<string, string[][]> = {};
  for (const name of fields.keys()) out[name] = [...(indexes[name] ?? []), ["RequestKey"]];
  return out;
}
