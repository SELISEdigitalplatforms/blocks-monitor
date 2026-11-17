// The seed contract (frontend/seed/**). The local host implements SeedTarget (server/local/seedTarget.ts) on the SQLite
// gateway, the local IAM and local Storage; the seed tests implement it on the in-memory gateway.
import type { RawGateway } from "../functions/_lib/gateway";

export interface SeedUser { key: string; email: string; displayName: string; password: string; platformRoles?: string[] }
export interface SeedTarget {
  gw: RawGateway;                                   // the SQLite gateway, same semantics as Blocks
  createUser(u: SeedUser): Promise<{ userId: string }>;   // local IAM account (id format like Blocks IAM user ids)
  putFile(f: { name: string; contentType: string; bytes: Uint8Array }): Promise<{ fileId: string }>; // local storage, ids as the app's FilesService/DocFile/Attachment rows expect
  now: Date;
}
export interface SeedSummary { users: number; workspaces: number; projects: number; rows: number; files: number }
