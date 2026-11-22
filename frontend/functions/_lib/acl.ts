// Workspace ACL: who may read ACL-schema rows (ReaderIds) and how a membership
// change restamps them (design 2.4).
import { OpError } from "./errors";
import { LIB_FIELDS } from "./fields";
import { f } from "./filter";
import type { RawGateway, Row } from "./gateway";
import { unmemoised } from "./memo";

/** [] unless the workspace is active; deduped and sorted. */
export function readerIdsFrom(workspaceStatus: unknown, activeMemberUserIds: readonly string[]): string[] {
  if (workspaceStatus !== "active") return [];
  return [...new Set(activeMemberUserIds)].sort();
}

export interface RestampReport {
  workspaceId: string;
  readerIds: string[];
  passes: number;
  schemas: Array<{ schema: string; ok: boolean; matched: number | null }>;
}

export interface RestampOptions {
  /** A pause in ms before an inline second pass. Unset (the ops): no pause, the caller schedules verify() with deps.after. */
  secondPassMs?: number;
  /** The reader list to stamp when the caller has already worked it out (the restamp then reads nothing). */
  readers?: readonly string[];
}

export interface RestampResult extends RestampReport {
  /** Reads the readers once more and rewrites every schema only when they changed meanwhile. Hand it to deps.after. */
  verify(): Promise<void>;
}

export interface AclService {
  readerIds(): Promise<string[]>;
  readerIdsOf(workspaceId: string): Promise<string[]>;
  stamp(row: Row): Promise<Row>;
  restamp(workspaceId: string, opts?: RestampOptions): Promise<RestampResult>;
}

export interface AclOptions {
  raw: RawGateway;
  workspaceId: string | null;
  callerUserId: string;
  preloaded?: { workspaceId: string; status: unknown; activeMemberUserIds: readonly string[] } | null;
  aclSchemas: readonly string[];
  sleep?: (ms: number) => Promise<void>;
}

const defaultSleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

function sameSet(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((x, i) => x === b[i]);
}

export function createAcl(opts: AclOptions): AclService {
  const { raw, workspaceId, callerUserId, preloaded, aclSchemas } = opts;
  const sleep = opts.sleep ?? defaultSleep;
  let memo: Promise<string[]> | null = null;

  async function readerIdsOf(id: string, gw: RawGateway = raw): Promise<string[]> {
    const [ws, members] = await Promise.all([
      gw.find("Workspace", {
        where: f.eq("WorkspaceId", id),
        fields: [...LIB_FIELDS.Workspace],
        page: 1,
        pageSize: 1,
      }),
      gw.findAll("Membership", {
        where: f.and(f.eq("WorkspaceId", id), f.eq("Status", "active")),
        fields: ["UserId"],
        max: 5000,
      }),
    ]);
    const row = ws.items[0];
    if (!row) throw new OpError("not_found");
    const readers = readerIdsFrom(
      row.Status,
      members.map((m) => String(m.UserId)),
    );
    if (row.Status === "active" && readers.length === 0) throw new OpError("conflict", "fn.noActiveMembers");
    return readers;
  }

  function readerIds(): Promise<string[]> {
    if (!workspaceId) return Promise.reject(new OpError("internal"));
    if (!memo) {
      memo =
        preloaded && preloaded.workspaceId === workspaceId
          ? Promise.resolve(readerIdsFrom(preloaded.status, preloaded.activeMemberUserIds)).then((r) => {
              if (preloaded.status === "active" && r.length === 0) throw new OpError("conflict", "fn.noActiveMembers");
              return r;
            })
          : readerIdsOf(workspaceId);
      memo.catch(() => {
        memo = null;
      });
    }
    return memo;
  }

  async function stamp(row: Row): Promise<Row> {
    if (!workspaceId) throw new OpError("internal");
    return {
      ...row,
      WorkspaceId: workspaceId,
      ReaderIds: await readerIds(),
      CreatedByUserId: callerUserId,
      UpdatedByUserId: callerUserId,
    };
  }

  async function restamp(ws: string, o?: RestampOptions): Promise<RestampResult> {
    let readers: string[] = o?.readers
      ? [...new Set(o.readers)].sort()
      : preloaded && preloaded.workspaceId === ws
        ? await readerIds()
        : await readerIdsOf(ws);
    const report: RestampReport = { workspaceId: ws, readerIds: readers, passes: 0, schemas: [] };
    // Every ACL schema in ONE parallel round; a failed schema is reported and the call fails once all have settled.
    const run = async (): Promise<void> => {
      report.passes += 1;
      const current = readers;
      const results = await Promise.all(
        aclSchemas.map(async (schema) => {
          try {
            const r = await raw.updateMany(schema, f.eq("WorkspaceId", ws), { ReaderIds: current });
            return { schema, ok: true, matched: r?.matched ?? null };
          } catch {
            return { schema, ok: false, matched: null };
          }
        }),
      );
      report.schemas = results;
      report.readerIds = current;
      const failed = results.filter((r) => !r.ok).map((r) => r.schema);
      if (failed.length > 0) throw new OpError("unavailable", undefined, { failed });
    };
    await run();
    const verify = async (): Promise<void> => {
      // A read that fails leaves the stamp as written; a member added or removed while the stamp ran is caught here.
      const again = await readerIdsOf(ws, unmemoised(raw)).catch(() => null);
      if (!again || sameSet(again, readers)) return;
      readers = again;
      await run();
    };
    if (o?.secondPassMs && o.secondPassMs > 0) {
      await sleep(o.secondPassMs);
      await verify();
    }
    return Object.assign(report, { verify });
  }

  return { readerIds, readerIdsOf, stamp, restamp };
}
