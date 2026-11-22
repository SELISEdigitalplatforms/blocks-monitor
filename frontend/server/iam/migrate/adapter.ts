// Readers and writers of the migration: the Factory's RBAC rows (Data Gateway, service identity) and IAM through
// iam-core's module (server/iam/iamAdmin.ts), plus two reads only the migration needs (every IAM user id, and whether
// multi-organization mode is on: with it off, IAM refuses every organization call with multi_org_disabled).
import type { RawGateway, Row } from "../../../functions/_lib/gateway";
import { f } from "../../../functions/_lib/filter";
import type { SdkClient } from "../../../functions/_lib/sdk";
import { MEMBERSHIP_STATUSES, WORKSPACE_STATUSES } from "../../../src/domain/tenancy";
import { IamAdminError, type IamAdminApi } from "../../../functions/_lib/iamAdmin";
import type { FactoryLinkWriter, IamAdminPort } from "./apply";
import { sortedUnique, type FactorySnapshot, type IamOrganizationRecord, type IamSnapshot, type IamUserAccess } from "./model";

const rec = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const str = (v: unknown): string => (typeof v === "string" ? v : "");
const strs = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);

/* ------------------------------------------------------------------ Factory side */

const ROLE_FIELDS = ["Key", "Name", "Description", "Permissions", "IsBuiltIn"] as const;

async function withFallback(primary: () => Promise<Row[]>, fallback: () => Promise<Row[]>): Promise<{ rows: Row[]; primary: boolean }> {
  try {
    return { rows: await primary(), primary: true };
  } catch {
    return { rows: await fallback(), primary: false };
  }
}

/** Every Factory RBAC row the migration needs (the gateway has no "all rows" filter: status/flag partitions cover them). */
export async function readFactorySnapshot(raw: RawGateway): Promise<FactorySnapshot> {
  const bothFlags = async (schema: string, fields: readonly string[]) =>
    (await Promise.all([true, false].map((v) => raw.findAll(schema, { where: f.eq("IsBuiltIn", v), fields, max: 5000 })))).flat();
  const [platformRoles, assignments, workspaces, workspaceRoles, memberships] = await Promise.all([
    withFallback(() => bothFlags("PlatformRole", [...ROLE_FIELDS, "Scope"]), () => bothFlags("PlatformRole", ROLE_FIELDS)),
    raw.findAll("PlatformRoleAssignment", { where: f.eq("Status", "active"), fields: ["UserId", "RoleKey", "Status"], max: 5000 }),
    withFallback(
      () => raw.findAll("Workspace", { where: f.in("Status", [...WORKSPACE_STATUSES]), fields: ["ItemId", "WorkspaceId", "Name", "Status", "IamOrganizationId"], max: 5000 }),
      () => raw.findAll("Workspace", { where: f.in("Status", [...WORKSPACE_STATUSES]), fields: ["ItemId", "WorkspaceId", "Name", "Status"], max: 5000 }),
    ),
    bothFlags("WorkspaceRole", ["WorkspaceId", ...ROLE_FIELDS]),
    raw.findAll("Membership", { where: f.in("Status", [...MEMBERSHIP_STATUSES]), fields: ["WorkspaceId", "UserId", "RoleKey", "Status"], max: 5000 }),
  ]);
  return {
    platformRoles: platformRoles.rows.map((r) => ({
      key: str(r.Key),
      name: str(r.Name),
      description: str(r.Description),
      permissions: strs(r.Permissions),
      isBuiltIn: r.IsBuiltIn === true,
      scope: r.Scope === "organization" ? "organization" : "platform",
    })),
    assignments: assignments.map((r) => ({ userId: str(r.UserId), roleKey: str(r.RoleKey), status: str(r.Status) })),
    workspaces: workspaces.rows.map((r) => ({
      itemId: str(r.ItemId),
      workspaceId: str(r.WorkspaceId),
      name: str(r.Name),
      status: str(r.Status),
      iamOrganizationId: str(r.IamOrganizationId) || null,
    })),
    workspaceRoles: workspaceRoles.map((r) => ({
      workspaceId: str(r.WorkspaceId),
      key: str(r.Key),
      name: str(r.Name),
      description: str(r.Description),
      permissions: strs(r.Permissions),
      isBuiltIn: r.IsBuiltIn === true,
    })),
    memberships: memberships.map((r) => ({ workspaceId: str(r.WorkspaceId), userId: str(r.UserId), roleKey: str(r.RoleKey), status: str(r.Status) })),
    workspaceLinkFieldReady: workspaces.primary,
  };
}

export function createLinkWriter(raw: RawGateway): FactoryLinkWriter {
  return {
    async linkWorkspace(itemId, organizationId) {
      await raw.update("Workspace", itemId, { IamOrganizationId: organizationId });
    },
  };
}

