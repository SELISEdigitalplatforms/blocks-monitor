// me.completeSignup {}: after a public sign-up's first sign-in, the person's first organization, created once with the
// name given at sign-up (workspace.create: Free plan and the sign-up credit, once per person), and the plan the person
// picked on the pricing page (a paid one goes on to checkout). Acts on the caller's own SignUp row only; a person who
// never signed up publicly (invited) gets nothing back.
// Round plan: round 1: the caller's own SignUp row; round 2: workspace.create's inserts; round 3: the row's WorkspaceId.
import { defaultOrganizationName, cleanPlanKey } from "../../../../src/domain/signup";
import { checkWorkspaceName } from "../../../../src/domain/tenancy";
import { findOne, ok, readArgs } from "../_shared/core";
import type { OpAnswer, OpCtx, OpDeps } from "../_shared/ports";
import { workspaceCreate } from "../workspace/create";

export const SIGNUP_SCHEMA = "SignUp";

export interface CompleteSignupResult {
  workspaceId: string | null;
  plan: string;
  created: boolean;
}

interface SignupRow {
  ItemId: string;
  UserId: string;
  Name?: string;
  OrganizationName?: string;
  PlanKey?: string;
  Status?: string;
  WorkspaceId?: string;
}

export async function meCompleteSignup(ctx: OpCtx, args: unknown, deps: OpDeps): Promise<OpAnswer<CompleteSignupResult>> {
  const a = readArgs(args, {});
  if (!a.ok) return { ok: false, error: a.error };
  const c = ctx.context;
  if (!c.isAuthenticated || !c.userId) return { ok: false, error: { code: "forbidden", messageKey: "tenancy.signInRequired" } };
  const row = await findOne<SignupRow>(deps.gateway, SIGNUP_SCHEMA, { UserId: c.userId }, [
    "ItemId", "UserId", "Name", "OrganizationName", "PlanKey", "Status", "WorkspaceId",
  ]);
  if (!row || row.Status !== "verified") return ok({ workspaceId: null, plan: "", created: false });
  const plan = cleanPlanKey(row.PlanKey ?? "");
  if (row.WorkspaceId) return ok({ workspaceId: row.WorkspaceId, plan, created: false });

  const wanted = (row.OrganizationName ?? "").trim();
  const name = wanted && checkWorkspaceName(wanted).ok ? wanted : defaultOrganizationName(row.Name ?? "");
  // One key per sign-up: two tabs finishing at once insert the same workspace once (insertOnce on the request key).
  const made = await workspaceCreate({ ...ctx, requestId: `signup-${row.ItemId}` }, { name }, deps);
  if (!made.ok) return { ok: false, error: made.error };
  const workspaceId = made.data.workspace.ItemId;
  await deps.gateway.update(SIGNUP_SCHEMA, row.ItemId, { WorkspaceId: workspaceId, UpdatedByUserId: c.userId });
  return ok({ workspaceId, plan, created: true });
}
