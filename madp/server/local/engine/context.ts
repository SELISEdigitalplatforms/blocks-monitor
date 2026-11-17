// What the engine reads about a project before it writes: the project row and its records, straight from the row
// store (always the current rows; never cached across steps). Read only.
import type { Row } from "../../../functions/_lib/gateway";
import type { RowStore } from "../rowStore.ts";

const str = (v: unknown): string => (typeof v === "string" ? v : "");
const num = (v: unknown, d = 0): number => (typeof v === "number" && Number.isFinite(v) ? v : d);
const strs = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);

export { num, str, strs };

export interface Person {
  userId: string;
  name: string;
  role: string;
}

export class ProjectView {
  constructor(
    readonly store: RowStore,
    readonly id: string,
  ) {}

  get project(): Row {
    return this.store.get("Project", this.id) ?? { ItemId: this.id };
  }
  get workspaceId(): string {
    return str(this.project.WorkspaceId);
  }
  get name(): string {
    return str(this.project.Name) || "the project";
  }
  get client(): string {
    return str(this.project.ClientName);
  }
  get industry(): string {
    return str(this.project.ClientIndustry);
  }
  get brief(): string {
    return str(this.project.Brief);
  }
  get existingProduct(): boolean {
    return this.project.RepoMode === "existing";
  }
  get repo(): { owner: string; name: string; branch: string } {
    const p = this.project;
    return { owner: str(p.RepoOwner), name: str(p.RepoName) || str(p.RepoExisting), branch: str(p.RepoBranch) || "main" };
  }
  get scopeVersion(): number {
    return num(this.project.CurrentScopeVersion, 1) || 1;
  }

  /** The project's live rows of a schema (soft-deleted rows left out), in insertion order. */
  rows(schema: string): Row[] {
    return this.store.rows(schema).filter((r) => r.ProjectId === this.id && r.IsDeleted !== true);
  }
  row(schema: string, id: string): Row | undefined {
    const r = this.store.get(schema, id);
    return r && r.ProjectId === this.id ? r : undefined;
  }

  notes(): Row[] {
    return this.rows("DocNote").filter((n) => str(n.BodyMd).trim() !== "" || str(n.Title).trim() !== "");
  }
  files(): Row[] {
    return this.rows("DocFile").filter((f) => f.Status === "ready");
  }
  clarifications(): Row[] {
    return this.rows("Clarification").sort((a, b) => num(a.Number) - num(b.Number));
  }
  decisions(): Row[] {
    return this.rows("Decision").filter((d) => d.Status !== "rejected");
  }
  techDecisions(): Row[] {
    return this.rows("TechDecision").sort((a, b) => num(a.Number) - num(b.Number));
  }
  requirements(): Row[] {
    return this.rows("Requirement").sort((a, b) => num(a.SortOrder) - num(b.SortOrder) || num(a.Number) - num(b.Number));
  }
  objective(): Row | undefined {
    return this.rows("Objective")[0];
  }
  features(version = this.scopeVersion): Row[] {
    return this.rows("Feature")
      .filter((f) => num(f.ScopeVersion, 1) === version)
      .sort((a, b) => num(a.SortOrder) - num(b.SortOrder));
  }
  /** Features that are in the scope (not dropped). */
  includedFeatures(version = this.scopeVersion): Row[] {
    return this.features(version).filter((f) => f.Status !== "dropped");
  }
  stories(version = this.scopeVersion): Row[] {
    return this.rows("Story")
      .filter((s) => num(s.ScopeVersion, 1) === version)
      .sort((a, b) => num(a.SortOrder) - num(b.SortOrder));
  }
  storiesOf(featureKey: string, version = this.scopeVersion): Row[] {
    return this.stories(version).filter((s) => s.FeatureRef === `feature:${featureKey}`);
  }
  milestones(version = this.scopeVersion): Row[] {
    return this.rows("Milestone")
      .filter((m) => num(m.ScopeVersion, 1) === version)
      .sort((a, b) => num(a.SortOrder) - num(b.SortOrder) || num(a.Number) - num(b.Number));
  }
  scopeVersionRow(version = this.scopeVersion): Row | undefined {
    return this.rows("ScopeVersion").find((v) => num(v.Number) === version);
  }
  tickets(): Row[] {
    return this.rows("Ticket").sort((a, b) => num(a.Number) - num(b.Number));
  }
  ticketEvents(ticketId: string): Row[] {
    return this.rows("TicketEvent")
      .filter((e) => e.TicketId === ticketId)
      .sort((a, b) => str(a.At).localeCompare(str(b.At)));
  }
  designBrief(): Row | undefined {
    const briefs = this.rows("DesignBrief");
    return briefs.find((b) => b.Status === "confirmed") ?? briefs[0];
  }
  screens(): Row[] {
    return this.rows("DesignScreen").filter((s) => s.Status !== "superseded");
  }
  releases(env?: string): Row[] {
    return this.rows("Release").filter((r) => !env || r.Environment === env);
  }
  changeRequests(): Row[] {
    return this.rows("ChangeRequest").sort((a, b) => num(a.Number) - num(b.Number));
  }

  /** Display name of a person (Account / Membership rows), or "". */
  personName(userId: string): string {
    if (!userId) return "";
    const m = this.store.rows("Membership").find((x) => x.UserId === userId && x.WorkspaceId === this.workspaceId);
    if (m && str(m.DisplayName)) return str(m.DisplayName);
    const a = this.store.rows("Account").find((x) => x.UserId === userId);
    return str(a?.DisplayName);
  }

  /** The workspace's active members. */
  members(): Person[] {
    return this.store
      .rows("Membership")
      .filter((m) => m.WorkspaceId === this.workspaceId && m.Status === "active")
      .map((m) => ({ userId: str(m.UserId), name: str(m.DisplayName) || this.personName(str(m.UserId)), role: str(m.RoleKey) }));
  }

  /** The people who follow the project: the assignee (else the creator), plus the given actor. */
  followers(actorUserId?: string): string[] {
    const readers = strs(this.project.ReaderIds);
    const out: string[] = [];
    const add = (id: string) => {
      if (id && (readers.length === 0 || readers.includes(id)) && !out.includes(id)) out.push(id);
    };
    add(str(this.project.AssigneeUserId) || str(this.project.CreatedByUserId));
    if (actorUserId) add(actorUserId);
    return out;
  }
}
