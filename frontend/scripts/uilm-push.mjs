#!/usr/bin/env node
// npm run i18n:push — the Factory's texts into SELISE Blocks Localization (UILM), through the Blocks CLI only.
//
//   npm run i18n:push                      dry run: what would be sent (nothing changes in Blocks)
//   npm run i18n:push -- --apply           send it
//   npm run i18n:push -- --apply --prune   also delete UILM keys no t() call uses any more (never without --prune)
//   options: --modules shell,common  --project <tenantId>  --account <name>  --json  --offline (no CLI at all)
//
// 1. every t("<module>.<area>.<name>", "English") call under src/ (scripts/i18n-extract.mjs), merged with the bundled
//    German (Switzerland) files src/i18n/locales/*.de-CH.json; problems (unknown module, two Englishes for one key,
//    German {params} that differ, German with no call) are listed and left out;
// 2. the tenant's languages: English (en-US, or "en" when the tenant already has that) and de-CH; a missing one is added
//    (blocks localization language save);
// 3. the modules (src/i18n/modules.ts): a missing one is created (blocks localization module save);
// 4. per module: validate, then push English, then de-CH (blocks localization push --publish once: one UILM file
//    regeneration per push; each push merges its own language into the keys and keeps the others);
// 5. with --prune: the module's UILM keys that no call names any more are deleted (blocks localization key delete-keys).
// Every mutating command runs with --dry-run unless --apply is given. The CLI's login and project selection are used
// (blocks login; blocks use <tenantId>, or --project). Prints the counts per module.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { collectTexts } from "./i18n-extract.mjs";
import { I18N_MODULES } from "../src/i18n/modules.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const argv = process.argv.slice(2);
const flag = (name) => argv.includes(`--${name}`);
const option = (name) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[i + 1] : null;
};
const apply = flag("apply");
const prune = flag("prune");
const offline = flag("offline");
const asJson = flag("json");
const only = option("modules")?.split(",").map((s) => s.trim()).filter(Boolean) ?? null;
const scope = [...(option("project") ? ["--project", option("project")] : []), ...(option("account") ? ["--account", option("account")] : [])];
const DE = "de-CH";
const say = (line) => { if (!asJson) console.log(line); };

if (only) {
  const unknown = only.filter((m) => !I18N_MODULES.includes(m));
  if (unknown.length) { console.error(`Unknown module(s): ${unknown.join(", ")}. Modules: ${I18N_MODULES.join(", ")}`); process.exit(2); }
}

/** One Blocks CLI command with --json; its parsed answer, or { error }. Strict flags: an unknown flag fails. */
function blocks(args) {
  try {
    const out = execFileSync("blocks", [...args, ...scope, "--json"], {
      encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, BLOCKS_STRICT_FLAGS: "1" }, maxBuffer: 64 * 1024 * 1024,
    });
    try { return JSON.parse(out); } catch { return { raw: out.trim() }; }
  } catch (e) {
    const text = String(e.stdout || e.stderr || e.message || "").trim();
    let parsed = null;
    try { parsed = JSON.parse(text); } catch { /* not JSON */ }
    return { error: parsed?.error?.message || parsed?.message || text.split("\n").slice(-3).join(" ") || "failed" };
  }
}
const mutate = (args) => blocks([...args, apply ? "--yes" : "--dry-run"]);

/** The arrays of objects anywhere in a CLI answer (list shapes differ: data, items, plain arrays). */
function rows(answer) {
  if (Array.isArray(answer)) return answer.filter((r) => r && typeof r === "object");
  if (!answer || typeof answer !== "object") return [];
  for (const k of ["data", "items", "result", "languages", "modules", "keys"]) {
    const r = rows(answer[k]);
    if (r.length) return r;
  }
  return [];
}
const field = (row, ...names) => {
  for (const n of names) for (const k of Object.keys(row)) if (k.toLowerCase() === n.toLowerCase() && typeof row[k] === "string") return row[k];
  return "";
};

