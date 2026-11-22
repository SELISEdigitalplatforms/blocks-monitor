/**
 * scope.save: features, stories and screen links of the draft scope (the scope.saveVersion of the plan).
 * Depends only on the scope env contract (./ports, ./records, ./shared) and src/domain by relative path.
 * ARCHITECTURE: the caller, membership and permission checks are the router's; WorkspaceId, ReaderIds and the
 * created / updated user ids are stamped by the scoped gateway, so no such key is read from the args. The gateway
 * assigns every ItemId; a new row is repeat-safe through its natural key (RequestKey) built from the clientKey.
 */
import {
  SCOPE_OP_PERMISSION,
  validateScopeChange,
  type DraftFeature,
  type DraftStory,
  type FeaturePriority,
} from "../../../../src/domain/scope";
import { isOwnLandedWrite } from "../../../_lib/stamps";
import { UniqueConflictError, fail, ok, parseArgs, type Row, type ScopeEnv, type ScopeOpDef, type ScopeReadEnv } from "./ports";
import {
  SCHEMA,
  featureFields,
  featureRec,
  milestoneRec,
  requirementRec,
  storyFields,
  storyRec,
  versionInsert,
  type FeatureRec,
  type StoryRec,
} from "./records";
import { latestVersion, loadProjectScopeRows, naturalKey, rawVersion, refuseUnlessDraftOpen, scopeStateOf } from "./shared";

type Obj = Record<string, unknown>;

export interface FeatureInput extends DraftFeature {
  expectedUpdatedAt?: string;
}
export interface StoryInput extends DraftStory {
  expectedUpdatedAt?: string;
}
export interface SaveArgs {
  projectId: string;
  upsertFeatures: FeatureInput[];
  removeFeatureIds: string[];
  upsertStories: StoryInput[];
  removeStoryIds: string[];
}

const PRIORITIES = ["must", "nice", "later", "excluded"];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ID_MAX = 128;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);
const wrong = (key: string) => ({ ok: false as const, messageKey: "input.wrongType", params: { key } });

function strList(v: unknown, max: number, itemMax: number): string[] | null {
  if (v === undefined || v === null) return [];
  if (!Array.isArray(v) || v.length > max) return null;
  return v.every((x) => typeof x === "string" && x.length <= itemMax) ? (v as string[]) : null;
}

/** The row identity: an existing id, or a clientKey (uuid) for a new row. Anything else about the identity is dropped. */
function identity(o: Obj, path: string): { id?: string; clientKey?: string } | ReturnType<typeof wrong> {
  if (typeof o.id === "string" && o.id !== "") {
    if (o.id.length > ID_MAX) return wrong(`${path}.id`);
    return { id: o.id };
  }
  if (typeof o.clientKey === "string" && UUID.test(o.clientKey)) return { clientKey: o.clientKey.toLowerCase() };
  return wrong(`${path}.clientKey`);
}

function parseFeature(raw: unknown, i: number): FeatureInput | ReturnType<typeof wrong> {
  const path = `upsertFeatures.${i}`;
  if (!isObj(raw)) return wrong(path);
  const who = identity(raw, path);
  if ("ok" in who) return who;
  if (typeof raw.name !== "string" || raw.name.length > 1000) return wrong(`${path}.name`);
  if (raw.description !== undefined && (typeof raw.description !== "string" || raw.description.length > 20000)) return wrong(`${path}.description`);
  if (typeof raw.priority !== "string" || !PRIORITIES.includes(raw.priority)) return wrong(`${path}.priority`);
  if (raw.excludedReason !== undefined && (typeof raw.excludedReason !== "string" || raw.excludedReason.length > 5000)) return wrong(`${path}.excludedReason`);
  if (raw.expectedUpdatedAt !== undefined && typeof raw.expectedUpdatedAt !== "string") return wrong(`${path}.expectedUpdatedAt`);
  const requirementIds = strList(raw.requirementIds, 100, ID_MAX);
  if (!requirementIds) return wrong(`${path}.requirementIds`);
  const screenIds = strList(raw.screenIds, 100, ID_MAX);
  if (!screenIds) return wrong(`${path}.screenIds`);
  if (typeof raw.sortOrder !== "number" || !Number.isInteger(raw.sortOrder) || raw.sortOrder < 0 || raw.sortOrder > 1_000_000) return wrong(`${path}.sortOrder`);
  return {
    ...who,
    ...(raw.expectedUpdatedAt !== undefined ? { expectedUpdatedAt: raw.expectedUpdatedAt as string } : {}),
    name: raw.name,
    description: (raw.description as string | undefined) ?? "",
    priority: raw.priority as FeaturePriority,
    ...(raw.excludedReason !== undefined ? { excludedReason: raw.excludedReason as string } : {}),
    requirementIds,
    screenIds,
    sortOrder: raw.sortOrder,
  };
}

