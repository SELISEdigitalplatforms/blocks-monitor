// ReaderIds restamps: one write round for the whole workspace; the changed-meanwhile check runs in the bookkeeping round.
import { readerIdsFor } from "../../../../src/domain/tenancy";
import { holdersOf } from "./core";
import type { OpDeps } from "./ports";
import {
  ACCOUNT_FIELDS,
  MEMBERSHIP_FIELDS,
  PLATFORM_ROLE_ASSIGNMENT_FIELDS,
  PLATFORM_ROLE_FIELDS,
  PLATFORM_SETTING_FIELDS,
  SCHEMA,
  WORKSPACE_FIELDS,
  toRoleDef,
  type AccountRow,
  type MembershipRow,
  type PlatformRoleAssignmentRow,
  type PlatformRoleRow,
  type PlatformSettingRow,
  type WorkspaceRow,
} from "./records";

export const RESTAMP_SECOND_PASS_MS = 2000;

/** Inputs a caller already holds; whatever is missing is read, all in one parallel round. */
export interface RestampKnown {
  workspaceStatus?: string;
  memberships?: readonly { UserId: string; Status: string }[];
  deactivatedUserIds?: readonly string[];
}

/** Every deactivated account (a small set); the caller intersects it with the members. */
export function deactivatedAccounts(deps: OpDeps): Promise<AccountRow[]> {
  if (deps.identitySource === "iam") return Promise.resolve([]);
  return deps.gateway.listAll<AccountRow>(SCHEMA.account, {
    filter: { Status: "deactivated" },
    fields: ACCOUNT_FIELDS,
    maxItems: 5000,
  });
}

const MEMBER_PAGE = 100;

/**
 * Every active member of a workspace, never cut: page 1 gives the total, the remaining pages are read in one parallel
 * round, and rows that moved meanwhile are chased page by page until a short page.
 */
export async function activeMemberships(deps: OpDeps, workspaceId: string, fields: readonly string[]): Promise<MembershipRow[]> {
  const page = (n: number) =>
    deps.gateway.list<MembershipRow>(SCHEMA.membership, {
      filter: { WorkspaceId: workspaceId, Status: "active" },
      fields,
      sort: { field: "ItemId", dir: "asc" },
      page: n,
      pageSize: MEMBER_PAGE,
    });
  const byId = new Map<string, MembershipRow>();
  const take = (rows: readonly MembershipRow[]) => rows.forEach((r) => byId.set(r.ItemId, r));
  const first = await page(1);
  take(first.items);
  const pages = Math.ceil(first.totalCount / MEMBER_PAGE);
  let last = first.items.length;
  let next = 2;
  if (pages >= 2) {
    const rest = await Promise.all(Array.from({ length: pages - 1 }, (_, i) => page(i + 2)));
    rest.forEach((r) => take(r.items));
    last = rest[rest.length - 1].items.length;
    next = pages + 1;
  }
  while (last === MEMBER_PAGE || (byId.size < first.totalCount && last > 0)) {
    const more = await page(next++);
    take(more.items);
    last = more.items.length;
  }
  return [...byId.values()];
}

function readersOf(known: Required<RestampKnown>): string[] {
  return readerIdsFor({
    workspaceStatus: known.workspaceStatus,
    memberships: known.memberships.map((m) => ({ userId: m.UserId, status: m.Status })),
    deactivatedUserIds: known.deactivatedUserIds,
  });
}

async function fill(deps: OpDeps, workspaceId: string, known: RestampKnown, fresh: boolean): Promise<Required<RestampKnown>> {
  // The check reads other field lists than the first pass, so the request memo can never answer it with the
  // first pass's rows: it sees what the gateway holds now.
  const [workspaceStatus, memberships, deactivatedUserIds] = await Promise.all([
    known.workspaceStatus !== undefined
      ? known.workspaceStatus
      : deps.gateway
          .list<WorkspaceRow>(SCHEMA.workspace, {
            filter: { ItemId: workspaceId },
            fields: fresh ? ["ItemId", "Status"] : WORKSPACE_FIELDS,
            page: 1,
            pageSize: 1,
          })
          .then((r) => r.items[0]?.Status ?? "archived"),
    known.memberships ??
      activeMemberships(deps, workspaceId, fresh ? ["ItemId", "UserId", "Status"] : MEMBERSHIP_FIELDS),
    known.deactivatedUserIds ??
      (deps.identitySource === "iam" ? Promise.resolve([]) : fresh
        ? deps.gateway
            .listAll<AccountRow>(SCHEMA.account, { filter: { Status: "deactivated" }, fields: ["ItemId", "UserId", "Status"], maxItems: 5000 })
            .then((rows) => rows.map((a) => a.UserId))
        : deactivatedAccounts(deps).then((rows) => rows.map((a) => a.UserId))),
  ]);
  return { workspaceStatus, memberships, deactivatedUserIds };
}

