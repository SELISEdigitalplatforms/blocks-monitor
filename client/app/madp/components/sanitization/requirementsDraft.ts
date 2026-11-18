// The Requirements v1 editor's local draft: pure, no React. It holds what the person typed, decides what to send
// on the next autosave flush and folds the server's answer back in without losing text typed meanwhile.

export type DraftPriority = "must" | "nice" | "later";
export type DraftState = "saved" | "dirty" | "saving" | "error" | "conflict";

export const MAX_UPSERT = 50;
export const MAX_REQUIREMENTS = 300;
export const MAX_CRITERIA = 20;
const SORT_STEP = 1000;

export interface ServerRequirement {
  ItemId: string;
  Number?: number | null;
  Title?: string | null;
  Text?: string | null;
  Priority?: string | null;
  AcceptanceCriteria?: string[] | null;
  SortOrder?: number | null;
  LastUpdatedDate?: string | null;
  Key?: string | null;
  UpdatedByUserId?: string | null;
  CreatedByUserId?: string | null;
}

export interface ServerObjective {
  ItemId?: string;
  Statement?: string | null;
  HighLevelMd?: string | null;
  ArchitectureMd?: string | null;
  LastUpdatedDate?: string | null;
  UpdatedByUserId?: string | null;
  CreatedByUserId?: string | null;
}

export interface RowContent { title: string; description: string; priority: DraftPriority; criteria: string[] }
export interface ObjectiveContent { statement: string; highLevelDetails: string; architectureSummary: string }

/** What a save that timed out on the client sent: the content and the version it was based on. */
export interface PendingWrite { requestId: string; content: RowContent | ObjectiveContent; baseUpdatedAt: string | null }

export interface DraftRow {
  localKey: string;
  id: string | null;
  clientKey: string | null;
  number: number | null;
  title: string;
  description: string;
  priority: DraftPriority;
  criteria: string[];
  sortOrder: number;
  expectedUpdatedAt: string | null;
  rev: number;
  sentRev: number;
  state: DraftState;
  pendingWrite?: PendingWrite | null;
  failure?: string | null;
}

export interface DraftObjective {
  statement: string;
  highLevelDetails: string;
  architectureSummary: string;
  expectedUpdatedAt: string | null;
  rev: number;
  sentRev: number;
  state: DraftState;
  pendingWrite?: PendingWrite | null;
  failure?: string | null;
}

export interface Draft {
  rows: DraftRow[];
  objective: DraftObjective;
}

/** What one flush sent: the revision of every row (by localKey) and of the objective at send time, in upsert order. */
export interface SentKeys {
  rows: Record<string, number>;
  order: string[];
  objective: number | null;
}

export interface SaveArgs {
  projectId: string;
  objective?: { statement?: string; highLevelDetails?: string; architectureSummary?: string; expectedUpdatedAt?: string };
  upsert?: Array<{
    id?: string; clientKey?: string; title: string; description: string; priority: DraftPriority;
    acceptanceCriteria: string[]; sortOrder: number; expectedUpdatedAt?: string;
  }>;
  remove?: string[];
}

export interface SaveResult {
  objective?: ServerObjective | null;
  requirements?: ServerRequirement[];
  removed?: string[];
  conflicts?: Array<{ kind: "requirement" | "objective"; id?: string; clientKey?: string }>;
}

const priorityOf = (p: unknown): DraftPriority => (p === "nice" || p === "later" ? p : "must");

const normCriteria = (c: readonly string[]): string[] => c.map((x) => x.trim()).filter((x) => x !== "").slice(0, MAX_CRITERIA);

/** The saved content of a row, normalised the way a save sends it. */
export const contentOf = (r: Pick<DraftRow, "title" | "description" | "priority" | "criteria">): RowContent =>
  ({ title: r.title, description: r.description, priority: r.priority, criteria: normCriteria(r.criteria) });
export const serverContentOf = (s: ServerRequirement): RowContent =>
  ({ title: s.Title ?? "", description: s.Text ?? "", priority: priorityOf(s.Priority), criteria: normCriteria(s.AcceptanceCriteria ?? []) });
