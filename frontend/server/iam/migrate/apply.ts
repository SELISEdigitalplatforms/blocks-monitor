// Carries out a migration plan in safe order: permissions -> roles -> organizations -> organization grants (every
// active member) -> link (Workspace.IamOrganizationId) -> platform grants. The source switch is not part of it.
// Every call is idempotent on IAM's side (ensure/upsert, full role lists), so a rerun after a failure only does what is
// left. One failed call is recorded and the run goes on; the steps after it see what exists.
import type { IamAdminApi } from "../../../functions/_lib/iamAdmin";
import { permissionDescription } from "../../../src/domain/permissions";
import { blockersOf, type MigrationPlan, type Step } from "./plan";

/** iam-core's IAM module (server/iam/iamAdmin.ts) plus the two reads only the migration needs (adapter.ts). */
export type IamAdminPort = IamAdminApi & {
  /** Ids of every IAM user (lets the plan and parity find IAM grants the Factory does not know). */
  listUserIds?(): Promise<string[]>;
  /** Whether the tenant has multi-organization mode on. */
  multiOrgEnabled?(): Promise<boolean>;
};

/** Writes Workspace.IamOrganizationId. */
export interface FactoryLinkWriter {
  linkWorkspace(workspaceItemId: string, organizationId: string): Promise<void>;
}

export interface ActionResult {
  step: Step;
  target: string;
  ok: boolean;
  skipped?: string;
  error?: string;
}

export interface ApplyReport {
  steps: Step[];
  actions: ActionResult[];
  /** Organizations created in this run, by workspace id. */
  createdOrganizations: Record<string, string>;
  failed: number;
  skipped: number;
}

/** A plain, secret-free text for an error: a code when it has one, else its message (first line, trimmed). */
export function errorText(e: unknown): string {
  if (e && typeof e === "object") {
    const o = e as { code?: unknown; message?: unknown };
    const code = typeof o.code === "string" ? o.code : "";
    const msg = typeof o.message === "string" ? o.message.split("\n")[0].slice(0, 300) : "";
    return [code, msg].filter(Boolean).join(": ") || "error";
  }
  return String(e).slice(0, 300);
}

export async function applyPlan(
  plan: MigrationPlan,
  port: IamAdminPort,
  writer: FactoryLinkWriter,
  o: { steps: readonly Step[]; log?: (line: string) => void },
): Promise<ApplyReport> {
  const log = o.log ?? (() => {});
  const actions: ActionResult[] = [];
  const created: Record<string, string> = {};
  const run = async (step: Step, target: string, fn: () => Promise<unknown>): Promise<boolean> => {
    try {
      await fn();
      actions.push({ step, target, ok: true });
      log(`ok    ${step} ${target}`);
      return true;
    } catch (e) {
      const error = errorText(e);
      actions.push({ step, target, ok: false, error });
      log(`FAIL  ${step} ${target}: ${error}`);
      return false;
    }
  };
  const skip = (step: Step, target: string, why: string) => {
    actions.push({ step, target, ok: false, skipped: why });
    log(`skip  ${step} ${target}: ${why}`);
  };
  const want = (s: Step) => o.steps.includes(s);

  if (want("permissions") && plan.permissions.create.length) {
    const keys = plan.permissions.create.map((p) => p.key);
    await run("permissions", `${keys.length} permissions`, () => port.ensurePermissions(keys, permissionDescription));
  }

  if (want("roles")) {
    for (const spec of [...plan.roles.create, ...plan.roles.update.map((u) => u.spec)]) {
      await run("roles", spec.slug, () =>
        port.upsertRole({ slug: spec.slug, name: spec.name, description: spec.description, permissions: spec.permissions }),
      );
    }
  }

  const orgBlocked = blockersOf(plan, "organizations");
  if (want("organizations")) {
    for (const c of plan.organizations.create) {
      if (orgBlocked.length) {
        skip("organizations", c.workspaceId, orgBlocked[0]);
        continue;
      }
      await run("organizations", `${c.workspaceId} "${c.name}"`, async () => {
        const id = await port.ensureOrganization({ workspaceId: c.workspaceId, name: c.name });
        if (!id) throw new Error("no organization id came back");
        created[c.workspaceId] = id;
      });
    }
  }

  // Organization grants before the link: linking hands the workspace's access to IAM (rbacSource reads IAM only for a
  // linked workspace), so every active member holds their IAM role first. A workspace whose grants did not all go
  // through is not linked (fail closed: the Factory rows keep deciding there); a rerun finishes it.
  const doGrant = async (g: MigrationPlan["grants"][number], organizationId: string | undefined): Promise<boolean> => {
    const target = `${g.userId} @ ${g.workspaceId ?? "platform"}`;
    const where = organizationId ? { organizationId } : {};
    let ok = true;
    if (plan.prune && g.remove.length) {
      ok = (await run("grants", `${target} revoke ${g.remove.join(",")}`, () => port.revoke(g.userId, { roles: g.remove, ...where }))) && ok;
    }
    if (g.add.length) {
      ok = (await run("grants", `${target} [${g.roles.join(",")}]`, () => port.grant(g.userId, { roles: g.roles, ...where }))) && ok;
    }
    return ok;
  };
  const incomplete = new Set<string>();
  if (want("grants")) {
    for (const g of plan.grants) {
      if (g.workspaceId === null) continue;
      const organizationId = g.organizationId ?? created[g.workspaceId] ?? undefined;
      if (!organizationId) {
        incomplete.add(g.workspaceId);
        skip("grants", `${g.userId} @ ${g.workspaceId}`, orgBlocked[0] ?? "the workspace has no IAM organization yet (run the organizations step)");
        continue;
      }
      if (!(await doGrant(g, organizationId))) incomplete.add(g.workspaceId);
    }
  }

  const linkBlocked = [...blockersOf(plan, "link"), ...orgBlocked];
  if (want("link")) {
    const links = [
      ...plan.organizations.link,
      ...plan.organizations.create
        .filter((c) => created[c.workspaceId])
        .map((c) => ({ workspaceId: c.workspaceId, workspaceItemId: c.workspaceItemId, organizationId: created[c.workspaceId] })),
    ];
    for (const l of links) {
      if (linkBlocked.length) {
        skip("link", l.workspaceId, linkBlocked[0]);
        continue;
      }
      if (incomplete.has(l.workspaceId)) {
        skip("link", l.workspaceId, "not every member's IAM role went through; rerun to finish the grants first");
        continue;
      }
      await run("link", `${l.workspaceId} -> ${l.organizationId}`, () => writer.linkWorkspace(l.workspaceItemId, l.organizationId));
    }
  }

  if (want("grants")) {
    for (const g of plan.grants) if (g.workspaceId === null) await doGrant(g, undefined);
  }

  return {
    steps: [...o.steps],
    actions,
    createdOrganizations: created,
    failed: actions.filter((a) => !a.ok && !a.skipped).length,
    skipped: actions.filter((a) => a.skipped).length,
  };
}