function parseStory(raw: unknown, i: number): StoryInput | ReturnType<typeof wrong> {
  const path = `upsertStories.${i}`;
  if (!isObj(raw)) return wrong(path);
  const who = identity(raw, path);
  if ("ok" in who) return who;
  if (typeof raw.featureId !== "string" || raw.featureId === "" || raw.featureId.length > ID_MAX) return wrong(`${path}.featureId`);
  if (typeof raw.actor !== "string" || raw.actor.length > 1000) return wrong(`${path}.actor`);
  if (typeof raw.text !== "string" || raw.text.length > 20000) return wrong(`${path}.text`);
  if (raw.expectedUpdatedAt !== undefined && typeof raw.expectedUpdatedAt !== "string") return wrong(`${path}.expectedUpdatedAt`);
  const criteria = strList(raw.acceptanceCriteria, 100, 5000);
  if (!criteria) return wrong(`${path}.acceptanceCriteria`);
  if (typeof raw.sortOrder !== "number" || !Number.isInteger(raw.sortOrder) || raw.sortOrder < 0 || raw.sortOrder > 1_000_000) return wrong(`${path}.sortOrder`);
  return {
    ...who,
    ...(raw.expectedUpdatedAt !== undefined ? { expectedUpdatedAt: raw.expectedUpdatedAt as string } : {}),
    featureId: raw.featureId,
    actor: raw.actor,
    text: raw.text,
    acceptanceCriteria: criteria,
    sortOrder: raw.sortOrder,
  };
}

/** Unknown keys (author, workspace, reader or user stamps) are dropped; only the listed shape reaches the handler. */
function parseSave(raw: unknown) {
  const base = parseArgs(raw, {
    upsertFeatures: { type: "objects", optional: true, maxItems: 50 },
    removeFeatureIds: { type: "ids", optional: true, maxItems: 50 },
    upsertStories: { type: "objects", optional: true, maxItems: 100 },
    removeStoryIds: { type: "ids", optional: true, maxItems: 100 },
  });
  if (!base.ok) return base;
  const v = base.value;
  const upsertFeatures: FeatureInput[] = [];
  for (const [i, f] of ((v.upsertFeatures ?? []) as unknown[]).entries()) {
    const p = parseFeature(f, i);
    if ("ok" in p) return p;
    upsertFeatures.push(p);
  }
  const upsertStories: StoryInput[] = [];
  for (const [i, s] of ((v.upsertStories ?? []) as unknown[]).entries()) {
    const p = parseStory(s, i);
    if ("ok" in p) return p;
    upsertStories.push(p);
  }
  const value: SaveArgs = {
    projectId: v.projectId as string,
    upsertFeatures,
    removeFeatureIds: (v.removeFeatureIds ?? []) as string[],
    upsertStories,
    removeStoryIds: (v.removeStoryIds ?? []) as string[],
  };
  return { ok: true as const, value };
}

const sameJson = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** Only the fields whose stored value differs; the identity fields (ProjectId, ScopeVersion, Key) are never re-sent. */
function changedPatch(row: Row, fields: Obj): Obj {
  const out: Obj = {};
  for (const [k, v] of Object.entries(fields)) {
    if (k === "ProjectId" || k === "ScopeVersion" || k === "Key") continue;
    if (!sameJson(row[k] ?? (Array.isArray(v) ? [] : undefined), v)) out[k] = v;
  }
  return out;
}

/** Everything the save reads, in parallel (the project's rows are narrowed to the version afterwards). */
function readAll(env: Pick<ScopeReadEnv, "projectId" | "db">) {
  const e = env as ScopeEnv;
  return Promise.all([
    latestVersion(e),
    loadProjectScopeRows(e),
    env.db.query(SCHEMA.requirement, { ProjectId: env.projectId }),
    env.db.query(SCHEMA.designScreen, { ProjectId: env.projectId }, { fields: ["ItemId"] }),
  ]);
}

/** The answers of the saves that created the draft version (the only ones recorded). */
const createdDraft = new WeakSet<object>();

