// Deleting a project removes everything that depended on it (functions/_lib/purge.ts): every schema with a ProjectId is
// either removed with the project (its Storage files first), kept on purpose as history, or not on the tenant at all.
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { drainProjectPurge } from "../../functions/_lib/purge";
import { ROUTED_SCHEMAS } from "../../functions/_lib/fields";
import { uuid5 } from "../../functions/_lib/ids";
import { memoryGateway } from "../../functions/_lib/testing/memoryGateway";
import {
  PROJECT_CASCADE, PROJECT_CASCADE_KEEP, PROJECT_CASCADE_UNDEPLOYED, PROJECT_FILE_FIELDS, PROJECT_PURGE_SCHEMAS,
  PROJECT_SERVICE_CASCADE, cascadeFieldsOf, fileIdsOf, namesProject,
} from "../../src/domain/projects";

const here = path.dirname(fileURLToPath(import.meta.url));
const SCHEMA_DIR = path.join(here, "..", "..", "blocks", "data", "schemas");
const schemaFields = new Map<string, Set<string>>(
  readdirSync(SCHEMA_DIR).filter((f) => f.endsWith(".json")).map((f) => {
    const s = JSON.parse(readFileSync(path.join(SCHEMA_DIR, f), "utf8")) as { schemaName: string; fields: { name: string }[] };
    return [s.schemaName, new Set(s.fields.map((x) => x.name))] as const;
  }),
);
const withProjectId = [...schemaFields].filter(([, f]) => f.has("ProjectId")).map(([s]) => s).sort();
const KEEP = PROJECT_CASCADE_KEEP.map((k) => k.schema);
const UNDEPLOYED = PROJECT_CASCADE_UNDEPLOYED.map((k) => k.schema);

describe("every schema with a ProjectId has a delete rule", () => {
  it("is removed with the project, kept as history, or not on the tenant: exactly one of them", () => {
    for (const schema of withProjectId) {
      const rules = [PROJECT_PURGE_SCHEMAS.includes(schema), KEEP.includes(schema), UNDEPLOYED.includes(schema)].filter(Boolean);
      expect(rules, schema).toHaveLength(1);
    }
    for (const schema of [...PROJECT_PURGE_SCHEMAS, ...KEEP, ...UNDEPLOYED]) expect(withProjectId, schema).toContain(schema);
    // the work: things waiting for people, jobs, tickets, approvals, notifications
    for (const schema of ["Clarification", "EngineJob", "Ticket", "ApprovalRequest", "ApprovalStep", "ChangeRequest", "Notification", "RequirementExtra", "AttachmentExtraction", "ProjectBrief"]) {
      expect(PROJECT_PURGE_SCHEMAS).toContain(schema);
    }
    expect(KEEP.sort()).toEqual(["AuditEvent", "CreditEntry", "Operation"]);
  });

  it("removes through the scoped gateway only what it may write; the routed schemas go with the service purge", () => {
    for (const schema of ROUTED_SCHEMAS) expect(PROJECT_CASCADE).not.toContain(schema);
    expect(PROJECT_SERVICE_CASCADE).toEqual(["Notification"]);
    expect(PROJECT_CASCADE[PROJECT_CASCADE.length - 1]).toBe("Project");
    expect(PROJECT_PURGE_SCHEMAS).not.toContain("Project");
  });

  it("names Storage-file fields that exist on their schemas", () => {
    for (const [schema, fields] of Object.entries(PROJECT_FILE_FIELDS)) {
      expect(PROJECT_PURGE_SCHEMAS).toContain(schema);
      for (const field of fields) expect(schemaFields.get(schema)?.has(field), `${schema}.${field}`).toBe(true);
      expect(cascadeFieldsOf(schema)).toEqual(["ItemId", ...fields]);
    }
    expect(fileIdsOf("AttachmentExtraction", { ExtractedContentObjectId: "a", FindingsObjectId: " ", Other: "x" })).toEqual(["a"]);
  });

  it("never takes a host-level row for a project's", () => {
    expect(namesProject("system")).toBe(false);
    expect(namesProject("")).toBe(false);
    expect(namesProject(undefined)).toBe(false);
    expect(namesProject("9c056efb-39ff-4518-8930-144bfdb041f6")).toBe(true);
  });
});

