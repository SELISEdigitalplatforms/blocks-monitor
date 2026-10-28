#!/usr/bin/env node
/**
 * Alert recipients performance check (SELISEdigitalplatforms/blocks-monitor#256, spec §5, H17).
 *
 * Measures p50/p95 of the Alert recipients endpoints on a fixture of N editable monitors in a
 * DEDICATED project, built through the API (approved Q16 A): paused HTTP checks plus heartbeats,
 * people on 0+ monitors each, a few "All monitors" people, and no Blocks-services monitors (the
 * API can create those but not delete them). Requests are authenticated sequential calls with the
 * signed-in user's own session: 5 warm-up + 50 measured per operation (configurable).
 *
 * Modes (run from e2e/, after `npx playwright install chromium`):
 *   node perf/alert-recipients.perf.mjs setup     build the fixture (idempotent: tops it up)
 *   node perf/alert-recipients.perf.mjs measure   GET, "All monitors" save and delete
 *   node perf/alert-recipients.perf.mjs baseline  GetMonitorList?pageSize=10, SaveMonitor and
 *                                                 SaveHealth create (works at 168697d too)
 *   node perf/alert-recipients.perf.mjs cleanup   remove the fixture's people and monitors
 *
 * Environment (read from the shell, then e2e/.env.e2e):
 *   E2E_BASE_URL          Monitor app, e.g. https://dev-monitor.blocksdevelopers.com (required)
 *   E2E_USERNAME/PASSWORD the account that signs in (required; needs monitor::manage, health::manage)
 *   PERF_PROJECT_ID       the dedicated project's id in the app URL /app/{id}/... (required)
 *   PERF_PROJECT_KEY      that project's key (tenant id) the API is called with (required; the
 *                         script checks it against the key the app itself sends)
 *   PERF_PROJECT_NAME     the project's name on the console; used only when /app/{id} bounces
 *                         to the console and the project must be opened from its card
 *   PERF_API_URL          API origin, when it should differ from what the app calls
 *   PERF_MONITORS         fixture size N (default 500; 10 % heartbeats)
 *   PERF_PEOPLE           recipients in the fixture (default 200)
 *   PERF_ALL_PEOPLE       of those, "All monitors" people (default 4; at most 9, see below)
 *   PERF_WARMUP           warm-up requests per operation (default 5)
 *   PERF_ITERATIONS       measured requests per operation (default 50)
 *   PERF_CONCURRENCY      parallel requests while building or cleaning the fixture (default 4)
 *   PERF_ALLOW_EXISTING=1 run even though the project has monitors this script did not create
 *   PERF_HEADED=1         show the browser while signing in
 *
 * Deviations from the §5 fixture, forced by the limits the spec itself sets:
 *   - "All monitors" people default to 4, not 20: at most 10 are allowed, and the measured save
 *     adds one more person to every monitor, which therefore needs room.
 *   - Monitors hold PERF_ALL_PEOPLE + 0..(9 - PERF_ALL_PEOPLE) emails, so every monitor keeps one
 *     free slot and the measured "All monitors" save writes all N monitors (the worst case).
 *
 * The Worker reconciliation duration (§5) is not an API call: read it from the Worker log line
 * "Alert recipient reconciliation: … monitors updated in {ElapsedMs} ms." before and after.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import { chromium, request as playwrightRequest } from "@playwright/test";

const here = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(here, "..", ".env.e2e") });

const PREFIX = "perf-ar"; // every fixture monitor name and email starts with this
const GET_BUDGET_MS = 800;
const SAVE_BUDGET_MS = 1500;
const MAX_EMAILS_PER_MONITOR = 10;

function env(name, fallback) {
  const value = process.env[name]?.trim();
  if (value) return value;
  if (fallback !== undefined) return fallback;
  throw new Error(`${name} is not set.`);
}

function intEnv(name, fallback, min, max) {
  const value = Number(env(name, String(fallback)));
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new Error(`${name} must be an integer from ${min} to ${max}.`);
  }
  return value;
}

const config = {
  baseUrl: env("E2E_BASE_URL").replace(/\/$/, ""),
  projectId: env("PERF_PROJECT_ID"),
  projectKey: env("PERF_PROJECT_KEY"),
  projectName: process.env.PERF_PROJECT_NAME?.trim() || "",
  apiUrl: process.env.PERF_API_URL?.trim().replace(/\/$/, "") || "",
  monitors: intEnv("PERF_MONITORS", 500, 1, 500),
  people: intEnv("PERF_PEOPLE", 200, 1, 5000),
  allPeople: intEnv("PERF_ALL_PEOPLE", 4, 0, MAX_EMAILS_PER_MONITOR - 1),
  warmup: intEnv("PERF_WARMUP", 5, 0, 1000),
  iterations: intEnv("PERF_ITERATIONS", 50, 1, 10000),
  concurrency: intEnv("PERF_CONCURRENCY", 4, 1, 32),
  allowExisting: process.env.PERF_ALLOW_EXISTING === "1",
  headed: process.env.PERF_HEADED === "1",
};

// ---- Session ------------------------------------------------------------------------------------

/**
 * Signs in through the app (the same OIDC form the e2e suite uses), opens the project's Monitor
 * page and copies what the app sends with its own GetMonitorList call: the API origin, the
 * project key and the auth headers. Cookies come along through the browser storage state.
 */
