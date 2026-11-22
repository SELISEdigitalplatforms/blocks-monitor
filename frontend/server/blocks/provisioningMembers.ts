// Blocks project members (MF_BLOCKS_PROJECT_MEMBERS): people the engine makes members of the Blocks projects its
// provisioning account owns, so that they can approve a product's "Connect to Blocks" sign-in (blocksLogin.ts). The
// product store's session is an impersonation of the product's tenant, and Blocks IAM allows one for any user with a
// ProjectPeoples row for that tenant (blocks-iam AuthenticationService.IsTenantSharedWithUserAsync: membership only,
// accepted or not). Without the row the sign-in ends in "approved, but no session for the environment's tenant".
//
// The Blocks CLI has no command for project people, so the engine calls the Blocks OS People API that the Blocks portal's
// People page uses (blocks-os server/Api/Controllers/PeopleController.cs, [Route("[controller]/[action]")], served by the
// gateway under /os/v4 like the CLI's /os/v4/Project/* calls):
//   POST /os/v4/People/Gets    { projectGroupId, environmentIds: [tenantId], page, pageSize }
//        -> { isSuccess, peoples: [{ peopleDetails: { email }, sharedEnviroments: [{ tenantId }] }], peoplesTotalCount }
//   POST /os/v4/People/Invite  { groupId, invitations: { "<e-mail>": [{ tenantId, roles: ["user"] }] } }
//        -> { isSuccess, results: { "<e-mail>": "invited" | "access_granted" | "already_has_access" | ... } }
// Both are [ProjectPolicy] endpoints: the project's owner (the provisioning account that created it) may call them. An
// existing, active Blocks user gets the project row at once, before they accept the e-mail (blocks-os PeopleService
// ProcessInvitationForEmail); an unknown address only starts a Blocks sign-up (user_creation_requested), and an
// address that already has the row is answered "already_has_access" without a mail.
//
// The token: the provisioning account's ACCOUNT access token from its own CLI store, never a refresh and never a copy.
// First the CLI itself runs one harmless authenticated call in that store (`projects list --account <acct> --json`),
// which refreshes the account session in place when it is about to expire (and lists the project's group id); right
// after, the access token is read from <store>/tokens.json in this process, used for these calls only and dropped. A
// store whose account is in a project session (blocks use) has no account token: nothing is changed then, the step is
// skipped. The token, the e-mail addresses and the API's answers never reach a log line: the engine log says counts, a
// short fingerprint of the configured list and outcome names only. Every failure is logged and skipped; it never fails
// provisioning or a build (the normal sign-in card follows).
import { execFile, type ExecFileOptions } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import { serializedBlocks } from "./cliQueue.ts";
import { neutralCwd, provisioningStore } from "./provisioningCliContext.ts";
import { restoreSharedBlocksAccount, sharedBlocksSession, type SharedBlocksSession } from "./sharedCliSession.ts";

type Row = Record<string, unknown>;
const rec = (v: unknown): Row => (v && typeof v === "object" && !Array.isArray(v) ? (v as Row) : {});
const text = (v: unknown): string => (typeof v === "string" ? v.trim() : "");
/** Reads a key whatever its casing (the API answers camelCase; PascalCase is accepted too). */
const field = (row: Row, key: string): unknown => (key in row ? row[key] : row[key.charAt(0).toUpperCase() + key.slice(1)]);

export const PEOPLE_GETS = "/os/v4/People/Gets";
export const PEOPLE_INVITE = "/os/v4/People/Invite";
/** The role the Blocks portal invites with when it knows no other (blocks-os client invite-people-utils.ts). */
export const INVITE_ROLES = ["user"];
/** The CLI's default API (blocks-cli src/lib/config.ts DEFAULT_API_URL), when the account profile names none. */
const DEFAULT_API_URL = "https://api.seliseblocks.com";
const ACCOUNT_RE = /^[A-Za-z0-9_-]{1,64}$/;
const TENANT_RE = /^[A-Za-z][0-9a-f]{32}$/i;
const GROUP_RE = /^[A-Za-z0-9-]{8,64}$/;
const EMAIL_RE = /^[^\s@,;:"'<>()[\]\\]+@[^\s@,;:"'<>()[\]\\]+\.[^\s@,;:"'<>()[\]\\]+$/;
/** JWTs and opaque tokens: header-safe characters only. */
const TOKEN_RE = /^[A-Za-z0-9._~+/=-]{16,8192}$/;
/** The token must still be good for this long (the CLI refreshes at 60 s before expiry, so a fresh one has more). */
const MIN_LIFETIME_MS = 30_000;
const CLI_TIMEOUT_MS = 90_000;
const HTTP_TIMEOUT_MS = 20_000;
const PAGE_SIZE = 100;
const MAX_PAGES = 20;

