// The GitHub calls of a platform feedback ticket (REST for the screenshots, GraphQL for the board). Every failure is a
// GithubError with the HTTP status and a short kind; the writer turns it into a calm JobFailure. No token in any message.

export type FetchLike = (url: string, init: { method: string; headers: Record<string, string>; body?: string; signal?: AbortSignal }) => Promise<{
  status: number;
  ok: boolean;
  headers: { get(name: string): string | null };
  text(): Promise<string>;
}>;

export type GithubErrorKind = "auth" | "rateLimit" | "notFound" | "invalid" | "failed";

export class GithubError extends Error {
  constructor(
    readonly kind: GithubErrorKind,
    readonly status: number,
    detail: string,
  ) {
    super(detail);
    this.name = "GithubError";
  }
}

const API = "https://api.github.com";
const TIMEOUT_MS = 30_000;

function kindOfStatus(status: number, headers: { get(name: string): string | null }, body: string): GithubErrorKind {
  if (status === 401) return "auth";
  if (status === 429 || (status === 403 && (headers.get("x-ratelimit-remaining") === "0" || /rate limit/i.test(body)))) return "rateLimit";
  if (status === 403) return "auth";
  if (status === 404) return "notFound";
  if (status === 422) return "invalid";
  return "failed";
}

export interface Github {
  /** REST call; answers the parsed JSON (null for an empty body). 404 answers null when `allow404`. */
  rest(method: string, route: string, body?: unknown, o?: { allow404?: boolean }): Promise<Record<string, unknown> | null>;
  graphql<T = Record<string, unknown>>(query: string, variables: Record<string, unknown>): Promise<T>;
}

export function github(token: string, fetchImpl: FetchLike, signal?: AbortSignal): Github {
  const headers = {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "madp-factory-feedback",
    "Content-Type": "application/json",
  };
  const timed = () => {
    const t = AbortSignal.timeout(TIMEOUT_MS);
    return signal ? AbortSignal.any([signal, t]) : t;
  };
  async function call(method: string, url: string, body?: unknown) {
    let res: Awaited<ReturnType<FetchLike>>;
    try {
      res = await fetchImpl(url, { method, headers, ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: timed() });
    } catch (e) {
      if (signal?.aborted) throw e;
      throw new GithubError("failed", 0, `network: ${e instanceof Error ? e.name : "error"}`);
    }
    const text = await res.text().catch(() => "");
    return { res, text };
  }
  const parse = (text: string): Record<string, unknown> | null => {
    if (!text.trim()) return null;
    try {
      const v = JSON.parse(text) as unknown;
      return v && typeof v === "object" ? (v as Record<string, unknown>) : null;
    } catch {
      return null;
    }
  };
  return {
    async rest(method, route, body, o) {
      const { res, text } = await call(method, `${API}${route}`, body);
      if (res.status === 404 && o?.allow404) return null;
      if (!res.ok) throw new GithubError(kindOfStatus(res.status, res.headers, text), res.status, `${method} ${route.split("?")[0]} answered ${res.status}`);
      return parse(text);
    },
    async graphql<T>(query: string, variables: Record<string, unknown>) {
      const { res, text } = await call("POST", `${API}/graphql`, { query, variables });
      if (!res.ok) throw new GithubError(kindOfStatus(res.status, res.headers, text), res.status, `graphql answered ${res.status}`);
      const json = parse(text) ?? {};
      const errors = Array.isArray(json.errors) ? (json.errors as { type?: string; message?: string }[]) : [];
      if (errors.length) {
        const type = String(errors[0]?.type ?? "");
        const kind: GithubErrorKind =
          type === "RATE_LIMITED" ? "rateLimit"
          : type === "FORBIDDEN" || type === "INSUFFICIENT_SCOPES" ? "auth"
          : type === "NOT_FOUND" ? "notFound"
          : "failed";
        throw new GithubError(kind, res.status, `graphql ${type || "error"}: ${String(errors[0]?.message ?? "").slice(0, 160)}`);
      }
      return (json.data ?? {}) as T;
    },
  };
}

