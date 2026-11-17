// The one place rows are written. Stamps every row the way functions/admin/ops/seed/apply.ts (and the scoped gateway)
// does: WorkspaceId + ReaderIds on workspace rows, CreatedByUserId / UpdatedByUserId, SeedKey where the schema has one,
// a unique RequestKey, and the seeded history dates CreatedDate / LastUpdatedDate (the local store keeps dates given on
// insert). IsExample is never set: seeded rows are ordinary rows.
import { capKey } from "../../functions/_lib/ids";
import { seedSchema } from "../../src/domain/seed";
import type { SeedTarget } from "../target";
import { Clock } from "./clock";
import { makeFile, type FileSpec, type MadeFile } from "./files";

export const SCENARIO = "factory";

/** Schemas without the workspace ACL pair (WorkspaceId + ReaderIds). */
const NOT_ACL = new Set(["Account", "AuditEvent", "Notification", "Operation", "PlatformRole", "PlatformRoleAssignment", "PlatformSetting"]);

export interface WsScope {
  key: string;
  id: string;
  /** Sorted ids of the active members (ReaderIds of every row of the workspace). */
  readers: string[];
}

export interface RowOpts {
  /** Unique per schema and workspace; becomes the SeedKey / RequestKey suffix. */
  key: string;
  ws?: WsScope | null;
  /** The acting person (CreatedByUserId, and UpdatedByUserId unless updatedBy is given). */
  by: string;
  /** CreatedDate (ISO). */
  at: string;
  updatedAt?: string;
  updatedBy?: string;
  /** An explicit RequestKey (the op's own format, e.g. `account:<userId>`). */
  requestKey?: string;
}

export interface StoredFile extends MadeFile {
  fileId: string;
}

type Row = Record<string, unknown>;

export class Seeder {
  rows = 0;
  files = 0;
  bytes = 0;
  private readonly ids = new Map<string, string>();
  readonly clock: Clock;

  constructor(readonly target: SeedTarget) {
    this.clock = new Clock(target.now);
  }

  private slot(schema: string, ws: WsScope | null | undefined, key: string): string {
    return `${schema}|${ws?.id ?? "-"}|${key}`;
  }

  /** Inserts one row and answers its ItemId. A row whose RequestKey already exists is reused (a repeated seed). */
  async insert(schema: string, fields: Row, o: RowOpts): Promise<string> {
    const acl = !NOT_ACL.has(schema);
    if (acl && !o.ws) throw new Error(`seed: ${schema} ${o.key} needs a workspace`);
    const row: Row = { ...fields };
    if (acl && o.ws) {
      row.WorkspaceId ??= o.ws.id;
      row.ReaderIds = [...o.ws.readers];
    }
    row.CreatedByUserId = o.by;
    row.UpdatedByUserId = o.updatedBy ?? o.by;
    let seedKey: string | null = null;
    if (seedSchema(schema)) {
      seedKey = schema === "Workspace" ? `${SCENARIO}:${o.key}` : `${o.ws?.id ?? "platform"}:${SCENARIO}:${o.key}`;
      row.SeedKey = seedKey;
    }
    row.RequestKey = capKey(o.requestKey ?? (seedKey ? `seed:${seedKey}` : `seed:${o.ws?.id ?? "platform"}:${SCENARIO}:${schema}:${o.key}`));
    row.CreatedDate = o.at;
    row.LastUpdatedDate = o.updatedAt ?? o.at;
    const res = await this.target.gw.insert(schema, row);
    if (!res.itemId) throw new Error(`seed: ${schema} ${o.key} was not stored`);
    if (res.created) this.rows += 1;
    const slot = this.slot(schema, o.ws, o.key);
    if (this.ids.has(slot) && this.ids.get(slot) !== res.itemId) throw new Error(`seed: duplicate key ${slot}`);
    this.ids.set(slot, res.itemId);
    return res.itemId;
  }

  /** Patches a row. `keepDate` is the LastUpdatedDate the row should keep (seeded history, not the time of the seed run). */
  async update(schema: string, itemId: string, patch: Row, keepDate?: string): Promise<void> {
    await this.target.gw.update(schema, itemId, keepDate ? { ...patch, LastUpdatedDate: keepDate } : patch);
  }

  /** The ItemId of an earlier row. */
  id(schema: string, ws: WsScope | null | undefined, key: string): string {
    const id = this.ids.get(this.slot(schema, ws, key));
    if (!id) throw new Error(`seed: no ${schema} ${key} yet`);
    return id;
  }

  has(schema: string, ws: WsScope | null | undefined, key: string): boolean {
    return this.ids.has(this.slot(schema, ws, key));
  }

  /** Generates the file's bytes and stores them (local Storage). */
  async file(spec: FileSpec): Promise<StoredFile> {
    const made = makeFile(spec, this.clock);
    const { fileId } = await this.target.putFile({ name: made.name, contentType: made.mime, bytes: made.bytes });
    this.files += 1;
    this.bytes += made.bytes.length;
    return { ...made, fileId };
  }
}