export function sameReaders(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((x, i) => x === b[i]);
}

/** Writes the reader list to every workspace-owned schema in one parallel round (after one read round for what is missing). */
export async function stampReaders(
  deps: OpDeps,
  workspaceId: string,
  known: RestampKnown = {},
): Promise<{ readerIds: string[]; schemas: string[]; rows: number }> {
  const readerIds = readersOf(await fill(deps, workspaceId, known, false));
  const done = await deps.acl.restamp(workspaceId, readerIds);
  return { readerIds, schemas: done.schemas, rows: done.rows };
}

/** The readers as the gateway holds them now (other field lists than stampReaders, so the request memo cannot answer). */
export async function freshReaders(deps: OpDeps, workspaceId: string, alsoActive: readonly string[] = []): Promise<string[]> {
  const now = await fill(deps, workspaceId, {}, true);
  return readersOf({
    ...now,
    memberships: [...now.memberships, ...alsoActive.map((UserId) => ({ UserId, Status: "active" }))],
  });
}

/**
 * Sets the full reader list on every workspace-owned row. With the router's `after`, a check that re-reads the readers
 * once and rewrites only when they changed is scheduled for the bookkeeping round; without it (plain port hosts) the
 * old second pass runs inline after a pause.
 */
export async function restampWorkspace(
  deps: OpDeps,
  workspaceId: string,
  known: RestampKnown = {},
): Promise<{ readerCount: number; schemas: string[]; rows: number }> {
  const first = await stampReaders(deps, workspaceId, known);
  if (!deps.after) {
    await deps.clock.sleep(RESTAMP_SECOND_PASS_MS);
    const second = await deps.acl.restamp(workspaceId, first.readerIds);
    return { readerCount: first.readerIds.length, schemas: second.schemas, rows: first.rows + second.rows };
  }
  deps.after(async () => {
    const again = await freshReaders(deps, workspaceId).catch(() => null);
    if (again && !sameReaders(again, first.readerIds)) await deps.acl.restamp(workspaceId, again);
  });
  return { readerCount: first.readerIds.length, schemas: first.schemas, rows: first.rows };
}

/** Platform rows are readable by whoever holds any platform permission through an active assignment. */
export async function restampPlatform(deps: OpDeps): Promise<{ readerIds: string[] }> {
  const [assignments, roles, settings] = await Promise.all([
    deps.gateway.listAll<PlatformRoleAssignmentRow>(SCHEMA.platformRoleAssignment, { filter: {}, fields: PLATFORM_ROLE_ASSIGNMENT_FIELDS }),
    deps.gateway.listAll<PlatformRoleRow>(SCHEMA.platformRole, { filter: {}, fields: PLATFORM_ROLE_FIELDS }),
    deps.gateway.listAll<PlatformSettingRow>(SCHEMA.platformSetting, { filter: {}, fields: PLATFORM_SETTING_FIELDS }),
  ]);
  const readerIds = holdersOf(assignments, roles.map(toRoleDef), null);
  await stampPlatformRows(deps, readerIds, { roles, assignments, settings });
  return { readerIds };
}

/** Whether two reader lists hold the same people, whatever their order. */
const sameReaderSet = (a: readonly string[] | undefined, b: readonly string[]): boolean => {
  const have = new Set(a ?? []);
  return have.size === new Set(b).size && b.every((x) => have.has(x));
};

/**
 * Stamps the reader list on the platform rows the op already read, writing ONLY the rows whose ReaderIds differ (by
 * ItemId; the data gateway refuses an updateMany with an empty filter). One parallel round, one call per schema constant.
 */
export async function stampPlatformRows(
  deps: OpDeps,
  readerIds: readonly string[],
  rows: { roles: readonly PlatformRoleRow[]; assignments: readonly PlatformRoleAssignmentRow[]; settings: readonly PlatformSettingRow[] },
): Promise<void> {
  const stale = <T extends { ItemId: string; ReaderIds: string[] }>(list: readonly T[]) =>
    list.filter((r) => !sameReaderSet(r.ReaderIds, readerIds));
  const set = { ReaderIds: [...readerIds] };
  await Promise.all([
    ...stale(rows.roles).map((r) => deps.gateway.updateMany(SCHEMA.platformRole, { ItemId: r.ItemId }, set)),
    ...stale(rows.assignments).map((r) => deps.gateway.updateMany(SCHEMA.platformRoleAssignment, { ItemId: r.ItemId }, set)),
    ...stale(rows.settings).map((r) => deps.gateway.updateMany(SCHEMA.platformSetting, { ItemId: r.ItemId }, set)),
  ]);
}
