// POST /api/data checks every read against the field catalogue of blocks/data/schemas (server/fnHost/dataRead.ts). It was
// read once at server start, so a field added to a schema gave 400 until a restart. liveS1Catalog reads it again when the
// schema files change (a cheap check of their modification times and sizes, at most once per interval); a catalogue
// that cannot be read keeps the one before.
//   npx vitest run --config test/blocksHost/vitest.config.ts test/blocksHost/catalogReload.test.ts
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { liveS1Catalog, validateDataRequest } from "../../server/fnHost/dataRead";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const made: string[] = [];
afterEach(() => {
  for (const d of made.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

/** A root with the real README and two real schema files. */
function root(): { dir: string; schema: string } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "madp-catalog-"));
  made.push(dir);
  fs.mkdirSync(path.join(dir, "blocks/data/schemas"), { recursive: true });
  fs.copyFileSync(path.join(ROOT, "blocks/data/README.md"), path.join(dir, "blocks/data/README.md"));
  for (const f of ["ChangeRequest.json", "Project.json"]) fs.copyFileSync(path.join(ROOT, "blocks/data/schemas", f), path.join(dir, "blocks/data/schemas", f));
  return { dir, schema: path.join(dir, "blocks/data/schemas/ChangeRequest.json") };
}
const read = (field: string) => ({ reads: [{ schema: "ChangeRequest", fields: ["ItemId", field], pageNo: 1, pageSize: 10 }] });
/** The schema file with one more field, written with a later modification time. */
function addField(file: string, name: string, at: number) {
  const doc = JSON.parse(fs.readFileSync(file, "utf8")) as { fields: Array<Record<string, unknown>> };
  doc.fields.push({ name, type: "String", isArray: false, isPIIData: false, isUniqueData: false, description: "A new field." });
  fs.writeFileSync(file, JSON.stringify(doc, null, 2));
  fs.utimesSync(file, new Date(at), new Date(at));
}

describe("the /api/data field catalogue follows the schema files", () => {
  it("a new field is readable after the next check, without a restart", () => {
    const { dir, schema } = root();
    let now = 1_000_000;
    const catalog = liveS1Catalog(dir, { everyMs: 1000, now: () => now });
    expect(validateDataRequest(read("Checks"), catalog())).toMatchObject({ ok: true });
    expect(validateDataRequest(read("NewField"), catalog())).toMatchObject({ ok: false });
    addField(schema, "NewField", Date.now() + 10_000);
    // not before the interval: no file system look on every request
    now += 500;
    expect(validateDataRequest(read("NewField"), catalog())).toMatchObject({ ok: false });
    now += 600;
    expect(validateDataRequest(read("NewField"), catalog())).toMatchObject({ ok: true });
  });

  it("nothing changed: the same catalogue; a file half written: the one before stays until it reads again", () => {
    const { dir, schema } = root();
    let now = 0;
    const catalog = liveS1Catalog(dir, { everyMs: 10, now: () => now });
    const first = catalog();
    now += 20;
    expect(catalog()).toBe(first);
    fs.writeFileSync(schema, "{ \"schemaName\": \"ChangeRequest\", \"fields\": [");
    fs.utimesSync(schema, new Date(Date.now() + 20_000), new Date(Date.now() + 20_000));
    now += 20;
    expect(catalog()).toBe(first);
    expect(validateDataRequest(read("Checks"), catalog())).toMatchObject({ ok: true });
    // written in full: read again at the next check
    fs.copyFileSync(path.join(ROOT, "blocks/data/schemas/ChangeRequest.json"), schema);
    addField(schema, "Later", Date.now() + 30_000);
    now += 20;
    expect(validateDataRequest(read("Later"), catalog())).toMatchObject({ ok: true });
  });
});