async function openSession() {
  const browser = await chromium.launch({ headless: !config.headed });
  try {
    const context = await browser.newContext();
    const page = await context.newPage();
    await signIn(page);

    const captured = page.waitForRequest((r) => r.url().includes("/Monitor/GetMonitorList"), {
      timeout: 60_000,
    });
    await page.goto(`${config.baseUrl}/app/${config.projectId}/monitor`, {
      waitUntil: "domcontentloaded",
    });
    if (/\/app\/console\/?$/.test(new URL(page.url()).pathname) || (await isConsole(page))) {
      await openFromConsoleCard(page);
      await page.goto(`${config.baseUrl}/app/${config.projectId}/monitor`, {
        waitUntil: "domcontentloaded",
      });
    }
    const listRequest = await captured;

    const url = new URL(listRequest.url());
    const sentKey = url.searchParams.get("projectKey");
    if (sentKey !== config.projectKey) {
      throw new Error(
        `The app calls the API with projectKey "${sentKey}", not PERF_PROJECT_KEY ` +
          `"${config.projectKey}". Check PERF_PROJECT_ID and PERF_PROJECT_KEY.`,
      );
    }
    const apiBase = config.apiUrl || url.href.slice(0, url.href.indexOf("/Monitor/GetMonitorList"));
    const headers = {};
    for (const [name, value] of Object.entries(await listRequest.allHeaders())) {
      if (name === "authorization" || name.startsWith("x-")) headers[name] = value;
    }
    const api = await playwrightRequest.newContext({
      baseURL: `${apiBase}/`,
      extraHTTPHeaders: headers,
      storageState: await context.storageState(),
    });
    return { api, apiBase, close: () => browser.close() };
  } catch (error) {
    await browser.close();
    throw error;
  }
}

async function isConsole(page) {
  return page
    .getByRole("heading", { name: /Your Blocks Projects|Welcome to SELISE Blocks/ })
    .isVisible({ timeout: 5_000 })
    .catch(() => false);
}

async function signIn(page) {
  await page.goto(`${config.baseUrl}/login`, { waitUntil: "domcontentloaded" });
  if (await isConsole(page)) return;
  const loginButton = page.getByRole("button", { name: "Log in to your account" });
  if (await loginButton.isVisible({ timeout: 10_000 }).catch(() => false))
    await loginButton.click();
  const email = page.locator("#oidc-email").or(page.getByRole("textbox", { name: "Work Email" }));
  await email.waitFor({ state: "visible", timeout: 30_000 });
  await email.fill(env("E2E_USERNAME"));
  const password = page
    .locator("#oidc-password")
    .or(page.getByRole("textbox", { name: "Password" }));
  await password.waitFor({ state: "visible", timeout: 10_000 });
  await password.fill(env("E2E_PASSWORD"));
  await page.getByRole("button", { name: "Login", exact: true }).click();
  await page.waitForURL(/\/app\//, { timeout: 60_000 });
}

async function openFromConsoleCard(page) {
  if (!config.projectName) {
    throw new Error("/app/{id} opened the console; set PERF_PROJECT_NAME to open the project.");
  }
  const envButton = /Development|Testing|Staging|IAT|UAT|Production|Pre-Prod|Prod Shadow/;
  const card = page
    .locator("div")
    .filter({ has: page.getByText(config.projectName, { exact: true }) })
    .filter({ has: page.getByRole("button", { name: envButton }) })
    .last();
  await card.getByRole("button", { name: envButton }).first().click({ force: true });
  await page.waitForURL(/\/app\/[^/]+\/dashboard/, { timeout: 60_000 });
}

// ---- API ----------------------------------------------------------------------------------------

async function call(api, method, url, body) {
  const started = performance.now();
  const response = await api.fetch(url, {
    method,
    data: body,
    timeout: 120_000,
  });
  const ms = performance.now() - started;
  const text = await response.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    // reported below
  }
  if (!response.ok() || !json || json.isSuccess === false) {
    const message = json?.message ?? text.slice(0, 200);
    throw new Error(`${method} ${url} failed: HTTP ${response.status()} ${message}`);
  }
  return { ms, json };
}