export type ExecRun = (file: string, args: string[], options: ExecFileOptions) => Promise<{ stdout: string | Buffer }>;
const exec = promisify(execFile) as unknown as ExecRun;

/** MF_BLOCKS_PROJECT_MEMBERS: comma- (or semicolon-/space-) separated Blocks user e-mails, lower-cased (as Blocks
 *  stores them) and de-duplicated; malformed entries are dropped. Empty means the feature is off. */
export function projectMembers(value: string | undefined = process.env.MF_BLOCKS_PROJECT_MEMBERS): string[] {
  const out = new Set<string>();
  for (const part of String(value ?? "").split(/[,;\s]+/)) {
    const email = part.trim().toLowerCase();
    if (email && email.length <= 254 && EMAIL_RE.test(email)) out.add(email);
  }
  return [...out];
}

/** A short fingerprint of the member list for the engine log (the addresses themselves are never logged). */
export const membersTag = (members: string[]): string => createHash("sha256").update([...members].sort().join(",")).digest("hex").slice(0, 8);

export interface MembersTarget {
  /** The environment's Blocks tenant (D… for dev). */
  tenant: string;
  /** What the log line names (the registry name and environment, or a short tenant). */
  label: string;
  /** The provisioning account (MF_BLOCKS_PROVISIONING_ACCOUNT). */
  account: string;
  /** Its CLI login store. */
  store: string;
  /** The e-mails to make members (projectMembers()). */
  members: string[];
}

export interface MembersDeps {
  log: (line: string) => void;
  /** The CLI (promisified execFile); `blocks` on PATH. */
  run?: ExecRun;
  fetch?: typeof fetch;
  now?: () => number;
  sharedSession?: SharedBlocksSession;
}

export interface MembersResult {
  state: "off" | "done" | "skipped";
  /** Why it was skipped (a code, never data). */
  reason?: string;
  /** Configured people who were members already. */
  present: number;
  /** Invite calls made. */
  invited: number;
  /** The API's outcome per invite call, counted by name (invited, already_has_access, ...; failed calls as http_<n>). */
  outcomes: Record<string, number>;
}

class Skip extends Error {
  constructor(readonly reason: string) {
    super(reason);
  }
}

function readJson(file: string): Row {
  try {
    return rec(JSON.parse(fs.readFileSync(file, "utf8")));
  } catch (e) {
    throw new Skip((e as NodeJS.ErrnoException).code === "ENOENT" ? `${path.basename(file, ".json")}_missing` : `${path.basename(file, ".json")}_unreadable`);
  }
}

/** The account's profile in the store's config.json (no secrets): its API and whether a project is selected. */
function profileOf(store: string, account: string): { apiUrl: string; selected: boolean } {
  const profile = rec(rec(readJson(path.join(store, "config.json")).accounts)[account]);
  const raw = text(profile.apiUrl) || DEFAULT_API_URL;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Skip("api_url_invalid");
  }
  if (url.protocol !== "https:" || url.username || url.password) throw new Skip("api_url_invalid");
  return { apiUrl: url.origin, selected: Boolean(text(rec(profile.selectedProject).tenantId)) };
}

/** The account's token set in <store>/tokens.json (the CLI's file backend); only checked here, never returned whole. */
function accountTokens(store: string, account: string): Row {
  return rec(rec(rec(readJson(path.join(store, "tokens.json")).accounts)[account]).account);
}

