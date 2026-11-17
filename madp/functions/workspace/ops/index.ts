// The mf-workspace ops. WORKSPACE_OPS is the handler table; WORKSPACE_DEFS binds it to the shared library (the router collects the defs).
import { bindOp } from "./_shared/bind";
import type { OpTable } from "./_shared/ports";
import { aclRestamp } from "./acl/restamp";
import { meAccess } from "./me/access";
import { meBootstrap } from "./me/bootstrap";
import { mePasswordChanged } from "./me/passwordChanged";
import { meCompleteSignup } from "./me/completeSignup";
import { memberInvite } from "./member/invite";
import { memberRemove } from "./member/remove";
import { memberSetRole } from "./member/setRole";
import { notificationMarkAllRead } from "./notification/markAllRead";
import { notificationMarkRead } from "./notification/markRead";
import { workspaceCreate } from "./workspace/create";

export const WORKSPACE_OPS: OpTable = {
  "workspace.create": workspaceCreate,
  "member.invite": memberInvite,
  "member.setRole": memberSetRole,
  "member.remove": memberRemove,
  "me.bootstrap": meBootstrap,
  "me.access": meAccess,
  "me.passwordChanged": mePasswordChanged,
  "me.completeSignup": meCompleteSignup,
  "notification.markRead": notificationMarkRead,
  "notification.markAllRead": notificationMarkAllRead,
  "acl.restamp": aclRestamp,
};

/** Read-only ops (kind "view"; src/blocks/fnKinds.ts lists them for the client). */
const VIEWS: readonly string[] = ["me.access"];

/** me.bootstrap only mirrors the account unless it accepted invitations; a repeat of a mirror-only run reads fresh data instead of replaying, which saves the Operation write. */
const acceptedSomething = (data: unknown): boolean => ((data as { accepted?: unknown[] } | null)?.accepted?.length ?? 0) > 0;

export const WORKSPACE_DEFS = Object.entries(WORKSPACE_OPS).map(([op, handler]) =>
  bindOp({
    op,
    handler,
    kind: VIEWS.includes(op) ? "view" : "command",
    allowInactiveAccount: op === "me.bootstrap",
    ...(op === "me.bootstrap" ? { record: acceptedSomething } : {}),
  }),
);