const key = () => encodeURIComponent(config.projectKey);

const getRecipients = (api) => call(api, "GET", `Monitor/GetAlertRecipients?projectKey=${key()}`);

const saveRecipient = (api, email, allMonitors, monitorIds = []) =>
  call(api, "POST", "Monitor/SaveAlertRecipient", {
    projectKey: config.projectKey,
    email,
    allMonitors,
    monitorIds,
  });

const deleteRecipient = (api, email) =>
  call(api, "POST", "Monitor/DeleteAlertRecipient", { projectKey: config.projectKey, email });

const createHttpCheck = (api, name) =>
  call(api, "POST", "Monitor/SaveMonitor", {
    projectKey: config.projectKey,
    name,
    url: `https://example.com/${name}`,
    monitorType: null,
    protocolType: "HTTP",
    httpMethodType: "0",
    intervalInSeconds: 300,
    timeoutInSeconds: 30,
    isActive: false, // paused: the fixture never sends checks or alerts
    monitorSourceType: "OtherServices",
    customHttpHeaders: "{}",
    customPayload: "",
  });

const createHeartbeat = (api, name) =>
  call(api, "POST", "Health/SaveHealth", {
    projectKey: config.projectKey,
    name,
    isActive: false,
    intervalInSeconds: 3600,
    gracePeriodInSeconds: 3600,
    monitorSourceType: "OtherServices",
  });

const deleteMonitor = (api, monitor) =>
  monitor.kind === "Heartbeat"
    ? call(api, "DELETE", `Health/DeleteHealth?itemId=${encodeURIComponent(monitor.itemId)}`)
    : call(api, "DELETE", `Monitor/DeleteMonitor?itemId=${encodeURIComponent(monitor.itemId)}`);

/** Runs `task` over `items`, `config.concurrency` at a time. */
async function inParallel(items, task) {
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const index = next++;
      await task(items[index], index);
    }
  };
  await Promise.all(Array.from({ length: Math.min(config.concurrency, items.length) }, worker));
}

const personEmail = (i) => `${PREFIX}-p${String(i).padStart(4, "0")}@example.com`;
const allEmail = (i) => `${PREFIX}-all${i}@example.com`;
const measureEmail = (i) => `${PREFIX}-m${i}@example.com`;
const isFixtureEmail = (email) => email.startsWith(`${PREFIX}-`) && email.endsWith("@example.com");
const isFixtureMonitor = (monitor) => monitor.name.startsWith(`${PREFIX}-`);

// ---- Modes --------------------------------------------------------------------------------------

/** Refuses to touch a project that holds monitors this script did not create. */
function guardProject(data) {
  const foreign = data.monitors.filter((m) => !isFixtureMonitor(m));
  if (foreign.length > 0 && !config.allowExisting) {
    throw new Error(
      `Project ${config.projectKey} has ${foreign.length} monitors this script did not create ` +
        `(e.g. "${foreign[0].name}"). Use a dedicated project, or set PERF_ALLOW_EXISTING=1.`,
    );
  }
}