const objectiveContentOf = (o: Pick<DraftObjective, "statement" | "highLevelDetails" | "architectureSummary">): ObjectiveContent =>
  ({ statement: o.statement, highLevelDetails: o.highLevelDetails, architectureSummary: o.architectureSummary });
const serverObjectiveContentOf = (o: ServerObjective | null | undefined): ObjectiveContent =>
  ({ statement: o?.Statement ?? "", highLevelDetails: o?.HighLevelMd ?? "", architectureSummary: o?.ArchitectureMd ?? "" });

const norm = (v: unknown): string => JSON.stringify(typeof v === "string" ? v.trim() : v);
export function sameContent(a: RowContent | ObjectiveContent, b: RowContent | ObjectiveContent): boolean {
  const x = a as unknown as Record<string, unknown>;
  const y = b as unknown as Record<string, unknown>;
  const keys = Object.keys(x);
  if (keys.length !== Object.keys(y).length) return false;
  return keys.every((k) => k in y && (Array.isArray(x[k]) ? JSON.stringify((x[k] as string[]).map((c) => c.trim())) === JSON.stringify((y[k] as string[]).map((c) => c.trim())) : norm(x[k]) === norm(y[k])));
}

function rowFromServer(r: ServerRequirement, index: number): DraftRow {
  return {
    localKey: r.ItemId, id: r.ItemId, clientKey: null, number: r.Number ?? null,
    title: r.Title ?? "", description: r.Text ?? "", priority: priorityOf(r.Priority),
    criteria: [...(r.AcceptanceCriteria ?? [])], sortOrder: r.SortOrder ?? (index + 1) * SORT_STEP,
    expectedUpdatedAt: r.LastUpdatedDate ?? null, rev: 0, sentRev: 0, state: "saved", pendingWrite: null, failure: null,
  };
}

function objectiveFromServer(o: ServerObjective | null | undefined): DraftObjective {
  return {
    statement: o?.Statement ?? "", highLevelDetails: o?.HighLevelMd ?? "", architectureSummary: o?.ArchitectureMd ?? "",
    expectedUpdatedAt: o?.LastUpdatedDate ?? null, rev: 0, sentRev: 0, state: "saved", pendingWrite: null, failure: null,
  };
}

const bySort = (a: DraftRow, b: DraftRow) =>
  a.sortOrder - b.sortOrder || (a.number ?? Infinity) - (b.number ?? Infinity) || a.localKey.localeCompare(b.localKey);

const settled = (s: DraftState) => s === "saved";

export function draftFromServer(requirements: readonly ServerRequirement[], objective: ServerObjective | null | undefined): Draft {
  const rows = requirements.map(rowFromServer).sort(bySort);
  return { rows, objective: objectiveFromServer(objective) };
}

/** Folds fresh server rows in. Rows that are dirty, saving, failed or conflicted keep the person's text. */
export function mergeServer(draft: Draft, requirements: readonly ServerRequirement[], objective: ServerObjective | null | undefined): Draft {
  const server = new Map(requirements.map((r, i) => [r.ItemId, rowFromServer(r, i)]));
  const seen = new Set<string>();
  const rows: DraftRow[] = [];
  for (const row of draft.rows) {
    if (row.id === null) { rows.push(row); continue; }
    const fresh = server.get(row.id);
    seen.add(row.id);
    if (!fresh) { if (!settled(row.state)) rows.push(row); continue; }
    rows.push(settled(row.state) ? { ...fresh, localKey: row.localKey, clientKey: row.clientKey, rev: row.rev, sentRev: row.sentRev } : row);
  }
  for (const [id, fresh] of server) if (!seen.has(id) && !rows.some((r) => r.id === id) && !draft.rows.some((r) => r.id === id)) rows.push(fresh);
  const o = draft.objective;
  const nextObjective = settled(o.state) ? { ...objectiveFromServer(objective), rev: o.rev, sentRev: o.sentRev } : o;
  return { rows: rows.sort(bySort), objective: nextObjective };
}

const dueRow = (r: DraftRow) => r.state === "dirty" || r.state === "error";