export const scopeSave: ScopeOpDef<SaveArgs> = {
  op: "scope.save",
  kind: "command",
  permission: SCOPE_OP_PERMISSION["scope.save"],
  parse: parseSave,
  prefetch: (env: ScopeReadEnv) => readAll(env),
  // The answer of the save that creates the draft is recorded (the repeat finds a changed version); every other answer is rebuilt by a repeat.
  record: (data: object) => createdDraft.has(data),
  async run(env: ScopeEnv, args) {
    // Round 1 (the router's, via prefetch): the memo answers these.
    const [version, allRows, reqRows, screenRows] = await readAll(env);
    const refused = refuseUnlessDraftOpen(env, version);
    if (refused && !version) return refused;

    // The first save creates the draft v1 (written with the rest below); the natural key makes the insert repeat-safe.
    const number = version?.number ?? 1;
    const state = version ? scopeStateOf(allRows, version) : { features: [] as Row[], stories: [] as Row[], milestones: [] as Row[] };

    const features = state.features.flatMap((row) => {
      const rec = featureRec(row);
      return rec ? [{ row, rec }] : [];
    });
    const featureIdByKey = new Map(features.map((f) => [f.rec.key, f.rec.id]));
    const stories = state.stories.flatMap((row) => {
      const rec = storyRec(row, featureIdByKey);
      return rec ? [{ row, rec }] : [];
    });
    const featureById = new Map(features.map((f) => [f.rec.id, f]));
    const storyById = new Map(stories.map((s) => [s.rec.id, s]));
    const requirementKeysById = new Map<string, string>();
    for (const r of reqRows) {
      const rec = requirementRec(r);
      if (rec && rec.active) requirementKeysById.set(rec.id, rec.key);
    }
    const screenIds = new Set(screenRows.map((r) => r.ItemId));

    // The retry of an interrupted removal finds the row gone: that is the finished state, not an error.
    const retry = env.attempt > 1;
    const removeFeatureIds = args.removeFeatureIds.filter((id) => featureById.has(id) || !retry);
    const removeStoryIds = args.removeStoryIds.filter((id) => storyById.has(id) || !retry);

    // Cross-references: everything an id names must belong to THIS project's version.
    const newFeatureKeys = new Set(args.upsertFeatures.flatMap((f) => (f.clientKey ? [f.clientKey] : [])));
    if (args.upsertFeatures.some((f) => f.id && !featureById.has(f.id))) return fail("not_found");
    if (args.upsertStories.some((s) => s.id && !storyById.has(s.id))) return fail("not_found");
    if (removeFeatureIds.some((id) => !featureById.has(id))) return fail("not_found");
    if (removeStoryIds.some((id) => !storyById.has(id))) return fail("not_found");
    if (args.upsertStories.some((s) => !featureById.has(s.featureId) && !newFeatureKeys.has(s.featureId))) return fail("not_found");

    const issues = validateScopeChange(
      {
        upsertFeatures: args.upsertFeatures,
        removeFeatureIds,
        upsertStories: args.upsertStories,
        removeStoryIds,
      },
      {
        requirementIds: [...requirementKeysById.keys()],
        screenIds: [...screenIds],
        features: features.map((f) => ({ id: f.rec.id })),
        stories: stories.map((s) => ({ id: s.rec.id, featureId: s.rec.featureId })),
      },
      "save",
    );
    if (issues.length) return fail("invalid_input", "scope.invalid", { issues });

    const conflicts: { kind: "feature" | "story"; id: string }[] = [];
    const idsByClientKey: Record<string, string> = {};
    const featureKeyForRef = new Map<string, string>(); // feature ItemId or clientKey -> Feature.Key
    for (const f of features) featureKeyForRef.set(f.rec.id, f.rec.key);
    const savedFeatureIds: string[] = [];
    const savedStoryIds: string[] = [];
    let versionId = version?.id ?? "";
    // The first save of a scope answers with the rows it wrote (the issued stamp, no read-back); a repeat reads them.
    const built = new Map<string, Row>();
    // Rows answered exactly as stored (nothing written for them), in every save.
    const exact = new Map<string, Row>();
    let newVersion: Row | null = null;

    // Round 2: every write runs in parallel (each is repeat-safe and none depends on another's result: keys are derived).
    const writes: Promise<unknown>[] = [];
    let versionConflict = false;
    if (!version) {
      writes.push(
        env.db
          .insert(SCHEMA.scopeVersion, versionInsert(env.projectId, 1), naturalKey(env.projectId, "scopeVersion", 1))
          .then((made) => {
            versionId = made.id;
            if (made.created) newVersion = { ...versionInsert(env.projectId, 1), ItemId: made.id, CreatedDate: env.issuedStamp, LastUpdatedDate: env.issuedStamp } as Row;
          })
          .catch((err) => {
            if (!(err instanceof UniqueConflictError)) throw err;
            versionConflict = true;
          }),
      );
    }

    for (const f of args.upsertFeatures) {
      if (f.id) {
        const cur = featureById.get(f.id) as { row: Row; rec: FeatureRec };
        const fields = featureFields(f, { projectId: env.projectId, scopeVersion: number, key: cur.rec.key, requirementKeysById, prev: { storedPriority: cur.rec.storedPriority } });
        const patch = changedPatch(cur.row, fields);
        // A stale stamp is a conflict unless the row already holds what is asked (a retry of this very save), or is the caller's own landed write.
        if (f.expectedUpdatedAt !== undefined && f.expectedUpdatedAt !== cur.rec.updatedAt && Object.keys(patch).length) {
          if (isOwnLandedWrite({ stored: cur.row, callerUserId: env.userId, values: fields })) {
            exact.set(f.id, cur.row);
            savedFeatureIds.push(f.id);
            continue;
          }
          conflicts.push({ kind: "feature", id: f.id });
          continue;
        }
        if (Object.keys(patch).length) {
          writes.push(env.db.update(SCHEMA.feature, f.id, patch));
        } else exact.set(f.id, cur.row);
        savedFeatureIds.push(f.id);
      } else {
        const clientKey = f.clientKey as string;
        const key = env.uuid5(`${env.projectId}:feature:${clientKey}`);
        const fields = featureFields(f, { projectId: env.projectId, scopeVersion: number, key, requirementKeysById });
        const stored = refused ? features.find((x) => x.rec.key === key) : undefined;
        if (stored) {
          // The repeat of a save that already went through: the stored row is the answer, nothing to write.
          idsByClientKey[clientKey] = stored.rec.id;
          exact.set(stored.rec.id, stored.row);
          savedFeatureIds.push(stored.rec.id);
          featureKeyForRef.set(clientKey, key);
          continue;
        }
        writes.push(
          env.db.insert(SCHEMA.feature, fields, naturalKey(env.projectId, "feature", clientKey)).then((made) => {
            if (made.created) built.set(made.id, { ...fields, ItemId: made.id, CreatedDate: env.issuedStamp, LastUpdatedDate: env.issuedStamp, CreatedByUserId: env.userId, UpdatedByUserId: env.userId } as Row);
            idsByClientKey[clientKey] = made.id;
            savedFeatureIds.push(made.id);
          }),
        );
        featureKeyForRef.set(clientKey, key);
      }
    }

    for (const s of args.upsertStories) {
      const featureKey = featureKeyForRef.get(s.featureId) as string;
      if (s.id) {
        const cur = storyById.get(s.id) as { row: Row; rec: StoryRec };
        const fields = storyFields(s, { projectId: env.projectId, scopeVersion: number, key: cur.rec.key, featureKey });
        const patch = changedPatch(cur.row, fields);
        if (s.expectedUpdatedAt !== undefined && s.expectedUpdatedAt !== cur.rec.updatedAt && Object.keys(patch).length) {
          if (isOwnLandedWrite({ stored: cur.row, callerUserId: env.userId, values: fields })) {
            exact.set(s.id, cur.row);
            savedStoryIds.push(s.id);
            continue;
          }
          conflicts.push({ kind: "story", id: s.id });
          continue;
        }
        if (Object.keys(patch).length) {
          writes.push(env.db.update(SCHEMA.story, s.id, patch));
        } else exact.set(s.id, cur.row);
        savedStoryIds.push(s.id);
      } else {
        const clientKey = s.clientKey as string;
        const key = env.uuid5(`${env.projectId}:story:${clientKey}`);
        const fields = storyFields(s, { projectId: env.projectId, scopeVersion: number, key, featureKey });
        const stored = refused ? stories.find((x) => x.rec.key === key) : undefined;
        if (stored) {
          idsByClientKey[clientKey] = stored.rec.id;
          exact.set(stored.rec.id, stored.row);
          savedStoryIds.push(stored.rec.id);
          continue;
        }
        writes.push(
          env.db.insert(SCHEMA.story, fields, naturalKey(env.projectId, "story", clientKey)).then((made) => {
            if (made.created) built.set(made.id, { ...fields, ItemId: made.id, CreatedDate: env.issuedStamp, LastUpdatedDate: env.issuedStamp, CreatedByUserId: env.userId, UpdatedByUserId: env.userId } as Row);
            idsByClientKey[clientKey] = made.id;
            savedStoryIds.push(made.id);
          }),
        );
      }
    }

    // A removed feature takes its stories along.
    const removedKeys = new Set(removeFeatureIds.map((id) => (featureById.get(id) as { rec: FeatureRec }).rec.key));
    const storyRemovals = new Set(removeStoryIds);
    for (const s of stories) if (removedKeys.has(s.rec.featureKey)) storyRemovals.add(s.rec.id);
    for (const id of storyRemovals) writes.push(env.db.remove(SCHEMA.story, id));
    for (const id of removeFeatureIds) writes.push(env.db.remove(SCHEMA.feature, id));

    // Milestones lose the refs of removed features (and any ref left dangling by an interrupted earlier removal).
    const liveKeys = new Set<string>([
      ...features.map((f) => f.rec.key).filter((k) => !removedKeys.has(k)),
      ...[...newFeatureKeys].map((ck) => featureKeyForRef.get(ck) as string),
    ]);
    const changedMilestoneIds: string[] = [];
    for (const row of state.milestones) {
      const m = milestoneRec(row);
      if (!m) continue;
      const refs = m.featureRefs.filter((r) => r.startsWith("feature:") && liveKeys.has(r.slice("feature:".length)));
      if (refs.length === m.featureRefs.length) continue;
      writes.push(env.db.update(SCHEMA.milestone, m.id, { FeatureRefs: refs }));
      changedMilestoneIds.push(m.id);
    }
    // A repeat of a save that already went through, after the scope was locked, changes nothing: it is answered like the first time.
    if (refused && (writes.length > 0 || conflicts.length > 0)) return refused;
    // The queued writes (audit, notifications) ride the write round; an Operation record follows only for the save that creates the draft.
    await Promise.all([...writes, env.flush()]);
    if (versionConflict) return fail("conflict", "scope.notOpen");

    // Round 3: one parallel read-back of the rows this save wrote, so the stamps returned are the ones Blocks stored. Rows it did not write
    // answer as stored; the save that creates the draft answers with what it wrote (nothing stored exists to disagree with it) and so
    // finishes with its Operation record in the third round.
    const fresh = !version;
    const unread = (ids: string[]) => ids.filter((id) => !exact.has(id) && !(fresh && built.has(id)));
    const [versionRead, featureRead, storyRead, milestoneRead] = await Promise.all([
      version || newVersion ? Promise.resolve([] as Row[]) : env.db.byIds(SCHEMA.scopeVersion, [versionId]),
      unread(savedFeatureIds).length ? env.db.byIds(SCHEMA.feature, unread(savedFeatureIds)) : Promise.resolve([] as Row[]),
      unread(savedStoryIds).length ? env.db.byIds(SCHEMA.story, unread(savedStoryIds)) : Promise.resolve([] as Row[]),
      changedMilestoneIds.length ? env.db.byIds(SCHEMA.milestone, changedMilestoneIds) : Promise.resolve([] as Row[]),
    ]);
    const pick = (ids: string[], read: Row[]): Row[] =>
      ids.flatMap((id) => {
        const row = exact.get(id) ?? (fresh ? built.get(id) : undefined) ?? read.find((r) => r.ItemId === id);
        return row ? [row] : [];
      });
    const versionRows = version ? [rawVersion(version)] : newVersion ? [newVersion] : versionRead;
    const featureRows = pick(savedFeatureIds, featureRead);
    const storyRows = pick(savedStoryIds, storyRead);
    const milestoneRows = milestoneRead;

    const data = {
      version: versionRows[0] ?? null,
      features: featureRows,
      stories: storyRows,
      removedFeatureIds: removeFeatureIds,
      removedStoryIds: [...storyRemovals],
      milestones: milestoneRows,
      conflicts,
      idsByClientKey,
    };
    if (fresh) createdDraft.add(data);
    return ok(data);
  },
};

export const SCOPE_SAVE_HANDLERS: ScopeOpDef[] = [scopeSave];