async function setup(api) {
  let { json } = await getRecipients(api);
  guardProject(json.data);
  const existing = new Set(json.data.monitors.map((m) => m.name));
  const heartbeats = Math.round(config.monitors / 10);
  const wanted = Array.from({ length: config.monitors }, (_, i) => ({
    name: `${PREFIX}-${i < heartbeats ? "hb" : "http"}-${String(i).padStart(4, "0")}`,
    heartbeat: i < heartbeats,
  })).filter((m) => !existing.has(m.name));

  console.log(`Creating ${wanted.length} monitors (${heartbeats} heartbeats in total)…`);
  await inParallel(wanted, (m) =>
    m.heartbeat ? createHeartbeat(api, m.name) : createHttpCheck(api, m.name),
  );

  ({ json } = await getRecipients(api));
  const monitors = json.data.monitors.filter(isFixtureMonitor);
  if (monitors.length < config.monitors) {
    throw new Error(`Only ${monitors.length} of ${config.monitors} fixture monitors are listed.`);
  }

  // Selected people: monitor i gets (i mod room) of them, so lists hold allPeople..9 emails.
  const room = MAX_EMAILS_PER_MONITOR - 1 - config.allPeople;
  const selectedPeople = Math.max(config.people - config.allPeople, 0);
  const assignments = Array.from({ length: selectedPeople }, () => []);
  let slot = 0;
  monitors.forEach((monitor, i) => {
    for (let k = 0; k < (room > 0 ? i % (room + 1) : 0); k++) {
      assignments[slot++ % selectedPeople]?.push(monitor.itemId);
    }
  });
  const already = new Set(json.data.recipients.map((r) => r.email));
  const people = assignments
    .map((monitorIds, i) => ({ email: personEmail(i), monitorIds }))
    .filter((p) => p.monitorIds.length > 0 && !already.has(p.email));
  console.log(`Adding ${people.length} people on selected monitors…`);
  // One at a time: people share monitors, and parallel saves of one monitor would conflict.
  for (const p of people) await saveRecipient(api, p.email, false, p.monitorIds);

  for (let i = 0; i < config.allPeople; i++) {
    if (!already.has(allEmail(i))) await saveRecipient(api, allEmail(i), true);
  }

  ({ json } = await getRecipients(api));
  const counts = json.data.monitors.filter(isFixtureMonitor).map((m) => m.emailCount);
  const average = counts.reduce((a, b) => a + b, 0) / counts.length;
  console.log(
    `Fixture ready: ${counts.length} monitors, ${json.data.recipients.length} recipients, ` +
      `${counts.filter((c) => c >= MAX_EMAILS_PER_MONITOR).length} full, ` +
      `emails per monitor ${Math.min(...counts)}–${Math.max(...counts)} (avg ${average.toFixed(1)}).`,
  );
}

function percentile(sorted, p) {
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[index];
}

function summarize(name, samples, budget) {
  const sorted = [...samples].sort((a, b) => a - b);
  const p50 = percentile(sorted, 50);
  const p95 = percentile(sorted, 95);
  return { name, n: samples.length, p50, p95, max: sorted.at(-1), budget, pass: p95 <= budget };
}

async function sample(label, run) {
  for (let i = 0; i < config.warmup; i++) await run(-1 - i);
  const samples = [];
  for (let i = 0; i < config.iterations; i++) samples.push(await run(i));
  process.stdout.write(`  ${label}: ${samples.length} samples\n`);
  return samples;
}

async function measure(api) {
  const { json } = await getRecipients(api);
  guardProject(json.data);
  const monitorCount = json.data.monitors.length;
  console.log(`Measuring on ${monitorCount} monitors, ${json.data.recipients.length} recipients…`);

  const getSamples = await sample("GetAlertRecipients", async () => (await getRecipients(api)).ms);

  // Each round adds a new person to all monitors, then removes them again.
  const saveSamples = [];
  const deleteSamples = [];
  const round = async (i) => {
    const email = measureEmail(i < 0 ? `w${-i}` : i);
    const saved = await saveRecipient(api, email, true);
    const result = saved.json.data;
    if (result.added !== monitorCount || result.conflicted.length || result.denied.length) {
      throw new Error(
        `"All monitors" save wrote ${result.added} of ${monitorCount} monitors ` +
          `(${result.skippedFull.length} full, ${result.conflicted.length} conflicted, ` +
          `${result.denied.length} denied); the fixture needs one free slot per monitor.`,
      );
    }
    const removed = await deleteRecipient(api, email);
    if (removed.json.data.removed !== monitorCount) {
      throw new Error(`Delete removed ${removed.json.data.removed} of ${monitorCount} monitors.`);
    }
    if (i >= 0) {
      saveSamples.push(saved.ms);
      deleteSamples.push(removed.ms);
    }
    return saved.ms;
  };
  await sample("SaveAlertRecipient + DeleteAlertRecipient (All monitors)", round);

  report(`Alert recipients on ${monitorCount} monitors`, [
    summarize("GET /Monitor/GetAlertRecipients", getSamples, GET_BUDGET_MS),
    summarize("POST /Monitor/SaveAlertRecipient (All monitors)", saveSamples, SAVE_BUDGET_MS),
    summarize(
      "POST /Monitor/DeleteAlertRecipient (on every monitor)",
      deleteSamples,
      SAVE_BUDGET_MS,
    ),
  ]);
}