describe("the background purge of a deleted project", () => {
  const P = "p-deleted";
  const Q = "q-live";
  const seedAll = () => {
    const gw = memoryGateway({ validate: false });
    gw.seed("Project", { ItemId: P, WorkspaceId: "w1", Status: "deleting", UpdatedByUserId: "u1", LastUpdatedDate: "2026-11-09T10:00:00.000Z" });
    gw.seed("Project", { ItemId: Q, WorkspaceId: "w1", Status: "active", UpdatedByUserId: "u1", LastUpdatedDate: "2026-11-09T10:00:00.000Z" });
    for (const schema of [...PROJECT_PURGE_SCHEMAS, ...KEEP, ...UNDEPLOYED]) {
      for (const projectId of [P, Q]) {
        const files = Object.fromEntries((PROJECT_FILE_FIELDS[schema] ?? []).map((field) => [field, `${schema}.${field}.${projectId}`]));
        gw.seed(schema, {
          ProjectId: projectId, WorkspaceId: "w1", RequestKey: `${schema}:${projectId}`, ...files,
          ...(schema === "EngineJob" ? { Status: "running", Progress: 40, Attempts: 1, Kind: "build.run" } : {}),
        });
      }
    }
    // the engine's host-level job belongs to no project: never touched
    gw.seed("EngineJob", { ProjectId: "system", Kind: "engine.skills-sync", Status: "queued", RequestKey: "system-job" });
    return gw;
  };

  it("removes every dependent row and its Storage files, keeps the history, and removes the Project last", async () => {
    const gw = seedAll();
    const removedFiles: string[] = [];
    const jobStatusAtRemoval: unknown[] = [];
    const remove = gw.remove.bind(gw);
    gw.remove = async (schema, id) => {
      if (schema === "EngineJob") jobStatusAtRemoval.push(gw.rows("EngineJob").find((r) => r.ItemId === id)?.Status);
      if (schema === "Project") {
        // the Project row goes last: nothing of it is left in any purged schema by then
        for (const s of PROJECT_PURGE_SCHEMAS) expect(gw.rows(s).filter((r) => r.ProjectId === P), s).toEqual([]);
      }
      return remove(schema, id);
    };
    const res = await drainProjectPurge({
      raw: gw,
      files: { async remove(fileId) { removedFiles.push(fileId); } },
      ids: { uuid5: (name) => uuid5(name) },
      now: () => new Date("2026-11-12T08:00:00.000Z"),
    });
    expect(res.failed).toEqual([]);

    for (const schema of PROJECT_PURGE_SCHEMAS) {
      expect(gw.rows(schema).filter((r) => r.ProjectId === P), `${schema} of the deleted project`).toEqual([]);
      expect(gw.rows(schema).filter((r) => r.ProjectId === Q), `${schema} of the live project`).toHaveLength(1);
    }
    for (const schema of KEEP) expect(gw.rows(schema).some((r) => r.ProjectId === P && r.RequestKey === `${schema}:${P}`), schema).toBe(true);
    expect(gw.rows("Project").map((r) => r.ItemId)).toEqual([Q]);
    expect(gw.rows("AuditEvent").some((r) => r.Action === "project.delete" && r.TargetId === P)).toBe(true);
    expect(gw.rows("EngineJob").some((r) => r.ProjectId === "system")).toBe(true);
    // the job was cancelled before its row went (the engine writes nothing into a deleted project)
    expect(jobStatusAtRemoval).toEqual(["cancelled"]);

    const expected = Object.entries(PROJECT_FILE_FIELDS).flatMap(([schema, fields]) => fields.map((f) => `${schema}.${f}.${P}`)).sort();
    expect([...removedFiles].sort()).toEqual(expected);
    expect(removedFiles.some((id) => id.endsWith(Q))).toBe(false);
  });

  it("does nothing to a workspace without a project being deleted", async () => {
    const gw = memoryGateway({ validate: false });
    gw.seed("Project", { ItemId: Q, WorkspaceId: "w1", Status: "active" });
    gw.seed("Clarification", { ProjectId: Q, RequestKey: "c1" });
    const res = await drainProjectPurge({ raw: gw, files: { async remove() { throw new Error("no file to remove"); } }, ids: { uuid5 }, now: () => new Date() });
    expect(res.picked).toBe(0);
    expect(gw.rows("Clarification")).toHaveLength(1);
    expect(gw.rows("Project")).toHaveLength(1);
  });
});