/** Each path segment encoded for a contents-API route. */
export const encodePath = (p: string) => p.split("/").map(encodeURIComponent).join("/");

/** Puts one file into the repo on the branch; a file already at the path (an earlier attempt) is replaced with its sha. */
export async function putRepoFile(gh: Github, o: { repo: string; branch: string; path: string; bytes: Uint8Array; message: string }): Promise<void> {
  const route = `/repos/${o.repo}/contents/${encodePath(o.path)}`;
  const content = Buffer.from(o.bytes).toString("base64");
  const existing = await gh.rest("GET", `${route}?ref=${encodeURIComponent(o.branch)}`, undefined, { allow404: true });
  const sha = existing && typeof existing.sha === "string" ? existing.sha : undefined;
  await gh.rest("PUT", route, { message: o.message, content, branch: o.branch, ...(sha ? { sha } : {}) });
}

export const FIND_ITEMS = `query($projectId: ID!) {
  node(id: $projectId) {
    ... on ProjectV2 {
      items(last: 50) {
        nodes {
          id
          fullDatabaseId
          content { ... on DraftIssue { body } }
          fieldValueByName(name: "Status") { ... on ProjectV2ItemFieldSingleSelectValue { optionId } }
        }
      }
    }
  }
}`;

export const ADD_DRAFT = `mutation($input: AddProjectV2DraftIssueInput!) {
  addProjectV2DraftIssue(input: $input) { projectItem { id fullDatabaseId } }
}`;

export const SET_STATUS = `mutation($input: UpdateProjectV2ItemFieldValueInput!) {
  updateProjectV2ItemFieldValue(input: $input) { projectV2Item { id } }
}`;

export interface BoardItem {
  id: string;
  fullDatabaseId: string | null;
  hasStatus: boolean;
}

/** The board item among the latest 50 whose draft body ends with the marker line, or null. */
export async function findItemWithMarker(gh: Github, projectId: string, marker: string): Promise<BoardItem | null> {
  type Node = { id?: string; fullDatabaseId?: string | number | null; content?: { body?: string } | null; fieldValueByName?: { optionId?: string } | null };
  const data = await gh.graphql<{ node?: { items?: { nodes?: (Node | null)[] } } | null }>(FIND_ITEMS, { projectId });
  if (!data.node) throw new GithubError("notFound", 200, "the feedback board was not found");
  for (const n of data.node.items?.nodes ?? []) {
    if (!n?.id || typeof n.content?.body !== "string") continue;
    if (!n.content.body.trimEnd().endsWith(marker)) continue;
    return { id: n.id, fullDatabaseId: n.fullDatabaseId == null ? null : String(n.fullDatabaseId), hasStatus: Boolean(n.fieldValueByName?.optionId) };
  }
  return null;
}

export async function addDraftIssue(gh: Github, o: { projectId: string; title: string; body: string }): Promise<BoardItem> {
  const data = await gh.graphql<{ addProjectV2DraftIssue?: { projectItem?: { id?: string; fullDatabaseId?: string | number | null } } }>(ADD_DRAFT, {
    input: { projectId: o.projectId, title: o.title, body: o.body },
  });
  const item = data.addProjectV2DraftIssue?.projectItem;
  if (!item?.id) throw new GithubError("failed", 200, "the draft issue was not created");
  return { id: item.id, fullDatabaseId: item.fullDatabaseId == null ? null : String(item.fullDatabaseId), hasStatus: false };
}

export async function setStatus(gh: Github, o: { projectId: string; itemId: string; fieldId: string; optionId: string }): Promise<void> {
  await gh.graphql(SET_STATUS, {
    input: { projectId: o.projectId, itemId: o.itemId, fieldId: o.fieldId, value: { singleSelectOptionId: o.optionId } },
  });
}
