// The shapes the IAM migration and parity check work on: today's Factory RBAC rows, and what Blocks IAM holds now.
// Pure: no I/O, no SDK. The readers (adapter.ts) fill these; plan.ts and parity.ts only compute.
import {
  IAM_PLATFORM_SUPER_ADMIN,
  IAM_RESOURCE,
  orgRoleSlug,
  platformRoleSlug,
  templateRoleSlug,
  workspaceMarker,
  workspaceShortId,
} from "../../../functions/_lib/iamAdmin";
import { PLATFORM_PERMISSIONS, WORKSPACE_PERMISSIONS } from "../../../src/domain/rbac";

/** A platform role or an organization role template (PlatformRole rows; Scope "organization" marks a template). */
export interface FactoryPlatformRole {
  key: string;
  name: string;
  description: string;
  permissions: string[];
  isBuiltIn: boolean;
  scope: "platform" | "organization";
}

export interface FactoryAssignment {
  userId: string;
  roleKey: string;
  status: string;
}

export interface FactoryWorkspace {
  /** Data Gateway ItemId of the row (needed to write IamOrganizationId back). */
  itemId: string;
  workspaceId: string;
  name: string;
  status: string;
  /** Workspace.IamOrganizationId; null when unset or when the tenant's schema lacks the field. */
  iamOrganizationId: string | null;
}

export interface FactoryWorkspaceRole {
  workspaceId: string;
  key: string;
  name: string;
  description: string;
  permissions: string[];
  isBuiltIn: boolean;
}

export interface FactoryMembership {
  workspaceId: string;
  userId: string;
  roleKey: string;
  status: string;
}

export interface FactorySnapshot {
  platformRoles: FactoryPlatformRole[];
  assignments: FactoryAssignment[];
  workspaces: FactoryWorkspace[];
  workspaceRoles: FactoryWorkspaceRole[];
  memberships: FactoryMembership[];
  /** False when the tenant's Workspace schema has no IamOrganizationId field yet (the link step cannot run). */
  workspaceLinkFieldReady: boolean;
}

export interface IamPermissionRecord {
  id: string;
  name: string;
  resource?: string;
  resourceGroup?: string;
  description?: string;
  /** Role slugs that hold the permission (IAM keeps the role link on the permission). */
  roles?: string[];
}

export interface IamRoleRecord {
  id?: string;
  slug: string;
  name: string;
  description?: string;
  /** Permission names the role holds (Factory keys for the roles this migration manages). */
  permissions: string[];
}

export interface IamOrganizationRecord {
  id: string;
  name: string;
  description?: string;
  /** The Factory workspace the organization belongs to, when the reader can tell. */
  workspaceId?: string;
}

export interface IamAccessSet {
  roles: string[];
  permissions: string[];
}

/** A user's IAM access: platform-wide (no organization) and per organization id. */
export interface IamUserAccess {
  platform: IamAccessSet;
  orgs: Record<string, IamAccessSet>;
}

export interface IamSnapshot {
  permissions: IamPermissionRecord[];
  roles: IamRoleRecord[];
  organizations: IamOrganizationRecord[];
  /** False when the tenant has multi-organization mode off (IAM refuses every organization call). */
  multiOrgEnabled: boolean;
  /** Current access of every user the plan touches, by user id. */
  access: Record<string, IamUserAccess>;
}

/** Today's super admin role on the verified token (the "safety" super admin in both modes). Never changed here. */
export const SUPER_ADMIN_SLUG = "mf-super-admin";
/** The IAM role that makes a person super admin when roles come from IAM (functions/_lib/iamAdmin.ts). */
export const IAM_SUPER_ADMIN_SLUG = IAM_PLATFORM_SUPER_ADMIN;
/** Where the Factory's IAM permissions are filed (resource and resource group). */
export const FACTORY_RESOURCE_GROUP = IAM_RESOURCE;
/** Every Factory permission key, platform first, in catalogue order. */
export const FACTORY_PERMISSION_KEYS: readonly string[] = [...PLATFORM_PERMISSIONS, ...WORKSPACE_PERMISSIONS];

/** Role slugs this migration creates and keeps in step; nothing outside these prefixes is ever changed. */
export const MANAGED_SLUG = /^mf-(platform|org|tpl)-[a-z0-9][a-z0-9-]*$/;

export function isManagedSlug(slug: string): boolean {
  return MANAGED_SLUG.test(slug);
}

// The slugs and the organization marker are iam-core's (functions/_lib/iamAdmin.ts), so the migration, the write-through
// of the ops and the resolver always agree.
export { orgRoleSlug, platformRoleSlug, templateRoleSlug, workspaceMarker, workspaceShortId };

/** The workspace an IAM organization belongs to: its own field, else the marker in its description. */
export function workspaceIdOfOrganization(org: IamOrganizationRecord): string | null {
  if (org.workspaceId) return org.workspaceId;
  const m = /\[mf-workspace:([^\]\s]+)\]/.exec(org.description ?? "");
  return m ? m[1] : null;
}

export const sortedUnique = (xs: Iterable<string>): string[] => [...new Set(xs)].filter(Boolean).sort();
