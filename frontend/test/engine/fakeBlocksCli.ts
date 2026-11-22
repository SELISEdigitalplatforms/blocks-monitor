// A fake Blocks CLI for the sign-in tests: the login model of the real one in a few lines. Its store is the folder
// BLOCKS_CONFIG_DIR names (fake-state.json): `login` is a device login that prints "URL: …" and "Code: …", then either
// "Login done." (account tokens) or an expiry; `release repos list --project T` impersonates T, which keeps only T's
// session (the account tokens are not kept, as in the real store); `auth status --json` prints token STATES only.
// Every call is logged as "<BLOCKS_CONFIG_DIR>|<args>" to FAKE_CLI_LOG. FAKE_CLI_MODE: approve (default), expire,
// noaccess. `projects list` prints FAKE_PROJECTS (a Project/Gets answer as JSON; "[]" when unset).
import fs from "node:fs";
import path from "node:path";

/** Made-up token values the fake store holds; no message or log line may ever carry them. */
export const FAKE_TOKENS = ["fake-account-token-0123456789", "fake-project-token-0123456789"];
export const FAKE_CODES = ["WDJB-MJHT", "KPQR-ZXCV", "LMNO-PQRS"];

const SCRIPT = `
const fs = require("fs");
const path = require("path");
const a = process.argv.slice(2);
const store = process.env.BLOCKS_CONFIG_DIR || "";
if (process.env.FAKE_CLI_LOG) fs.appendFileSync(process.env.FAKE_CLI_LOG, store + "|" + a.join(" ") + "\\n");
const file = path.join(store || "/nonexistent", "fake-state.json");
const read = () => { try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return { projects: {}, logins: 0 }; } };
const write = (s) => fs.writeFileSync(file, JSON.stringify(s));
const flag = (k) => (a.indexOf(k) >= 0 ? a[a.indexOf(k) + 1] : "");
const mode = process.env.FAKE_CLI_MODE || "approve";
const s = read();
if (a[0] === "auth" && a[1] === "status") {
  const p = s.projects[flag("--project")];
  console.log(JSON.stringify({
    accountAccessToken: s.account ? "valid" : "missing", accountRefreshToken: s.account ? "valid" : "missing",
    projectAccessToken: p ? "valid" : "missing", projectRefreshToken: p ? "valid" : "missing",
  }));
} else if (a[0] === "login") {
  const codes = ${JSON.stringify(FAKE_CODES)};
  const code = codes[(s.logins || 0) % codes.length];
  s.logins = (s.logins || 0) + 1;
  write(s);
  console.log("Authorize this device:");
  // CLI 0.11 prints the device link as http://; FAKE_LOGIN_HTTP=1 reproduces that
  console.log("URL: " + (process.env.FAKE_LOGIN_HTTP === "1" ? "http" : "https") + "://iam.example.test/device?user_code=" + code);
  console.log("Code: " + code);
  console.log("Browser auto-open is unavailable on this machine. Open the URL above manually.");
  console.log("Waiting for approval...");
  setTimeout(() => {
    if (mode === "expire") { console.error("Device authorization expired."); process.exit(1); }
    const now = read();
    now.account = { accessToken: ${JSON.stringify(FAKE_TOKENS[0])} };
    write(now);
    console.log("Login done.");
    console.log("Run 'blocks use <tenantId>' to select one.");
  }, Number(process.env.FAKE_CLI_DELAY_MS || 300));
} else if (a[0] === "release" && a[1] === "repos") {
  const t = flag("--project");
  if (s.projects[t]) { console.log(JSON.stringify({ items: [] })); process.exit(0); }
  if (!s.account || mode === "noaccess") { console.error("No access to this project."); process.exit(1); }
  s.projects = { [t]: { accessToken: ${JSON.stringify(FAKE_TOKENS[1])} } };
  delete s.account;
  write(s);
  console.log(JSON.stringify({ items: [] }));
} else if (a[0] === "projects" && a[1] === "list") {
  console.log(process.env.FAKE_PROJECTS || "[]");
} else if (a[0] === "use") {
  if (!s.projects[a[1]]) process.exit(1);
  s.selected = a[1];
  write(s);
  console.log("Selected project tenant " + a[1]);
} else {
  console.log("{}");
}
`;

/** Writes the fake CLI into `dir`: run.cjs (a registry's cli.run_js) and an executable `blocks` (for PATH). */
export function writeFakeBlocksCli(dir: string): { runJs: string; bin: string } {
  fs.mkdirSync(dir, { recursive: true });
  const runJs = path.join(dir, "run.cjs");
  fs.writeFileSync(runJs, SCRIPT);
  const bin = path.join(dir, "blocks");
  fs.writeFileSync(bin, `#!/bin/sh\nexec "${process.execPath}" "${runJs}" "$@"\n`, { mode: 0o755 });
  return { runJs, bin };
}

/** A store the fake CLI reads as signed in to the tenant (its project session). */
export function signedIn(store: string, tenant: string): void {
  fs.mkdirSync(store, { recursive: true });
  fs.writeFileSync(path.join(store, "fake-state.json"), JSON.stringify({ projects: { [tenant]: { accessToken: FAKE_TOKENS[1] } }, logins: 0 }));
}

/** The calls the fake CLI logged: [store, args]. */
export function cliCalls(log: string): Array<[string, string]> {
  if (!fs.existsSync(log)) return [];
  return fs.readFileSync(log, "utf8").split("\n").filter(Boolean).map((l) => {
    const i = l.indexOf("|");
    return [l.slice(0, i), l.slice(i + 1)];
  });
}
