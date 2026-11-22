// Maps the rows loadFacts reads onto the pure domain's ChatRecords (src/domain/agentChat.ts).
import type { Row } from "../../../_lib";
import type { ChatRecords } from "../../../../src/domain/agentChat";
import type { FactsRows } from "../common/loaders";
import { num, str } from "../common/records";

export const featureRefOf = (row: Row): string => `feature:${str(row, "Key")}`;

export function toChatRecords(rows: FactsRows): ChatRecords {
  const p = rows.project;
  const locked = rows.lockedVersion ? num(rows.lockedVersion, "Number") : null;
  return {
    project: {
      name: str(p, "Name"),
      stage: str(p, "Stage"),
      resumeTo: str(p, "ResumeTo") || null,
      scopeLockedAt: str(p, "ScopeLockedAt") || null,
    },
    lockedVersion: locked === null ? null : { number: locked },
    features: rows.features.map((r) => ({ ref: featureRefOf(r), title: str(r, "Title") })),
    milestones: rows.milestones
      .filter((r) => locked === null || num(r, "ScopeVersion") === locked)
      .map((r) => ({ id: str(r, "ItemId"), title: str(r, "Name"), status: str(r, "Status"), order: num(r, "Number") })),
    tickets: rows.tickets.map((r) => ({
      number: num(r, "Number"),
      title: str(r, "Title"),
      agentRole: str(r, "AgentRole"),
      column: str(r, "Column"),
      milestoneId: str(r, "MilestoneId"),
      isDone: r.IsDone === true,
    })),
    changeRequests: rows.changeRequests.map((r) => ({
      id: str(r, "ItemId"),
      number: num(r, "Number"),
      lane: str(r, "Lane"),
      title: str(r, "Title"),
      status: str(r, "Status"),
      version: str(r, "Version"),
    })),
    releases: rows.releases
      .filter((r) => str(r, "Status") === "released")
      .map((r) => ({ environment: str(r, "Environment"), version: str(r, "Version"), releasedAt: str(r, "ReleasedAt") })),
    jobs: rows.jobs.map((r) => ({
      id: str(r, "ItemId"),
      kind: str(r, "Kind"),
      status: str(r, "Status"),
      progress: num(r, "Progress"),
      targetId: str(r, "TargetId"),
      createdAt: str(r, "CreatedDate"),
    })),
  };
}
