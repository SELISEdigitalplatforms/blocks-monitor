// The UI's role wording: the owner key reads "Workspace admin" everywhere visible (C3). The internal key stays "owner".
// The shared logic lives in src/domain/rbac.ts (also used by the server functions); the local exports below shadow it.
import {
  WORKSPACE_ROLE_LABEL,
  can,
  isWorkspaceRole,
  type WorkspacePermission,
  type WorkspaceRole,
} from "../domain/rbac";
import { t } from "../i18n";

export * from "../domain/rbac";

export const ROLE_NAME: Record<WorkspaceRole, string> = { ...WORKSPACE_ROLE_LABEL };
export const OWNER_TIP = `Only a ${WORKSPACE_ROLE_LABEL.owner} manages the workspace and its members`;

/** Why a control is disabled for this role, or null when the role may use it. */
export function deniedTip(role: WorkspaceRole | null | undefined, action: WorkspacePermission): string | null {
  if (can(role, action)) return null;
  if (!isWorkspaceRole(role)) return t("shell.rbac.signInFirst", "Sign in to a workspace first");
  if (role === "viewer") return viewerTip();
  return ownerTip();
}

/** VIEWER_TIP in the chosen language. */
export const viewerTip = (): string => t("shell.rbac.viewerTip", "Viewers can't edit");
/** OWNER_TIP in the chosen language. */
export const ownerTip = (): string => t("shell.rbac.ownerTip", "Only a Workspace admin manages the workspace and its members");
