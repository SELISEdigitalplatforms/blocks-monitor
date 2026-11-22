/**
 * The one versioning helper: every text change of a requirement, the objective
 * or an acceptance list writes an ItemVersion through writeVersion, in the
 * same command as the live-record update. Numbers are allocated with
 * insertWithNextNumber behind the UNIQUE (ProjectId, ItemKey, N) index, so two
 * saves from one base cannot both win.
 */
import { insertWithNextNumber, NumberingConflictError } from "../../../../src/domain/numbering";
import { versionsToPrune } from "../../../../src/domain/requirements";
import { loadVersions } from "./loaders";
import { OpError, type LaneOpContext, type Row } from "./ports";

type VersionOrigin = "person" | "engine";

function maxN(rows: readonly Row[]): number {
  return rows.reduce((m, r) => Math.max(m, typeof r.N === "number" ? r.N : 0), 0);
}

export async function currentVersion(ctx: LaneOpContext, itemKey: string): Promise<number> {
  return maxN(await loadVersions(ctx, itemKey, { withText: false }));
}

function versionRow(ctx: LaneOpContext, itemKey: string, n: number, text: string, origin: VersionOrigin): Record<string, unknown> {
  return { ProjectId: ctx.project.id, ItemKey: itemKey, N: n, Text: text, Origin: origin, CommentIds: [] };
}

export async function writeVersion(
  ctx: LaneOpContext,
  w: {
    itemKey: string;
    text: string;
    origin: VersionOrigin;
    baseVersion: number | null;
    seed?: { text: string; origin: VersionOrigin } | null;
    /** Versions the caller already loaded for this key in this request (loadVersions, text when ctx.retry). */
    versions?: Row[];
    /** A brand-new item: it has no versions, nothing is read. */
    empty?: boolean;
    /** The prune deletes run in the router's bookkeeping round instead of a round of their own. */
    deferPrune?: boolean;
  },
): Promise<{ n: number; row: Row; reused: boolean; seeded: Row | null; pruned: string[] }> {
  let versions = w.empty ? [] : (w.versions ?? (await loadVersions(ctx, w.itemKey, { withText: ctx.retry })));
  let current = maxN(versions);
  let base = w.baseVersion;
  let seeded: Row | null = null;

  // The item has no versions yet (sanitization wrote no v1): the current text becomes v1 first.
  let paired: { number: number; value: Row } | null = null;
  if (current === 0 && w.seed && w.seed.text && base === 0 && !ctx.retry) {
    // The seed (v1) and the new version (v2) are independent rows behind the unique index: one parallel round.
    const [s, m] = await Promise.allSettled([
      ctx.db.insert("ItemVersion", versionRow(ctx, w.itemKey, 1, w.seed.text, w.seed.origin)),
      ctx.db.insert("ItemVersion", versionRow(ctx, w.itemKey, 2, w.text, w.origin)),
    ]);
    if (s.status === "fulfilled" && m.status === "fulfilled") {
      seeded = s.value;
      paired = { number: 2, value: m.value };
      versions = [s.value];
      current = 1;
      base = 1;
    } else {
      // Someone else wrote first: undo what landed here and report the conflict.
      if (m.status === "fulfilled") await ctx.db.remove("ItemVersion", m.value.ItemId);
      if (s.status === "fulfilled") await ctx.db.remove("ItemVersion", s.value.ItemId);
      const failure = s.status === "rejected" ? s.reason : (m as PromiseRejectedResult).reason;
      if (!ctx.db.isDuplicateKey(failure)) throw failure;
      throw new OpError("conflict", "version.stale", { current: await currentVersion(ctx, w.itemKey) });
    }
  } else if (current === 0 && w.seed && w.seed.text) {
    try {
      seeded = await ctx.db.insert("ItemVersion", versionRow(ctx, w.itemKey, 1, w.seed.text, w.seed.origin));
    } catch (e) {
      if (!ctx.db.isDuplicateKey(e)) throw e;
      versions = await loadVersions(ctx, w.itemKey, { withText: ctx.retry });
      current = maxN(versions);
    }
    if (seeded) {
      current = 1;
      if (base === 0) base = 1;
      versions = [...versions, seeded];
    }
  }

  if (base !== null && base !== current) {
    if (ctx.retry) {
      // A retry of the same command: the version may already be there.
      const withText = await loadVersions(ctx, w.itemKey, { withText: true });
      const done = withText.find((r) => Number(r.N) > (w.baseVersion ?? 0) && r.Text === w.text && r.CreatedByUserId === ctx.actorUserId);
      if (done) return { n: Number(done.N), row: done, reused: true, seeded: null, pruned: [] };
      // Or only our own seed was written before the crash.
      const first = withText.find((r) => Number(r.N) === 1);
      if (w.baseVersion === 0 && current === 1 && first && first.CreatedByUserId === ctx.actorUserId) base = 1;
    }
    if (base !== current) throw new OpError("conflict", "version.stale", { current });
  } else if (base === null && ctx.retry) {
    const withText = await loadVersions(ctx, w.itemKey, { withText: true });
    const last = withText[withText.length - 1];
    if (last && last.Text === w.text && last.CreatedByUserId === ctx.actorUserId) {
      return { n: Number(last.N), row: last, reused: true, seeded: null, pruned: [] };
    }
  }

  let inserted: { number: number; value: Row };
  let firstRead = true;
  try {
    inserted = paired ?? await insertWithNextNumber<Row>({
      readMax:
        base !== null
          ? async () => base!
          : async () => {
              // the first attempt starts from the versions already in hand
              if (firstRead) {
                firstRead = false;
                return current;
              }
              return currentVersion(ctx, w.itemKey);
            },
      insert: (n) => ctx.db.insert("ItemVersion", versionRow(ctx, w.itemKey, n, w.text, w.origin)),
      isDuplicateKey: ctx.db.isDuplicateKey,
      maxAttempts: base !== null ? 1 : 5,
    });
  } catch (e) {
    if (e instanceof NumberingConflictError && base !== null) {
      throw new OpError("conflict", "version.stale", { current: await currentVersion(ctx, w.itemKey) });
    }
    throw e;
  }

  // Keep v1 and the latest 19.
  const all = [...versions, inserted.value];
  const drop = new Set(versionsToPrune(all.map((r) => Number(r.N))));
  const doomed = all.filter((r) => drop.has(Number(r.N)));
  if (doomed.length > 0) {
    const prune = () => Promise.all(doomed.map((r) => ctx.db.remove("ItemVersion", r.ItemId)));
    if (w.deferPrune) ctx.deps.after(prune);
    else await prune();
  }
  const pruned = doomed.map((r) => r.ItemId);
  return { n: inserted.number, row: inserted.value, reused: false, seeded, pruned };
}