/** A requirement that was never saved is held until it has a title (the row says so); nothing else holds a row back. */
export const NEEDS_TITLE_TEXT = "Add a title to save this requirement";
export const needsTitle = (r: Pick<DraftRow, "id" | "title">): boolean => r.id === null && r.title.trim() === "";

/** The args of the next flush, or null when nothing is waiting. A new row is held until it has a title. */
export function buildSavePayload(draft: Draft, removedIds: readonly string[], projectId: string): { args: SaveArgs; sentKeys: SentKeys } | null {
  const upsert: NonNullable<SaveArgs["upsert"]> = [];
  const sent: SentKeys = { rows: {}, order: [], objective: null };
  draft.rows.forEach((r, index) => {
    if (upsert.length >= MAX_UPSERT || !dueRow(r)) return;
    if (needsTitle(r)) return;
    const item: NonNullable<SaveArgs["upsert"]>[number] = {
      title: r.title, description: r.description, priority: r.priority,
      acceptanceCriteria: normCriteria(r.criteria),
      sortOrder: (index + 1) * SORT_STEP,
    };
    if (r.id !== null) item.id = r.id; else if (r.clientKey !== null) item.clientKey = r.clientKey;
    if (r.expectedUpdatedAt) item.expectedUpdatedAt = r.expectedUpdatedAt;
    upsert.push(item);
    sent.rows[r.localKey] = r.rev;
    sent.order.push(r.localKey);
  });
  const remove = removedIds.slice(0, MAX_UPSERT);
  const o = draft.objective;
  const objectiveDue = o.state === "dirty" || o.state === "error";
  if (upsert.length === 0 && remove.length === 0 && !objectiveDue) return null;
  const args: SaveArgs = { projectId };
  if (objectiveDue) {
    args.objective = { statement: o.statement, highLevelDetails: o.highLevelDetails, architectureSummary: o.architectureSummary };
    if (o.expectedUpdatedAt) args.objective.expectedUpdatedAt = o.expectedUpdatedAt;
    sent.objective = o.rev;
  }
  if (upsert.length) args.upsert = upsert;
  if (remove.length) args.remove = remove;
  return { args, sentKeys: sent };
}

/** Marks what a flush sent as saving. */
export function markSending(draft: Draft, sentKeys: SentKeys): Draft {
  return {
    rows: draft.rows.map((r) => (r.localKey in sentKeys.rows ? { ...r, state: "saving", sentRev: sentKeys.rows[r.localKey] } : r)),
    objective: sentKeys.objective === null ? draft.objective : { ...draft.objective, state: "saving", sentRev: sentKeys.objective },
  };
}

/** Folds a save answer in: ids, numbers and versions come from the server; the typed text stays. */
export function applySaveResult(draft: Draft, sentKeys: SentKeys, result: SaveResult): Draft {
  const returned = [...(result.requirements ?? [])];
  const conflicts = result.conflicts ?? [];
  const conflicted = new Set<string>();
  for (const c of conflicts) {
    if (c.kind !== "requirement") continue;
    const hit = draft.rows.find((r) => (c.id !== undefined && r.id === c.id) || (c.clientKey !== undefined && r.clientKey === c.clientKey));
    if (hit) conflicted.add(hit.localKey);
  }
  const used = new Set<ServerRequirement>();
  const match = new Map<string, ServerRequirement>();
  for (const key of sentKeys.order) {
    const row = draft.rows.find((r) => r.localKey === key);
    if (!row || conflicted.has(key)) continue;
    const byId = row.id !== null ? returned.find((s) => !used.has(s) && s.ItemId === row.id) : undefined;
    const hit = byId ?? (row.clientKey !== null ? returned.find((s) => !used.has(s) && s.Key === row.clientKey) : undefined);
    if (hit) { used.add(hit); match.set(key, hit); }
  }
  // last resort: a new row the server did not echo by key takes, by position, a returned row that belongs to no draft row
  const flushKeys = new Set(sentKeys.order.map((k) => draft.rows.find((r) => r.localKey === k)?.clientKey).filter((k): k is string => !!k));
  const rest = returned.filter((s) => !used.has(s) && !draft.rows.some((r) => r.id === s.ItemId) && (!s.Key || !flushKeys.has(s.Key)));
  for (const key of sentKeys.order) {
    const row = draft.rows.find((r) => r.localKey === key);
    if (!row || row.id !== null || match.has(key) || conflicted.has(key)) continue;
    const next = rest.shift();
    if (next) match.set(key, next);
  }
  const rows = draft.rows.map((r): DraftRow => {
    if (!(r.localKey in sentKeys.rows)) return r;
    if (conflicted.has(r.localKey)) return { ...r, state: "conflict", pendingWrite: null };
    const hit = match.get(r.localKey);
    if (!hit) return { ...r, state: r.rev === sentKeys.rows[r.localKey] ? "error" : "dirty" };
    return {
      ...r, id: hit.ItemId, number: hit.Number ?? r.number, expectedUpdatedAt: hit.LastUpdatedDate ?? r.expectedUpdatedAt,
      state: r.rev === sentKeys.rows[r.localKey] ? "saved" : "dirty", pendingWrite: null, failure: null,
    };
  });
  let objective = draft.objective;
  if (sentKeys.objective !== null) {
    if (conflicts.some((c) => c.kind === "objective")) objective = { ...objective, state: "conflict", pendingWrite: null };
    else objective = {
      ...objective, expectedUpdatedAt: result.objective?.LastUpdatedDate ?? objective.expectedUpdatedAt,
      state: objective.rev === sentKeys.objective ? "saved" : "dirty", pendingWrite: null, failure: null,
    };
  }
  return { rows, objective };
}