async function baseline(api) {
  const list = await sample(
    "GetMonitorList",
    async () =>
      (
        await call(
          api,
          "GET",
          `Monitor/GetMonitorList?projectKey=${key()}&pageNumber=0&pageSize=10`,
        )
      ).ms,
  );
  const created = [];
  const createSamples = async (label, create, kind) =>
    sample(label, async (i) => {
      const name = `${PREFIX}-base-${kind === "Heartbeat" ? "hb" : "http"}-${Date.now()}-${i}`;
      const { ms, json } = await create(api, name);
      created.push({ itemId: json.data.itemId, kind });
      return ms;
    });
  try {
    const saveMonitor = await createSamples("SaveMonitor (create)", createHttpCheck, "HttpCheck");
    const saveHealth = await createSamples("SaveHealth (create)", createHeartbeat, "Heartbeat");
    report("Baseline (existing endpoints)", [
      summarize("GET /Monitor/GetMonitorList?pageSize=10", list, GET_BUDGET_MS),
      summarize("POST /Monitor/SaveMonitor (create)", saveMonitor, SAVE_BUDGET_MS),
      summarize("POST /Health/SaveHealth (create)", saveHealth, SAVE_BUDGET_MS),
    ]);
  } finally {
    console.log(`Deleting the ${created.length} monitors the baseline created…`);
    await inParallel(created, (m) => deleteMonitor(api, m).catch(() => null));
  }
}

async function cleanup(api) {
  const { json } = await getRecipients(api);
  const people = json.data.recipients.map((r) => r.email).filter(isFixtureEmail);
  console.log(`Removing ${people.length} fixture people…`);
  // "All monitors" people first, so no new monitor picks them up meanwhile.
  people.sort((a, b) => Number(b.includes("-all")) - Number(a.includes("-all")));
  for (const email of people) await deleteRecipient(api, email);

  const monitors = json.data.monitors.filter(isFixtureMonitor);
  console.log(`Deleting ${monitors.length} fixture monitors…`);
  await inParallel(monitors, (m) => deleteMonitor(api, m));
}

function report(title, rows) {
  const ms = (v) => `${Math.round(v)}`;
  console.log(`\n### ${title}\n`);
  console.log(
    `Base URL ${config.baseUrl}, ${new Date().toISOString()}, warm-up ${config.warmup}.\n`,
  );
  console.log("| Operation | n | p50 (ms) | p95 (ms) | max (ms) | Budget p95 (ms) | Result |");
  console.log("|---|---|---|---|---|---|---|");
  for (const r of rows) {
    console.log(
      `| ${r.name} | ${r.n} | ${ms(r.p50)} | ${ms(r.p95)} | ${ms(r.max)} | ${r.budget} | ` +
        `${r.pass ? "pass" : "FAIL"} |`,
    );
  }
  if (rows.some((r) => !r.pass)) process.exitCode = 2;
}

// ---- Main ---------------------------------------------------------------------------------------

const modes = { setup, measure, baseline, cleanup };

async function main() {
  const mode = process.argv[2];
  if (!modes[mode]) {
    console.error(
      `Usage: node ${path.relative(process.cwd(), fileURLToPath(import.meta.url))} ` +
        `<${Object.keys(modes).join("|")}>  (see the header for the environment)`,
    );
    process.exit(1);
  }
  const sharedE2eProject = process.env.E2E_PROJECT_ID?.trim();
  if (sharedE2eProject && sharedE2eProject === config.projectId) {
    throw new Error("PERF_PROJECT_ID is the shared e2e project; use a dedicated project.");
  }
  const fixtureFile = path.resolve(here, "..", "fixtures", "monitor-project.json");
  if (fs.existsSync(fixtureFile)) {
    const shared = JSON.parse(fs.readFileSync(fixtureFile, "utf8"));
    if (shared?.itemId === config.projectId) {
      throw new Error(
        "PERF_PROJECT_ID is the e2e suite's shared project; use a dedicated project.",
      );
    }
  }

  const session = await openSession();
  try {
    console.log(`API ${session.apiBase}, project ${config.projectKey}, mode ${mode}.`);
    await modes[mode](session.api);
  } finally {
    await session.api.dispose();
    await session.close();
  }
}

main().catch((error) => {
  console.error(`[perf] ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
