// seedAll on the in-memory gateway with the hosted gateway's rules (schemas, validations, unique indexes):
// every row is valid, every id points at something that exists, the app's own row mappers can read every row, and the
// data is consistent per step. Run: npx vitest run --config frontend/seed/vitest.config.ts
import { describe, expect, it } from "vitest";
import { uuid5 } from "../functions/_lib/ids";
import { assertRowValid, memoryGateway, type MemoryGateway } from "../functions/_lib/testing";
import { validateNotification } from "../src/domain/notifications";
import { parseOutputRef } from "../src/domain/engineJob";
import * as scope from "../src/blocks/scope/records";
import * as delivery from "../src/blocks/delivery/types";
import * as collab from "../src/blocks/collab/records";
import { toEngineJob } from "../src/blocks/engine/types";
import { hasCycle } from "../src/domain/ticketDeps";
import { seedAll } from "./index";
import { Clock } from "./core/clock";
import { PEOPLE } from "./data/people";
import type { SeedTarget } from "./target";

type Row = Record<string, unknown>;
const NOW = new Date("2026-10-25T14:00:00.000Z");
const SCHEMAS = [
  "Account", "AgentChatMessage", "ApprovalPolicy", "ApprovalRequest", "ApprovalStep", "AssistantMessage", "Attachment", "AuditEvent", "Board",
  "Challenge", "ChangeRequest", "ChangeRequestAttachment", "Clarification", "Decision", "DesignBrief", "DesignScreen", "DocFile", "DocFolder",
  "DocNote", "EngineJob", "Feature", "FeedbackComment", "FeedbackThread", "Invitation", "ItemVersion", "Membership", "Milestone", "Notification",
  "Objective", "Operation", "PlatformRole", "PlatformRoleAssignment", "PlatformSetting", "Preview", "Project", "ProjectAnswer", "ProjectAssignment",
  "Release", "Requirement", "RequirementExtra", "ScopeVersion", "SecondOpinion", "Share", "ShareLink", "Story", "Suggestion", "TechDecision", "Ticket", "TicketEvent",
  "WikiPage", "WikiPageHistory", "Workspace", "WorkspaceRole",
];

async function run(now = NOW) {
  const gw = memoryGateway();
  const users = new Map<string, string>();
  const files = new Map<string, { name: string; contentType: string; bytes: Uint8Array }>();
  const target: SeedTarget = {
    gw,
    now,
    async createUser(u) {
      const userId = uuid5(`iam:${u.email}`);
      users.set(u.key, userId);
      return { userId };
    },
    async putFile(f) {
      const fileId = uuid5(`file:${files.size}:${f.name}`);
      files.set(fileId, f);
      return { fileId };
    },
  };
  const summary = await seedAll(target);
  return { gw, users, files, summary };
}

const all = (gw: MemoryGateway): Map<string, Row[]> => new Map(SCHEMAS.map((s) => [s, gw.rows(s)]));