// 1. the texts
const { modules, problems, counts } = collectTexts({
  srcDir: path.join(root, "src"), localesDir: path.join(root, "src/i18n/locales"), knownModules: [...I18N_MODULES],
});
const chosen = (only ?? I18N_MODULES).filter((m) => Object.keys(modules[m].en).length > 0 || only);
const report = { mode: apply ? "apply" : "dry-run", prune, keys: counts.keys, modules: {}, languages: {}, problems, steps: [] };
say(`${counts.keys} keys in the code; ${problems.length} problem(s) left out${apply ? "" : " · DRY RUN (add --apply to send)"}`);
for (const p of problems.slice(0, 40)) say(`  ! ${p.kind}: ${p.key ?? ""} ${p.where ?? ""} ${p.message}`.replace(/\s+/g, " "));
if (problems.length > 40) say(`  … ${problems.length - 40} more (--json lists them all)`);

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mf-uilm-"));
try {
  for (const m of chosen) {
    fs.writeFileSync(path.join(dir, `${m}.en.json`), JSON.stringify(modules[m].en, null, 2));
    fs.writeFileSync(path.join(dir, `${m}.${DE}.json`), JSON.stringify(modules[m].de, null, 2));
  }

  let english = "en-US";
  let cliOk = !offline;
  if (cliOk) {
    // 2. languages
    const langs = blocks(["localization", "language", "list-for-tenant"]);
    if (langs.error) {
      cliOk = false;
      say(`Blocks CLI not usable (${langs.error}). Run 'blocks login' and 'blocks use <tenantId>' (or pass --project). Counts only.`);
    } else {
      const codes = rows(langs).map((r) => field(r, "languageCode", "code", "culture"));
      english = codes.includes("en-US") ? "en-US" : codes.includes("en") ? "en" : "en-US";
      for (const [code, name] of [[english, "English"], [DE, "German (Switzerland)"]]) {
        const has = codes.includes(code);
        report.languages[code] = has ? "exists" : apply ? "added" : "would be added";
        if (!has) {
          const r = mutate(["localization", "language", "save", "--language-name", name, "--language-code", code]);
          report.steps.push({ step: `language ${code}`, ...(r.error ? { error: r.error } : {}) });
          if (r.error) report.languages[code] = `failed: ${r.error}`;
        }
      }
      say(`Languages: ${Object.entries(report.languages).map(([c, s]) => `${c} ${s}`).join(", ")}`);
    }
  }

  // 3. modules (their ids, for --prune)
  const moduleIds = {};
  if (cliOk) {
    const list = blocks(["localization", "module", "list-for-tenant"]);
    for (const r of rows(list)) moduleIds[field(r, "moduleName", "name")] = field(r, "itemId", "id", "moduleId");
    for (const m of chosen) {
      if (moduleIds[m]) continue;
      const r = mutate(["localization", "module", "save", "--module-name", m]);
      report.steps.push({ step: `module ${m}`, ...(r.error ? { error: r.error } : {}) });
    }
  }

  // 4. keys
  for (const m of chosen) {
    const en = Object.keys(modules[m].en).length;
    const de = Object.keys(modules[m].de).length;
    const row = { keys: en, deCH: de, missingDeCH: modules[m].missingDe, orphanDeCH: modules[m].orphanDe, module: moduleIds[m] ? "exists" : cliOk ? (apply ? "created" : "would be created") : "unknown" };
    if (cliOk && en > 0) {
      for (const [lang, file, n] of [[english, `${m}.en.json`, en], [DE, `${m}.${DE}.json`, de]]) {
        if (n === 0) continue;
        const f = path.join(dir, file);
        const v = blocks(["localization", "validate", "--module", m, "--language", lang, "--file", f]);
        if (v.error) { row[lang] = `invalid: ${v.error}`; continue; }
        const r = mutate(["localization", "push", "--module", m, "--language", lang, "--file", f, "--publish", "once"]);
        const created = r.created ?? r.data?.created;
        const updated = r.updated ?? r.data?.updated;
        row[lang] = r.error ? `failed: ${r.error}` : `${apply ? "sent" : "would send"} ${n}${created !== undefined ? ` (${created} new, ${updated ?? 0} changed)` : ""}`;
      }
      // 5. prune
      if (prune && moduleIds[m]) {
        const names = new Set(Object.keys(modules[m].en));
        const stale = [];
        for (let page = 1; page <= 50; page++) {
          const list = blocks(["localization", "key", "list", "--module-ids", moduleIds[m], "--page-size", "500", "--page-number", String(page)]);
          const found = rows(list);
          for (const k of found) {
            const name = field(k, "keyName", "key", "name");
            if (name && !names.has(name)) stale.push(field(k, "itemId", "id"));
          }
          if (found.length < 500) break;
        }
        const ids = stale.filter(Boolean);
        row.pruned = ids.length;
        if (ids.length) {
          const r = mutate(["localization", "key", "delete-keys", ...ids]);
          if (r.error) row.pruned = `failed: ${r.error}`;
        }
      }
    }
    report.modules[m] = row;
    say(`  ${m.padEnd(10)} ${String(en).padStart(4)} keys · de-CH ${de}${row.missingDeCH ? ` (${row.missingDeCH} missing)` : ""}${row.orphanDeCH ? ` · ${row.orphanDeCH} German without a call` : ""} · module ${row.module}`
      + `${row[english] ? ` · ${english}: ${row[english]}` : ""}${row[DE] ? ` · ${DE}: ${row[DE]}` : ""}${row.pruned !== undefined ? ` · pruned ${row.pruned}` : ""}`);
  }
  if (asJson) console.log(JSON.stringify(report, null, 2));
  const failed = Object.values(report.modules).some((r) => Object.values(r).some((v) => typeof v === "string" && /^(failed|invalid)/.test(v)))
    || report.steps.some((s) => s.error);
  process.exitCode = failed ? 1 : 0;
} finally {
  fs.rmSync(dir, { recursive: true, force: true });
}
