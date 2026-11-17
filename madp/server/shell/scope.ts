import type { S1Catalog } from "../fnHost/dataRead.ts";
import type { DataRead } from "../api/brief/access.ts";
import type { FilterCondition } from "../../src/domain/gatewayFilter.ts";
import type { ShellScope } from "./onboarding.ts";
import { ShellRefused } from "./assertion.ts";
import { uuid5 } from "../../functions/_lib/ids.ts";

export function shellRequestId(projectId: string, userId: string, requestId: string): string {
  return uuid5(`blocks-shell:${projectId}:${userId}:${requestId}`);
}

const MEMBERSHIP_READS = new Set(["Workspace", "Membership", "WorkspaceRole"]);
const DENIED_SCHEMAS = new Set(["Invitation", "Payment", "PurchaseRequest", "SignUp", "Subscription", "Operation", "AuditEvent"]);

/** Adds mandatory scope to structured reads before the service identity touches Data Gateway. */
export function scopeReads(reads: readonly DataRead[], catalog: S1Catalog, scope: Pick<ShellScope, "workspaceId" | "projectId" | "identity">): DataRead[] {
  return reads.map((read) => {
    const fields = catalog.get(read.schema);
    if (!fields || DENIED_SCHEMAS.has(read.schema) || !fields.has("WorkspaceId")) throw new ShellRefused(403, "schema_not_allowed");
    if (!MEMBERSHIP_READS.has(read.schema) && read.schema !== "Project" && !fields.has("ProjectId")) throw new ShellRefused(403, "schema_not_allowed");
    const forced: FilterCondition[] = [{ field: "WorkspaceId", op: "eq", value: scope.workspaceId }];
    if (read.schema === "Project") forced.push({ field: "ItemId", op: "eq", value: scope.projectId });
    else if (fields.has("ProjectId")) forced.push({ field: "ProjectId", op: "eq", value: scope.projectId });
    if (read.schema === "Notification") forced.push({ field: "RecipientUserId", op: "eq", value: scope.identity.userId });
    for (const condition of read.filter ?? []) {
      const required = forced.find((f) => f.field === condition.field);
      if (required && required.op === "eq" && (condition.op === "eq" ? condition.value !== required.value : !condition.values.includes(required.value))) throw new ShellRefused(403, "scope_mismatch");
    }
    return { ...read, filter: [...(read.filter ?? []), ...forced] as DataRead["filter"] };
  });
}

export function enforceShellFunction(meta: { scope: string; op: string }, args: Record<string, unknown>, scope: Pick<ShellScope, "workspaceId" | "projectId">): void {
  // Tenant/workspace/member creation and platform administration continue to belong to Blocks.
  if (meta.scope !== "project") throw new ShellRefused(403, "operation_not_allowed");
  if (["project.create", "project.delete", "project.assign", "project.setup.agent.connect"].includes(meta.op)) throw new ShellRefused(403, "operation_not_allowed");
  if (args.workspaceId !== undefined && args.workspaceId !== scope.workspaceId) throw new ShellRefused(403, "scope_mismatch");
  if (args.projectId !== undefined && args.projectId !== scope.projectId) throw new ShellRefused(403, "scope_mismatch");
}
