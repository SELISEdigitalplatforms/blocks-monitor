// The Factory's texts as they stand in the code: every t("<module>.<area>.<name>", "English", params?) call under src/
// (a static scan, the {params} kept as written), merged with the bundled German (Switzerland) files
// src/i18n/locales/<module>[-<part>].de-CH.json. Used by scripts/uilm-push.mjs (npm run i18n:push) and its tests.
import fs from "node:fs";
import path from "node:path";

/** A t( call whose first two arguments are string literals: quote, key, quote, English. */
const CALL = /(?<![\w$.])t\(\s*(["'`])((?:\\.|(?!\1)[^\\])*)\1\s*,\s*(["'`])((?:\\.|(?!\3)[^\\])*)\3/g;
/** A t( call at all (to count the ones the scan cannot read: a key or English that is not a plain literal). */
const ANY_CALL = /(?<![\w$.])t\(\s*(?=["'`])/g;
const KEY = /^[a-z][A-Za-z0-9]*(?:\.[A-Za-z0-9][A-Za-z0-9_-]*)+$/;

/** A JavaScript string literal's text (the escapes a source file uses). */
export function unescapeLiteral(raw) {
  return raw.replace(/\\(u\{[0-9a-fA-F]+\}|u[0-9a-fA-F]{4}|x[0-9a-fA-F]{2}|.)/gs, (_, e) => {
    if (e[0] === "u" && e[1] === "{") return String.fromCodePoint(parseInt(e.slice(2, -1), 16));
    if (e[0] === "u" && e.length === 5) return String.fromCharCode(parseInt(e.slice(1), 16));
    if (e[0] === "x" && e.length === 3) return String.fromCharCode(parseInt(e.slice(1), 16));
    return { n: "\n", t: "\t", r: "\r", b: "\b", f: "\f", v: "\v", 0: "\0", "\n": "" }[e] ?? e;
  });
}

/** The {params} a text names, sorted. */
export const paramsOf = (text) => [...new Set([...String(text).matchAll(/\{(\w+)\}/g)].map((m) => m[1]))].sort();

/** The t() calls in one source text: [{ key, english, line }], plus the calls that are not two plain literals. */
export function extractCalls(source, file = "") {
  const calls = [];
  const literalAt = new Set();
  for (const m of source.matchAll(CALL)) {
    literalAt.add(m.index);
    // a template literal with ${…} is dynamic: not a text the scan can take
    if ((m[1] === "`" && m[2].includes("${")) || (m[3] === "`" && m[4].includes("${"))) { literalAt.delete(m.index); continue; }
    const line = source.slice(0, m.index).split("\n").length;
    calls.push({ key: unescapeLiteral(m[2]), english: unescapeLiteral(m[4]), file, line });
  }
  const dynamic = [];
  for (const m of source.matchAll(ANY_CALL)) {
    if (!literalAt.has(m.index)) dynamic.push({ file, line: source.slice(0, m.index).split("\n").length });
  }
  return { calls, dynamic };
}

function walk(dir, out) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (/\.(tsx?|mts|mjs|jsx?)$/.test(entry.name) && !/\.(test|spec)\.[a-z]+$/.test(entry.name) && !entry.name.endsWith(".d.ts")) out.push(full);
  }
  return out;
}

/** Nested JSON → flat "a.b.c" keys (string values only). */
export function flatten(obj, prefix = "", out = {}) {
  if (!obj || typeof obj !== "object") return out;
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (typeof v === "string") out[key] = v;
    else flatten(v, key, out);
  }
  return out;
}

/** "platform.de-CH.json" / "common-language.de-CH.json" → { module, culture }. */
export function localeFileOf(name) {
  const m = /^([a-z][A-Za-z0-9]*)(?:-[A-Za-z0-9-]+)?\.(en|de-CH)\.json$/.exec(name);
  return m ? { module: m[1], culture: m[2] } : null;
}

/**
 * Everything the push needs, by module: { modules: { <module>: { en: {name: text}, de: {name: text} } }, problems, counts }.
 * `knownModules`: the UILM modules (src/i18n/modules.ts). A key outside them, two different Englishes for one key, a
 * German text whose {params} differ from the English, or a German key no code uses is reported, never pushed.
 */
export function collectTexts({ srcDir, localesDir, knownModules }) {
  const problems = [];
  const english = new Map();
  let dynamicCalls = 0;
  for (const file of walk(srcDir, [])) {
    const rel = path.relative(path.dirname(srcDir), file);
    const { calls, dynamic } = extractCalls(fs.readFileSync(file, "utf8"), rel);
    dynamicCalls += dynamic.length;
    for (const d of dynamic) problems.push({ kind: "dynamic", where: `${d.file}:${d.line}`, message: "t() with a key or English that is not a plain string: not pushed" });
    for (const c of calls) {
      const where = `${c.file}:${c.line}`;
      const mod = c.key.split(".")[0];
      if (!KEY.test(c.key) || !knownModules.includes(mod)) { problems.push({ kind: "key", where, key: c.key, message: `not a "<module>.<area>.<name>" key of a known module` }); continue; }
      if (!c.english.trim()) { problems.push({ kind: "empty", where, key: c.key, message: "empty English" }); continue; }
      const seen = english.get(c.key);
      if (seen && seen.english !== c.english) { problems.push({ kind: "conflict", where, key: c.key, message: `different English than ${seen.where}` }); continue; }
      if (!seen) english.set(c.key, { english: c.english, where });
    }
  }
  const german = {};
  if (fs.existsSync(localesDir)) {
    for (const name of fs.readdirSync(localesDir).sort()) {
      const f = localeFileOf(name);
      if (!f || f.culture !== "de-CH") continue;
      let data;
      try { data = JSON.parse(fs.readFileSync(path.join(localesDir, name), "utf8")); } catch (e) {
        problems.push({ kind: "file", where: name, message: `not valid JSON (${e.message})` });
        continue;
      }
      Object.assign(german, flatten(data, f.module));
    }
  }
  const modules = {};
  for (const m of knownModules) modules[m] = { en: {}, de: {}, missingDe: 0, orphanDe: 0 };
  for (const [key, { english: en }] of english) {
    const mod = key.split(".")[0];
    const name = key.slice(mod.length + 1);
    modules[mod].en[name] = en;
    const de = german[key];
    if (typeof de !== "string" || !de.trim()) { modules[mod].missingDe++; continue; }
    if (paramsOf(de).join() !== paramsOf(en).join()) {
      problems.push({ kind: "params", key, message: `de-CH {${paramsOf(de).join(", ")}} vs English {${paramsOf(en).join(", ")}}` });
      continue;
    }
    modules[mod].de[name] = de;
  }
  for (const key of Object.keys(german)) {
    if (english.has(key)) continue;
    const mod = key.split(".")[0];
    if (modules[mod]) modules[mod].orphanDe++;
    problems.push({ kind: "orphan", key, message: "German text with no t() call in the code: not pushed" });
  }
  return { modules, problems, counts: { keys: english.size, dynamicCalls } };
}
