/** The state of Settings → Workspace name: who may rename, whether the draft is a change, and why it can't be saved.
 *  Pure (the card and its tests share it); the rule itself is checkWorkspaceRename, the same one the server applies. */
import { can } from "@/domain/rbac";
import { checkWorkspaceRename, workspaceWritable } from "@/domain/tenancy";
import { workspaceNameRuleText } from "@/blocks/workspaces/messages";
import { t } from "@/i18n";

/** The English source texts (tests compare them); the shown text is translated at call time. */
export const RENAME_ADMIN_ONLY = "Only a Workspace admin can rename the workspace.";
export const RENAME_SUSPENDED = "This workspace is suspended by a platform admin, so its name can't be changed.";

export interface WorkspaceNameFormInput {
  /** The saved name (what the switcher shows). */
  current: string;
  /** What is in the field. */
  draft: string;
  /** The caller's permissions in this workspace. */
  permissions: readonly string[];
  /** The workspace's status. */
  status: string | null | undefined;
  saving: boolean;
}

export interface WorkspaceNameForm {
  /** "edit": a Workspace admin of an active workspace gets the field and Save; everyone else reads the name. */
  mode: "edit" | "read";
  /** Why the name is read-only (null in edit mode). */
  readOnlyReason: string | null;
  /** The trimmed draft differs from the saved name. */
  dirty: boolean;
  /** Why the draft can't be saved (shown under the field), or null. */
  problem: string | null;
  canSave: boolean;
  /** The name that is sent (trimmed), or null when the draft is refused. */
  value: string | null;
}

export function workspaceNameForm(i: WorkspaceNameFormInput): WorkspaceNameForm {
  const admin = can(i.permissions, "workspace.manage");
  const writable = workspaceWritable(i.status);
  const mode = admin && writable ? "edit" : "read";
  const readOnlyReason = mode === "edit" ? null
    : !admin ? t("settings.workspaceName.adminOnly", "Only a Workspace admin can rename the workspace.")
      : t("settings.workspaceName.suspended", "This workspace is suspended by a platform admin, so its name can't be changed.");
  const check = checkWorkspaceRename(i.draft);
  const value = check.ok ? check.value : null;
  const dirty = (value ?? i.draft.trim()) !== i.current;
  const problem = mode === "edit" && dirty && !check.ok ? workspaceNameRuleText(check.params.rule) : null;
  return { mode, readOnlyReason, dirty, problem, canSave: mode === "edit" && dirty && check.ok && !i.saving, value };
}