/**
 * A failed flush: what was in flight is marked failed; the text stays. When the failure is uncertain (the call timed
 * out and may have landed) what was sent is remembered, so the next read can recognise it as the person's own write.
 */
export function markFailed(draft: Draft, sentKeys: SentKeys, opts?: { reason?: string; uncertain?: { requestId: string; args: SaveArgs } }): Draft {
  const reason = opts?.reason ?? null;
  const u = opts?.uncertain;
  const rows = draft.rows.map((r) => {
    if (!(r.localKey in sentKeys.rows)) return r;
    let next = r;
    if (r.state === "saving") next = { ...r, state: "error", failure: reason };
    if (u) {
      const item = u.args.upsert?.[sentKeys.order.indexOf(r.localKey)];
      if (item) {
        next = { ...next, pendingWrite: {
          requestId: u.requestId, baseUpdatedAt: item.expectedUpdatedAt ?? null,
          content: { title: item.title, description: item.description, priority: item.priority, criteria: item.acceptanceCriteria },
        } };
      }
    }
    return next;
  });
  let objective = draft.objective;
  if (sentKeys.objective !== null) {
    if (objective.state === "saving") objective = { ...objective, state: "error", failure: reason };
    const o = u?.args.objective;
    if (u && o) {
      objective = { ...objective, pendingWrite: {
        requestId: u.requestId, baseUpdatedAt: o.expectedUpdatedAt ?? null,
        content: { statement: o.statement ?? "", highLevelDetails: o.highLevelDetails ?? "", architectureSummary: o.architectureSummary ?? "" },
      } };
    }
  }
  return { rows, objective };
}

/**
 * Called on every fresh server read. A row or the objective that has a timed-out write, or that is in conflict, is
 * checked against the server: if the server holds the person's own write it is adopted (new version, never a conflict);
 * if the write did not land it is sent again; only different content by someone else stays a conflict.
 */