/** The PlatformSetting key the screens read the last parity check from (iam-ui: functions/admin/ops/iam/shared.ts). */
export const IAM_PARITY_KEY = "iam.parity";

export interface ParityRecord {
  at: string;
  ok: boolean;
  mismatches: number;
  url?: string;
}

/** Stores the last parity result as PlatformSetting iam.parity (ValueJson {at, ok, mismatches, url?}). */
export async function recordParity(raw: RawGateway, record: ParityRecord): Promise<void> {
  const ValueJson = JSON.stringify(record);
  const rows = await raw.findAll("PlatformSetting", { where: f.eq("Key", IAM_PARITY_KEY), fields: ["ItemId", "Key"], max: 10 });
  const id = str(rows[0]?.ItemId);
  if (id) {
    await raw.update("PlatformSetting", id, { ValueJson });
    return;
  }
  const res = await raw.insert("PlatformSetting", {
    Key: IAM_PARITY_KEY,
    Values: [],
    ValueJson,
    ReaderIds: [],
    Description: "The last parity check of the Factory roles against Blocks IAM (scripts/iam-parity.mjs).",
    RequestKey: `setting:${IAM_PARITY_KEY}`,
  });
  if (!res.created && res.itemId) await raw.update("PlatformSetting", res.itemId, { ValueJson });
}

/* ------------------------------------------------------------------ IAM side */

/** The IAM module (iam-core's createIamAdmin) plus the two reads only the migration needs. */
export function createMigrationPort(iam: IamAdminApi, client: () => Promise<SdkClient>): IamAdminPort {
  const checked = async <T>(work: (c: SdkClient) => Promise<T>): Promise<Record<string, unknown>> => {
    const body = rec(await work(await client()));
    const errors = body.errors && typeof body.errors === "object" ? Object.keys(body.errors as object) : [];
    if (body.isSuccess === false || errors.length) throw new IamAdminError("iam.unavailable");
    return body;
  };
  return {
    ...iam,
    async listUserIds() {
      const out = new Set<string>();
      for (let page = 0; page < 50; page += 1) {
        const body = await checked((c) => c.iam.users.list({ page, pageSize: 100 }));
        const rows = (Array.isArray(body.data) ? body.data : []).map(rec);
        const before = out.size;
        for (const r of rows) if (str(r.itemId)) out.add(str(r.itemId));
        const total = typeof body.totalCount === "number" ? body.totalCount : null;
        if (rows.length < 100 || out.size === before || (total !== null && out.size >= total)) break;
      }
      return [...out].sort();
    },
    async multiOrgEnabled() {
      return (await checked((c) => c.iam.organizations.getConfig())).isMultiOrgEnabled === true;
    },
  };
}

/** Runs fn over items, `limit` at a time. */
async function mapLimit<T, R>(items: readonly T[], limit: number, fn: (x: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = await fn(items[i]);
      }
    }),
  );
  return out;
}

/**
 * IAM as it is now: the catalogue, the roles, the organizations (none while multi-organization mode is off) and the
 * access of the given users (and, with allUsers, of every IAM user) platform-wide and in every known organization.
 */
export async function readIamSnapshot(
  port: IamAdminPort,
  factoryUserIds: readonly string[],
  o: { allUsers?: boolean; organizationIds?: readonly string[] } = {},
): Promise<IamSnapshot> {
  const [permissions, roles] = await Promise.all([port.listPermissions(), port.listRoles()]);
  const multiOrgEnabled = port.multiOrgEnabled ? await port.multiOrgEnabled() : true;
  const organizations: IamOrganizationRecord[] = multiOrgEnabled ? await port.listOrganizations() : [];
  const orgIds = multiOrgEnabled ? sortedUnique([...organizations.map((x) => x.id), ...(o.organizationIds ?? [])]) : [];
  const extra = o.allUsers && port.listUserIds ? await port.listUserIds() : [];
  const userIds = sortedUnique([...factoryUserIds, ...extra]);
  const accessList = await mapLimit(userIds, 4, async (id): Promise<IamUserAccess> => {
    try {
      return await port.userAccess(id, { organizationIds: orgIds });
    } catch (e) {
      if (rec(e).code === "iam.notFound") return { platform: { roles: [], permissions: [] }, orgs: {} };
      throw e;
    }
  });
  const access: Record<string, IamUserAccess> = {};
  userIds.forEach((id, i) => (access[id] = accessList[i]));
  return { permissions, roles, organizations, multiOrgEnabled, access };
}

/** Every user id the Factory's RBAC rows name. */
export function factoryUserIds(f: FactorySnapshot): string[] {
  return sortedUnique([...f.assignments.map((a) => a.userId), ...f.memberships.map((m) => m.userId)]);
}