describe("seedAll", async () => {
  const { gw, users, files, summary } = await run();
  const rows = all(gw);
  const of = (s: string) => rows.get(s) ?? [];
  const ids = new Set<string>([...rows.values()].flat().map((r) => r.ItemId as string));
  const userIds = new Set(users.values());

  it("writes the people, workspaces, projects and files it reports", () => {
    expect(summary.users).toBe(PEOPLE.filter((p) => !p.noAccount).length);
    expect(summary.workspaces).toBe(of("Workspace").length);
    expect(summary.projects).toBe(of("Project").length);
    expect(summary.files).toBe(files.size);
    expect(summary.rows).toBe([...rows.values()].reduce((n, r) => n + r.length, 0));
    console.log("seed summary", JSON.stringify(summary), `${Math.round([...files.values()].reduce((n, f) => n + f.bytes.length, 0) / 1024)} KB of files`);
  });

  it("every stored row passes the schema rules", () => {
    for (const [schema, list] of rows) for (const r of list) expect(() => assertRowValid(schema, r, { read: true }), `${schema} ${r.ItemId}`).not.toThrow();
  });

  it("every id field points at a row, a person or a stored file", () => {
    const known = (v: string) => v === "" || ids.has(v) || userIds.has(v) || files.has(v);
    const skip = new Set(["RequestKey", "SeedKey", "TargetId"]);
    for (const [schema, list] of rows) {
      for (const r of list) {
        for (const [k, v] of Object.entries(r)) {
          if (skip.has(k) || !/Ids?$/.test(k) || k === "ItemId") continue;
          for (const x of Array.isArray(v) ? v : [v]) {
            if (typeof x !== "string") continue;
            if (schema === "Workspace" && k === "WorkspaceId") continue;
            expect(known(x), `${schema}.${k} = ${x}`).toBe(true);
          }
        }
      }
    }
    for (const w of of("Workspace")) expect(w.WorkspaceId).toBe(w.ItemId);
    for (const t of of("FeedbackThread")) expect(ids.has(t.TargetId as string), `thread target ${t.TargetType}`).toBe(true);
  });

  it("workspace rows carry the workspace's active members as readers", () => {
    for (const ws of of("Workspace")) {
      const active = of("Membership").filter((m) => m.WorkspaceId === ws.ItemId && m.Status === "active").map((m) => m.UserId as string).sort();
      expect(ws.ReaderIds).toEqual(active);
      for (const [schema, list] of rows) {
        for (const r of list) if (r.WorkspaceId === ws.ItemId && Array.isArray(r.ReaderIds)) expect(r.ReaderIds, `${schema} ${r.ItemId}`).toEqual(active);
      }
    }
  });

  it("the app's row mappers read every row", () => {
    const readable = <T,>(schema: string, map: (r: Row) => T | null | undefined, only: (r: Row) => boolean = () => true) => {
      for (const r of of(schema).filter(only)) expect(map(r), `${schema} ${r.ItemId}`).toBeTruthy();
    };
    readable("ScopeVersion", scope.scopeVersionFromRow);
    readable("Feature", (r) => scope.featureFromRow(r));
    readable("Story", (r) => scope.storyFromRow(r));
    readable("Milestone", scope.milestoneFromRow);
    readable("DesignBrief", scope.designBriefFromRow);
    readable("DesignScreen", scope.designScreenFromRow);
    readable("FeedbackThread", scope.threadFromRow, (r) => (scope.SCOPE_FEEDBACK_TARGETS as readonly string[]).includes(r.TargetType as string));
    readable("FeedbackComment", scope.commentFromRow);
    readable("Attachment", scope.attachmentFromRow);
    readable("SecondOpinion", scope.secondOpinionFromRow);
    readable("Challenge", scope.challengeFromRow);
    readable("Requirement", scope.requirementFromRow);
    readable("Objective", scope.objectiveFromRow);
    readable("FeedbackThread", collab.toThread);
    readable("FeedbackComment", collab.toComment);
    readable("WikiPage", collab.toWikiPage);
    readable("WikiPageHistory", collab.toWikiHistory);
    readable("AgentChatMessage", collab.toAgentChat);
    readable("AssistantMessage", collab.toAssistantMessage);
    readable("EngineJob", toEngineJob);
    const parsed = (schema: string, parse: (r: unknown) => { ok: boolean; error?: string }) => {
      for (const r of of(schema)) {
        const p = parse(r);
        expect(p.ok, `${schema} ${r.ItemId}: ${p.error}`).toBe(true);
      }
    };
    parsed("Ticket", delivery.parseTicket);
    parsed("TicketEvent", delivery.parseTicketEvent);
    parsed("Milestone", delivery.parseMilestone);
    parsed("Preview", delivery.parsePreview);
    parsed("ChangeRequest", delivery.parseChangeRequest);
    parsed("Release", delivery.parseRelease);
    parsed("ApprovalPolicy", (r) => delivery.parsePolicy(r, of("ApprovalStep")));
    parsed("ApprovalRequest", (r) => delivery.parseRequest(r, of("ApprovalStep")));
  });

  it("notifications match the catalogue and engine outputs point at their rows", () => {
    for (const n of of("Notification")) {
      const check = validateNotification(n.Kind as string, JSON.parse(n.ParamsJson as string), n.Link as string);
      expect(check.ok, `${n.Kind} ${JSON.stringify(check)}`).toBe(true);
    }
    for (const j of of("EngineJob")) {
      for (const ref of j.OutputRefs as string[]) {
        const p = parseOutputRef(ref);
        expect(p && ids.has(p.id), `${j.Kind} output ${ref}`).toBeTruthy();
      }
    }
  });

  it("each project is consistent with the step it is at", () => {
    for (const p of of("Project")) {
      const pid = p.ItemId as string;
      const mine = (s: string) => of(s).filter((r) => r.ProjectId === pid);
      const handed = p.BusinessHandedOverAt as string | undefined;
      if (handed) for (const d of [...mine("DocNote"), ...mine("DocFile")]) expect((d.CreatedDate as string) < handed, `${p.Name} doc after hand-over`).toBe(true);
      const done = p.SanitizationCompletedAt as string | undefined;
      if (done) {
        for (const q of mine("Clarification")) if (q.Status === "open") expect((q.CreatedDate as string) > done, `${p.Name} open question ${q.Number}`).toBe(true);
        expect(mine("ItemVersion").some((v) => v.ItemKey === "objective:main"), `${p.Name} v1 snapshot`).toBe(true);
      }
      if (p.RequirementsConfirmedAt) {
        // who approved them: the person the requirements.confirm audit names
        const approval = of("AuditEvent").find((e) => e.Action === "requirements.confirm" && e.TargetId === pid);
        expect(p.RequirementsConfirmedByUserId, `${p.Name} approved by`).toBe(approval?.ActorUserId);
        expect(mine("DesignBrief")[0]?.Status, `${p.Name} brief`).toBe("confirmed");
        const brief = mine("DesignBrief")[0]!;
        expect(mine("EngineJob").some((j) => j.Kind === "design.generate" && j.TargetId === brief.ItemId && (j.CreatedDate as string) >= (brief.ConfirmedAt as string))).toBe(true);
      }
      if (p.ScopeLockedAt) {
        const sv = mine("ScopeVersion")[0]!;
        expect(sv.Status).toBe("locked");
        expect(mine("EngineJob").some((j) => j.Kind === "board.plan" && j.TargetId === sv.ItemId && j.Status !== "cancelled")).toBe(true);
      }
      const jobs = mine("EngineJob");
      expect(jobs.length).toBeLessThanOrEqual(100);
      const live = jobs.filter((j) => ["queued", "claimed", "running"].includes(j.Status as string) && ["build.run", "change.build"].includes(j.Kind as string));
      expect(live.length).toBeLessThanOrEqual(1);
      if (p.AssigneeUserId) {
        const newest = mine("ProjectAssignment").sort((a, b) => String(b.At).localeCompare(String(a.At)))[0];
        expect(newest?.AssigneeUserId).toBe(p.AssigneeUserId);
      }
    }
  });

  it("ticket dependencies point at tickets of the project, have no cycle and are done before a ticket starts", () => {
    const tickets = of("Ticket");
    const byId = new Map(tickets.map((t) => [t.ItemId as string, t]));
    const deps = (t: Row) => (Array.isArray(t.DependsOn) ? (t.DependsOn as string[]) : []);
    for (const t of tickets) {
      for (const d of deps(t)) {
        const dep = byId.get(d);
        expect(dep, `Ticket ${t.Number} waits for ${d}`).toBeTruthy();
        expect(dep!.ProjectId, `Ticket ${t.Number} waits for a ticket of another project`).toBe(t.ProjectId);
        expect(d).not.toBe(t.ItemId);
      }
      // a ticket that left Planned did so only after every ticket it waits for was done
      const start = of("TicketEvent")
        .filter((e) => e.TicketId === t.ItemId && e.Kind === "move" && e.FromColumn === "planned")
        .map((e) => e.At as string)
        .sort()[0];
      if (!start) continue;
      for (const d of deps(t)) {
        const dep = byId.get(d)!;
        expect(dep.Column, `#${t.Number} started before #${dep.Number} was done`).toBe("done");
        expect((dep.DoneAt as string) < start, `#${t.Number} started before #${dep.Number} was done`).toBe(true);
      }
    }
    for (const pid of new Set(tickets.map((t) => t.ProjectId as string))) {
      const mine = tickets.filter((t) => t.ProjectId === pid);
      expect(hasCycle(new Map(mine.map((t) => [t.ItemId as string, deps(t)]))), `cycle in ${pid}`).toBe(false);
    }
  });

  it("the delivery projects show parallel work, chains and a running build with done, started and waiting tickets", () => {
    const project = (name: string) => of("Project").find((p) => p.Name === name)!;
    const ticketsOf = (name: string) => of("Ticket").filter((t) => t.ProjectId === project(name).ItemId);
    const deps = (t: Row) => (t.DependsOn as string[]) ?? [];
    const depth = (list: Row[]) => {
      const byId = new Map(list.map((t) => [t.ItemId as string, t]));
      const memo = new Map<string, number>();
      const d = (id: string): number => memo.get(id) ?? (memo.set(id, 1 + Math.max(0, ...deps(byId.get(id)!).filter((x) => byId.has(x)).map(d))), memo.get(id)!);
      return Math.max(...list.map((t) => d(t.ItemId as string)));
    };
    for (const name of ["Driver Delivery App", "Spare Parts Webshop", "Service Technician Portal"]) {
      const list = ticketsOf(name);
      expect(list.some((t) => deps(t).length === 0), `${name}: independent tickets`).toBe(true);
      expect(list.some((t) => deps(t).length > 0), `${name}: tickets that wait`).toBe(true);
      expect(depth(list), `${name}: a chain of three`).toBeGreaterThanOrEqual(3);
      // some milestone starts with work side by side (tickets that wait for nothing of their own milestone)
      const ms = of("Milestone").filter((m) => m.ProjectId === project(name).ItemId);
      const inMilestone = new Map(list.map((t) => [t.ItemId as string, t.MilestoneId]));
      const starts = ms.map((m) => list.filter((t) => t.MilestoneId === m.ItemId && deps(t).every((d) => inMilestone.get(d) !== m.ItemId)).length);
      expect(Math.max(...starts), `${name}: parallel start`).toBeGreaterThanOrEqual(2);
    }
    // Driver Delivery App: the milestone building now has done, started and waiting tickets
    const driver = project("Driver Delivery App");
    const building = of("Milestone").find((m) => m.ProjectId === driver.ItemId && m.Status === "building")!;
    const running = ticketsOf("Driver Delivery App").filter((t) => t.MilestoneId === building.ItemId);
    const byId = new Map(ticketsOf("Driver Delivery App").map((t) => [t.ItemId as string, t]));
    expect(running.some((t) => t.Column === "done")).toBe(true);
    expect(running.some((t) => t.Column !== "done" && t.Column !== "planned")).toBe(true);
    expect(running.some((t) => t.Column === "planned" && deps(t).some((d) => byId.get(d)!.Column !== "done"))).toBe(true);
    // Service Technician Portal: the change being built has a ticket waiting for the one in progress
    const change = of("ChangeRequest").find((c) => c.ProjectId === project("Service Technician Portal").ItemId && c.Status === "building")!;
    const changeTickets = of("Ticket").filter((t) => t.ChangeRequestId === change.ItemId);
    expect(changeTickets.some((t) => t.Column === "planned" && deps(t).length > 0)).toBe(true);
  });

  it("no seeded date lies in the future", () => {
    const now = NOW.toISOString();
    for (const [schema, list] of rows) {
      for (const r of list) {
        for (const [k, v] of Object.entries(r)) {
          if (typeof v === "string" && /(Date|At)$/.test(k) && k !== "ExpiresAt" && /^\d{4}-\d\d-\d\dT/.test(v)) expect(v <= now, `${schema}.${k} ${v}`).toBe(true);
        }
      }
    }
  });

  it("no visible text calls the data a demo, sample, mock or test", () => {
    const words = /\b(demo|mock|fake|prototype|simulated|lorem|test data|dummy|sample data|example (?:data|project|workspace))\b/i;
    for (const [schema, list] of rows) {
      for (const r of list) {
        for (const [k, v] of Object.entries(r)) {
          if (k === "Mode" || k === "RequestKey" || k === "SeedKey") continue;
          if (typeof v === "string") expect(words.test(v), `${schema}.${k}: ${v.slice(0, 80)}`).toBe(false);
        }
      }
    }
  });

  it("is deterministic for the same now", async () => {
    const again = all((await run()).gw);
    for (const s of SCHEMAS) expect(again.get(s), s).toEqual(rows.get(s));
  });
});

describe("seed clock", () => {
  it("counts working days back from the last working day that has started", () => {
    // Monday 26 Oct 2026, 05:00 Zurich (04:00Z): day 0 is Friday 23 Oct.
    const night = new Clock(new Date("2026-10-26T04:00:00Z"));
    expect(night.at("-0d@09:00")).toBe("2026-10-23T07:00:00.000Z");
    expect(night.at("-1d@14:30")).toBe("2026-10-22T12:30:00.000Z");
    // Wednesday 21 Oct 2026, 10:00 Zurich (summer time, 08:00Z): day 0 is that Wednesday; later times are clamped.
    const day = new Clock(new Date("2026-10-21T08:00:00Z"));
    expect(day.at("-1d@09:00")).toBe("2026-10-20T07:00:00.000Z");
    expect(day.at("-0d@16:00") < "2026-10-21T08:00:00.000Z").toBe(true);
    expect(day.at("-5d@10:00+30m")).toBe("2026-10-14T08:30:00.000Z");
  });
});