export function resolveAfterRead(draft: Draft, requirements: readonly ServerRequirement[], objective: ServerObjective | null | undefined, me: string | null): Draft {
  const mine = (u: string | null | undefined) => !u || u === me;
  const claimed = new Set(draft.rows.map((r) => r.id).filter((id): id is string => id !== null));
  const rows = draft.rows.map((r): DraftRow => {
    const pw = r.pendingWrite ?? null;
    if (r.state === "saving" || (!pw && r.state !== "conflict")) return r;
    let server: ServerRequirement | undefined;
    if (r.id !== null) server = requirements.find((s) => s.ItemId === r.id);
    else if (pw) {
      server = requirements.find((s) => !claimed.has(s.ItemId) && sameContent(serverContentOf(s), pw.content as RowContent) && (!s.CreatedByUserId || s.CreatedByUserId === me));
    }
    if (!server) return pw ? { ...r, pendingWrite: null } : r;
    if (pw && r.id !== null && r.state !== "conflict" && (server.LastUpdatedDate ?? null) === pw.baseUpdatedAt) return { ...r, pendingWrite: null };
    const sc = serverContentOf(server);
    const own = mine(server.UpdatedByUserId) && ((pw !== null && sameContent(sc, pw.content as RowContent)) || sameContent(sc, contentOf(r)));
    if (!own) return { ...r, state: "conflict", pendingWrite: null };
    claimed.add(server.ItemId);
    return {
      ...r, id: server.ItemId, number: server.Number ?? r.number, expectedUpdatedAt: server.LastUpdatedDate ?? null,
      pendingWrite: null, failure: null, state: sameContent(contentOf(r), sc) ? "saved" : "dirty",
    };
  });
  let obj = draft.objective;
  const pw = obj.pendingWrite ?? null;
  if (obj.state !== "saving" && (pw || obj.state === "conflict")) {
    const lastUpdated = objective?.LastUpdatedDate ?? null;
    if (pw && obj.state !== "conflict" && lastUpdated === pw.baseUpdatedAt) obj = { ...obj, pendingWrite: null };
    else if (!objective) obj = pw ? { ...obj, pendingWrite: null } : obj;
    else {
      const sc = serverObjectiveContentOf(objective);
      const own = mine(objective.UpdatedByUserId) && ((pw !== null && sameContent(sc, pw.content as ObjectiveContent)) || sameContent(sc, objectiveContentOf(obj)));
      obj = own
        ? { ...obj, expectedUpdatedAt: lastUpdated, pendingWrite: null, failure: null, state: sameContent(objectiveContentOf(obj), sc) ? "saved" : "dirty" }
        : { ...obj, state: "conflict", pendingWrite: null };
    }
  }
  return { rows, objective: obj };
}

const touch = (r: DraftRow): DraftRow => ({ ...r, rev: r.rev + 1, state: r.state === "conflict" ? "conflict" : "dirty" });

export function editRow(draft: Draft, localKey: string, patch: Partial<Pick<DraftRow, "title" | "description" | "priority" | "criteria">>): Draft {
  return { ...draft, rows: draft.rows.map((r) => (r.localKey === localKey ? touch({ ...r, ...patch }) : r)) };
}

export function editObjective(draft: Draft, patch: Partial<Pick<DraftObjective, "statement" | "highLevelDetails" | "architectureSummary">>): Draft {
  const o = draft.objective;
  return { ...draft, objective: { ...o, ...patch, rev: o.rev + 1, state: o.state === "conflict" ? "conflict" : "dirty" } };
}

export function putRow(draft: Draft, row: DraftRow): Draft {
  return { ...draft, rows: draft.rows.map((r) => (r.localKey === row.localKey ? row : r)) };
}

/** Swaps a row with its neighbour; both rows are marked dirty and the sort order is renumbered. */
export function moveRow(draft: Draft, localKey: string, dir: "up" | "down"): Draft {
  const i = draft.rows.findIndex((r) => r.localKey === localKey);
  const j = dir === "up" ? i - 1 : i + 1;
  if (i < 0 || j < 0 || j >= draft.rows.length) return draft;
  const rows = [...draft.rows];
  [rows[i], rows[j]] = [rows[j], rows[i]];
  return { ...draft, rows: rows.map((r, k) => { const n = { ...r, sortOrder: (k + 1) * SORT_STEP }; return k === i || k === j ? touch(n) : n; }) };
}

/** Moves one acceptance criterion; returns the changed row (dirty). */
export function moveCriterion(row: DraftRow, index: number, dir: "up" | "down"): DraftRow {
  const j = dir === "up" ? index - 1 : index + 1;
  if (index < 0 || index >= row.criteria.length || j < 0 || j >= row.criteria.length) return row;
  const criteria = [...row.criteria];
  [criteria[index], criteria[j]] = [criteria[j], criteria[index]];
  return touch({ ...row, criteria });
}

