// The seed target (contract: frontend/seed/target.ts, owned by the seed): the local SQLite gateway with the hosted
// semantics, local IAM accounts and local Storage files. Loaded in the functions' module graph, so the seed's Filter
// objects (functions/_lib/filter) and the gateway's are the same instances.
//
// createUser makes the IAM account only (like the real IAM): activated, with the given password, IAM roles mf-user plus
// the platform IAM roles named in platformRoles ("mf-super-admin", "mf-platform-users"; "super-admin" / "platform-users"
// are accepted as short names; other values are ignored here, PlatformRoleAssignment rows are data the seed writes).
// The Account row is data as well: the seed writes it, or the app creates it at the person's first sign-in.
//
// putFile stores the bytes as a ready Storage file and answers its id: the value DocFile.StorageObjectId and
// Attachment.FileId carry.
import type { RawGateway } from "../../functions/_lib/gateway";
import { guardPaging } from "../../functions/_lib/paging";
import { createLocalGateway } from "./gateway.ts";
import { IAM_SUPER_ADMIN_ROLE, IAM_USER_ROLE, createUser, hashPassword } from "./iam/store.ts";
import type { LocalRuntime } from "./runtime.ts";
import { createFileRecord, ensureDirectory, writeBytes } from "./storage.ts";

// The shapes of frontend/seed/target.ts (kept structurally identical).
export interface SeedUser {
  key: string;
  email: string;
  displayName: string;
  password: string;
  platformRoles?: string[];
}
export interface SeedTarget {
  gw: RawGateway;
  createUser(u: SeedUser): Promise<{ userId: string }>;
  putFile(f: { name: string; contentType: string; bytes: Uint8Array }): Promise<{ fileId: string }>;
  now: Date;
}
export interface SeedSummary {
  users: number;
  workspaces: number;
  projects: number;
  rows: number;
  files: number;
}

const ROLE_ALIASES: Record<string, string> = {
  "mf-super-admin": IAM_SUPER_ADMIN_ROLE,
  "super-admin": IAM_SUPER_ADMIN_ROLE,
  superAdmin: IAM_SUPER_ADMIN_ROLE,
  "mf-platform-users": "mf-platform-users",
  "platform-users": "mf-platform-users",
};

export function iamRolesOf(platformRoles: readonly string[] | undefined): string[] {
  const extra = (platformRoles ?? []).map((r) => ROLE_ALIASES[r]).filter((r): r is string => typeof r === "string");
  return [...new Set([IAM_USER_ROLE, ...extra])];
}

export function splitName(displayName: string, email: string): { firstName: string; lastName: string } {
  const parts = displayName.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return { firstName: email.split("@")[0] ?? email, lastName: "" };
  if (parts.length === 1) return { firstName: parts[0]!, lastName: "" };
  return { firstName: parts.slice(0, -1).join(" "), lastName: parts[parts.length - 1]! };
}

export function createSeedTarget(rt: LocalRuntime, now = new Date()): SeedTarget & { createdUsers(): number; storedFiles(): number } {
  let users = 0;
  let files = 0;
  const gw = guardPaging(createLocalGateway(rt.store));
  return {
    gw,
    now,
    async createUser(u) {
      const { firstName, lastName } = splitName(u.displayName, u.email);
      const made = createUser(rt.db, {
        email: u.email,
        firstName,
        lastName,
        roles: iamRolesOf(u.platformRoles),
        passwordHash: await hashPassword(u.password),
      });
      users += 1;
      return { userId: made.userId };
    },
    async putFile(f) {
      const dir = ensureDirectory(rt.db, ensureDirectory(rt.db, "", "mf"), "seed");
      const rec = createFileRecord(rt.db, { directoryId: dir, name: f.name, mime: f.contentType, sizeBytes: f.bytes.length });
      writeBytes(rt.db, rt.paths.filesDir, rec.fileId, f.bytes);
      files += 1;
      return { fileId: rec.fileId };
    },
    createdUsers: () => users,
    storedFiles: () => files,
  };
}
