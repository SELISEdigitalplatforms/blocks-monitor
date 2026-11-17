// security.posture: what the RUNNING host enforces (host switches, impersonation rules, quotas, input limits).
// A view for platform admins and the live probe (P4). It returns no env value, credential id, token or user data.
import { OpError, defineOp } from "../../../_lib";
import {
  IMPERSONATION_REFUSED_PERMISSIONS,
  IMPERSONATION_REFUSED_SCOPES,
  INPUT_LIMITS,
  OP_QUOTAS,
} from "../../../../src/domain/security";

/** Strict empty args: undefined or {}; any key is refused. */
function noArgs(raw: unknown): Record<string, never> {
  if (raw === undefined) return {};
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    throw new OpError("invalid_input", undefined, { field: "args", rule: "type" });
  }
  const keys = Object.keys(raw);
  if (keys.length > 0) throw new OpError("invalid_input", undefined, { field: keys[0], rule: "unknown" });
  return {};
}

export const securityPosture = defineOp({
  op: "security.posture",
  kind: "view",
  scope: "platform",
  permission: "platform.audit.view",
  args: noArgs,
  async handler(ctx) {
    return {
      host: ctx.host ?? { kind: "blocks" as const },
      impersonation: {
        refusedPermissions: [...IMPERSONATION_REFUSED_PERMISSIONS],
        refusedScopes: [...IMPERSONATION_REFUSED_SCOPES],
      },
      quotas: OP_QUOTAS.map((q) => ({ ...q })),
      input: {
        maxDepth: INPUT_LIMITS.maxDepth,
        maxKeys: INPUT_LIMITS.maxKeys,
        forbiddenKeys: [...INPUT_LIMITS.forbiddenKeys],
      },
    };
  },
});