/** Drops a row; returns the id to send in `remove` when it was already saved. */
export function removeRow(draft: Draft, localKey: string): { draft: Draft; removedId: string | null } {
  const row = draft.rows.find((r) => r.localKey === localKey);
  if (!row) return { draft, removedId: null };
  const rows = draft.rows.filter((r) => r.localKey !== localKey).map((r, k) => ({ ...r, sortOrder: (k + 1) * SORT_STEP }));
  return { draft: { ...draft, rows }, removedId: row.id };
}

/** "Keep my text": the local text stays, the version comes from the server, and the row is sent again. */
export function rebaseRow(draft: Draft, localKey: string, serverRow: ServerRequirement | null | undefined): Draft {
  return {
    ...draft,
    rows: draft.rows.map((r) => {
      if (r.localKey !== localKey) return r;
      const base = { ...r, state: "dirty" as const, pendingWrite: null, failure: null };
      if (!serverRow) return { ...base, id: null, number: null, expectedUpdatedAt: null, clientKey: r.clientKey ?? r.localKey };
      return { ...base, id: serverRow.ItemId, number: serverRow.Number ?? r.number, expectedUpdatedAt: serverRow.LastUpdatedDate ?? null };
    }),
  };
}

export function rebaseObjective(draft: Draft, serverObjective: ServerObjective | null | undefined): Draft {
  return {
    ...draft,
    objective: { ...draft.objective, expectedUpdatedAt: serverObjective?.LastUpdatedDate ?? null, state: "dirty", pendingWrite: null, failure: null },
  };
}

/** Replaces a row with the server's version (or drops it when the server no longer has it). */
export function reloadRow(draft: Draft, localKey: string, serverRow: ServerRequirement | null | undefined): Draft {
  if (!serverRow) return { ...draft, rows: draft.rows.filter((r) => r.localKey !== localKey) };
  return {
    ...draft,
    rows: draft.rows.map((r) => (r.localKey === localKey ? { ...rowFromServer(serverRow, 0), localKey, clientKey: r.clientKey, sortOrder: r.sortOrder, rev: r.rev, sentRev: r.rev } : r)),
  };
}

export function reloadObjective(draft: Draft, serverObjective: ServerObjective | null | undefined): Draft {
  const o = draft.objective;
  return { ...draft, objective: { ...objectiveFromServer(serverObjective), rev: o.rev, sentRev: o.rev } };
}

/** A new, untitled row at the end. It is not sent until it has a title. */
export function addRow(draft: Draft, clientKey: string): Draft {
  const last = draft.rows.reduce((m, r) => Math.max(m, r.sortOrder), 0);
  const row: DraftRow = {
    localKey: clientKey, id: null, clientKey, number: null, title: "", description: "", priority: "must", criteria: [],
    sortOrder: last + SORT_STEP, expectedUpdatedAt: null, rev: 1, sentRev: 0, state: "dirty", pendingWrite: null, failure: null,
  };
  return { ...draft, rows: [...draft.rows, row] };
}

/** One place where the editor holds text the server has not accepted yet. */
export type UnsavedItem =
  | { kind: "objective" }
  | { kind: "requirement"; localKey: string; number: number | null }
  | { kind: "removed"; count: number };

/** The objective, then every row the server has not accepted, then the removals not confirmed. A new row with no text is skipped. */
export function unsavedItems(draft: Draft, removedIds: readonly string[] = []): UnsavedItem[] {
  const items: UnsavedItem[] = [];
  if (draft.objective.state !== "saved") items.push({ kind: "objective" });
  for (const r of draft.rows) {
    if (r.state === "saved") continue;
    if (r.id === null && r.title.trim() === "" && r.description.trim() === "" && r.criteria.every((c) => c.trim() === "")) continue;
    items.push({ kind: "requirement", localKey: r.localKey, number: r.number });
  }
  if (removedIds.length > 0) items.push({ kind: "removed", count: removedIds.length });
  return items;
}

/** True while any row or the objective still has text the server has not accepted. */
export function hasUnsaved(draft: Draft, removedIds: readonly string[] = []): boolean {
  return unsavedItems(draft, removedIds).length > 0;
}
