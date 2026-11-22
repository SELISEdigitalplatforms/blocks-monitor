// npm run i18n:push's static scan: every t("<module>.<area>.<name>", "English") call, params kept, escapes read, the
// German merged by module, and every problem (unknown module, two Englishes, params that differ, German without a call,
// a call that is not two plain strings) listed and left out.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
// @ts-expect-error a plain .mjs module without types
import { collectTexts, extractCalls, localeFileOf, paramsOf, unescapeLiteral } from "../../scripts/i18n-extract.mjs";
import { I18N_MODULES } from "../../src/i18n/modules";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "mf-i18n-extract-"));
afterAll(() => { fs.rmSync(tmp, { recursive: true, force: true }); });

describe("extractCalls", () => {
  it("reads both quote kinds, several lines, escapes and {params}", () => {
    const src = [
      `const a = t("shell.top.search", "Search projects and clients…");`,
      `const b = t('platform.plans.count', 'It\\'s {count} plans', { count });`,
      `const c = t(`,
      `  "billing.pill.left",`,
      "  `{amount} left`,",
      `);`,
      `const d = useT(); x.t("not.ours", "Ignored"); format("a", "b");`,
      `const e = t("common.x.quote", "Say \\"hi\\"\\n\\u00e4");`,
    ].join("\n");
    const { calls, dynamic } = extractCalls(src, "src/a.tsx");
    expect(calls.map((c: { key: string; english: string; line: number }) => [c.key, c.english, c.line])).toEqual([
      ["shell.top.search", "Search projects and clients…", 1],
      ["platform.plans.count", "It's {count} plans", 2],
      ["billing.pill.left", "{amount} left", 3],
      ["common.x.quote", 'Say "hi"\nä', 8],
    ]);
    expect(dynamic).toEqual([]);
  });

  it("counts a call it cannot read as dynamic", () => {
    const { calls, dynamic } = extractCalls("t(\"shell.a.b\", english);\nt(`shell.${area}.c`, \"X\");\nt(\"shell.a.c\", `Hi ${name}`);", "f.ts");
    expect(calls).toEqual([]);
    expect(dynamic.map((d: { line: number }) => d.line)).toEqual([1, 2, 3]);
  });

  it("helpers", () => {
    expect(paramsOf("{b} and {a} and {b}")).toEqual(["a", "b"]);
    expect(unescapeLiteral("a\\tb\\\\c")).toBe("a\tb\\c");
    expect(localeFileOf("common-language.de-CH.json")).toEqual({ module: "common", culture: "de-CH" });
    expect(localeFileOf("notes.txt")).toBeNull();
  });
});

describe("collectTexts", () => {
  it("merges the code's English with the German by module and lists every problem", () => {
    const src = path.join(tmp, "src");
    const locales = path.join(src, "i18n", "locales");
    fs.mkdirSync(path.join(src, "ui"), { recursive: true });
    fs.mkdirSync(locales, { recursive: true });
    fs.writeFileSync(path.join(src, "ui", "A.tsx"), [
      `t("shell.top.search", "Search");`,
      `t("shell.top.count", "{count} new");`,
      `t("shell.top.search", "Search");`,
      `t("platform.plans.save", "Save");`,
      `t("nomodule.x.y", "Unknown module");`,
      `t("common.x.twice", "One");`,
      `t("common.x.twice", "Two");`,
    ].join("\n"));
    fs.writeFileSync(path.join(src, "ui", "A.test.tsx"), `t("shell.test.only", "Tests are not scanned");`);
    fs.writeFileSync(path.join(locales, "shell.de-CH.json"), JSON.stringify({ top: { search: "Suchen", count: "{anzahl} neu" }, gone: { old: "Alt" } }));
    fs.writeFileSync(path.join(locales, "platform-plans.de-CH.json"), JSON.stringify({ plans: { save: "Speichern" } }));
    const r = collectTexts({ srcDir: src, localesDir: locales, knownModules: [...I18N_MODULES] });
    expect(r.counts.keys).toBe(4);
    expect(r.modules.shell.en).toEqual({ "top.search": "Search", "top.count": "{count} new" });
    expect(r.modules.shell.de).toEqual({ "top.search": "Suchen" });
    expect(r.modules.platform).toMatchObject({ en: { "plans.save": "Save" }, de: { "plans.save": "Speichern" }, missingDe: 0 });
    expect(r.modules.common.missingDe).toBe(1);
    expect(r.modules.shell.orphanDe).toBe(1);
    const kinds = r.problems.map((p: { kind: string; key?: string }) => `${p.kind}:${p.key ?? ""}`).sort();
    expect(kinds).toEqual(["conflict:common.x.twice", "key:nomodule.x.y", "orphan:shell.gone.old", "params:shell.top.count"]);
  });

  it("finds the real calls in the app (the switch's own texts)", () => {
    const root = path.resolve(__dirname, "..", "..");
    const r = collectTexts({ srcDir: path.join(root, "src"), localesDir: path.join(root, "src/i18n/locales"), knownModules: [...I18N_MODULES] });
    expect(r.modules.common.en["language.label"]).toBe("Language");
    expect(r.modules.common.de["language.label"]).toBe("Sprache");
  });
});