/** The CLI's JSON answer; the child's own error (it carries stdout/stderr, which may hold account data) never leaves. */
async function cliJson(run: ExecRun, store: string, args: string[]): Promise<unknown> {
  let stdout = "";
  try {
    const windows = process.platform === "win32";
    const encoded = Buffer.from(JSON.stringify(args), "utf8").toString("base64");
    const script = `$a = ConvertFrom-Json ([Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${encoded}'))); & blocks.cmd @a; exit $LASTEXITCODE`;
    const r = await run(windows ? "powershell.exe" : "blocks", windows ? ["-NoProfile", "-NonInteractive", "-Command", script] : args, {
      cwd: neutralCwd(store),
      env: { ...process.env, BLOCKS_CONFIG_DIR: store, BLOCKS_STRICT_FLAGS: "1", BLOCKS_NO_UPDATE_CHECK: "1", NO_COLOR: "1", BROWSER: "true" },
      timeout: CLI_TIMEOUT_MS,
      maxBuffer: 4 * 1024 * 1024,
      windowsHide: true,
    });
    stdout = String(r.stdout ?? "");
  } catch {
    throw new Skip("cli_failed");
  }
  const start = stdout.search(/[[{]/);
  try {
    return JSON.parse(start >= 0 ? stdout.slice(start) : stdout);
  } catch {
    throw new Skip("cli_answer_unreadable");
  }
}

/** The tenant's group (and its exact tenant id) among the projects the account lists. */
function groupOf(listed: unknown, tenant: string): { groupId: string; tenantId: string } {
  const rows = Array.isArray(listed) ? listed : rec(listed).projects;
  if (!Array.isArray(rows)) throw new Skip("cli_answer_unreadable");
  for (const g of rows.map(rec)) {
    const projects = Array.isArray(g.projects) ? g.projects.map(rec) : [g];
    const p = projects.find((x) => text(x.tenantId).toLowerCase() === tenant.toLowerCase());
    if (!p) continue;
    const groupId = text(g.tenantGroupId) || text(p.tenantGroupId);
    if (!GROUP_RE.test(groupId)) throw new Skip("project_group_unknown");
    return { groupId, tenantId: text(p.tenantId) };
  }
  throw new Skip("project_not_listed");
}

type Post = (route: string, body: unknown) => Promise<Row>;

/** The e-mails of the people who have a row for the tenant (null when the list cannot be read, so every configured
 *  person is invited and the API answers "already_has_access" for members). A refused token ends the step. */
async function membersOf(post: Post, groupId: string, tenantId: string): Promise<Set<string> | null> {
  const found = new Set<string>();
  try {
    for (let page = 0; page < MAX_PAGES; page++) {
      const r = await post(PEOPLE_GETS, { projectGroupId: groupId, environmentIds: [tenantId], page, pageSize: PAGE_SIZE });
      const peoples = field(r, "peoples");
      if (field(r, "isSuccess") === false || !Array.isArray(peoples)) return null;
      for (const person of peoples.map(rec)) {
        const email = text(field(rec(field(person, "peopleDetails")), "email")).toLowerCase();
        const envs = field(person, "sharedEnviroments");
        const here = !Array.isArray(envs) || envs.map(rec).some((e) => text(field(e, "tenantId")).toLowerCase() === tenantId.toLowerCase());
        if (email && here) found.add(email);
      }
      const total = Number(field(r, "peoplesTotalCount"));
      if (peoples.length < PAGE_SIZE || !Number.isFinite(total) || (page + 1) * PAGE_SIZE >= total) return found;
    }
    return found;
  } catch (e) {
    if (e instanceof Skip && (e.reason === "http_401" || e.reason === "network")) throw e;
    return null;
  }
}

/** Makes every configured e-mail a member of the tenant's Blocks project, as the provisioning account. Never throws. */
export async function addProjectMembers(t: MembersTarget, d: MembersDeps): Promise<MembersResult> {
  const result: MembersResult = { state: "off", present: 0, invited: 0, outcomes: {} };
  if (!t.members.length) return result;
  const log = (line: string) => {
    try {
      d.log(line);
    } catch {
      /* a log that fails never fails the caller */
    }
  };
  const head = `blocks members ${t.label}: ${t.members.length} configured (list ${membersTag(t.members)})`;
  try {
    if (!ACCOUNT_RE.test(t.account)) throw new Skip("provisioning_account_not_set");
    if (!TENANT_RE.test(t.tenant)) throw new Skip("tenant_invalid");
    if (!fs.existsSync(t.store)) throw new Skip("provisioning_store_missing");
    // one CLI call at a time on this host (the provisioning and release calls share the queue), so nothing changes the
    // store between the CLI's refresh and the use of its token
    await serializedBlocks(async () => {
      const session = d.sharedSession;
      if (session?.account === t.account && session.store === t.store) await restoreSharedBlocksAccount(session);
      await ensure(t, d, result);
    });
    result.state = "done";
    const outcomes = Object.entries(result.outcomes).map(([k, n]) => `${k} ${n}`).join(", ");
    log(`${head}; ${result.present} already members; ${result.invited} invited${outcomes ? ` (${outcomes})` : ""}`);
  } catch (e) {
    result.state = "skipped";
    result.reason = e instanceof Skip ? e.reason : "unexpected_error";
    log(`${head}; not ensured (${result.reason}), continuing without it`);
  }
  return result;
}

async function ensure(t: MembersTarget, d: MembersDeps, result: MembersResult): Promise<void> {
  const now = d.now ?? Date.now;
  const doFetch = d.fetch ?? fetch;
  // a project session in the store has no account token; the step never changes the store's mode to get one
  const before = profileOf(t.store, t.account);
  if (before.selected) throw new Skip("account_in_project_session");
  const held = accountTokens(t.store, t.account);
  if (!text(held.refreshToken) && !text(held.accessToken)) throw new Skip("account_session_missing");
  // the CLI's own call: refreshes the account session in place when it is about to expire, and lists the project
  const { groupId, tenantId } = groupOf(await cliJson(d.run ?? exec, t.store, ["projects", "list", "--account", t.account, "--json"]), t.tenant);
  const { apiUrl, selected } = profileOf(t.store, t.account);
  if (selected) throw new Skip("account_in_project_session");
  const tokens = accountTokens(t.store, t.account);
  const token = text(tokens.accessToken);
  const key = text(tokens.accountTenant);
  const expires = Date.parse(text(tokens.expiresAt));
  if (!token || !key) throw new Skip("account_session_missing");
  if (!TOKEN_RE.test(token) || !/^[A-Za-z0-9-]{8,64}$/.test(key)) throw new Skip("account_session_unreadable");
  if (!Number.isFinite(expires) || expires - now() < MIN_LIFETIME_MS) throw new Skip("account_session_expired");

  const post: Post = async (route, body) => {
    let res: Response;
    try {
      res = await doFetch(`${apiUrl}${route}`, {
        method: "POST",
        headers: { Accept: "application/json", "Content-Type": "application/json", Authorization: `Bearer ${token}`, "x-blocks-key": key },
        body: JSON.stringify(body),
        // the token goes to the account's own API only, never along a redirect
        redirect: "error",
        signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
      });
    } catch {
      throw new Skip("network");
    }
    let doc: Row = {};
    try {
      doc = rec(JSON.parse(await res.text()));
    } catch {
      doc = {};
    }
    // a refused invite answers 400 with its outcome envelope; other errors carry the status only
    if (!res.ok && !(res.status === 400 && field(doc, "isSuccess") === false)) throw new Skip(`http_${res.status}`);
    return doc;
  };

  const present = await membersOf(post, groupId, tenantId);
  for (const email of t.members) {
    if (present?.has(email)) {
      result.present += 1;
      continue;
    }
    let outcome: string;
    try {
      const r = await post(PEOPLE_INVITE, { groupId, invitations: { [email]: [{ tenantId, roles: INVITE_ROLES }] } });
      const results = rec(field(r, "results"));
      const named = text(results[email] ?? Object.values(results)[0]);
      outcome = /^[a-z_]{1,40}$/.test(named) ? named : field(r, "isSuccess") === true ? "accepted" : "refused";
    } catch (e) {
      outcome = e instanceof Skip ? e.reason : "failed";
    }
    result.invited += 1;
    result.outcomes[outcome] = (result.outcomes[outcome] ?? 0) + 1;
  }
}

/** The engine's settings: MF_BLOCKS_PROJECT_MEMBERS, as MF_BLOCKS_PROVISIONING_ACCOUNT in its store. Off (no call, no
 *  log line) when no members are configured. Never throws. */
export async function addProjectMembersFromEnv(
  o: { tenant: string; label: string; log: (line: string) => void },
  env: Record<string, string | undefined> = process.env,
  deps: Omit<MembersDeps, "log"> = {},
): Promise<MembersResult> {
  try {
    const members = projectMembers(env.MF_BLOCKS_PROJECT_MEMBERS);
    const account = String(env.MF_BLOCKS_PROVISIONING_ACCOUNT ?? "").trim();
    return await addProjectMembers(
      { tenant: o.tenant, label: o.label, account, store: provisioningStore(env), members },
      { sharedSession: deps.run ? undefined : sharedBlocksSession(env), ...deps, log: o.log },
    );
  } catch {
    return { state: "skipped", reason: "unexpected_error", present: 0, invited: 0, outcomes: {} };
  }
}
