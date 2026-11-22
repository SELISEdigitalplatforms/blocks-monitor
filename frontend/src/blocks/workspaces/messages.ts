// messageKey (+ params) from the workspace and admin functions -> a plain sentence. Server free text is never shown.
import { t } from "../../i18n";

type Params = Record<string, unknown>;

function str(v: unknown, fallback: string): string {
  return typeof v === "string" && v.trim() !== "" ? v : typeof v === "number" ? String(v) : fallback;
}


/** The sentence for a refused workspace name (`rule` of checkWorkspaceRename); shared by the form and server answers. */
export function workspaceNameRuleText(rule: unknown): string {
  if (rule === "control") return t("shell.messages.workspaceName.control", "The name can't contain tabs, line breaks or other control characters.");
  return t("shell.messages.workspaceName.length", "Use 2 to 60 characters for the workspace name.");
}

export const TENANCY_MESSAGE_TEXT: Record<string, (p: Params) => string> = {
  "tenancy.lastOwner": () => t("shell.messages.tenancy.lastOwner", "A workspace needs at least one Workspace admin."),
  "tenancy.notHeld": () => t("shell.messages.tenancy.notHeld", "You can only grant permissions you hold."),
  "tenancy.outranked": () => t("shell.messages.tenancy.outranked", "You can't change someone who holds permissions you don't have."),
  "tenancy.domainNotAllowed": (p) => t("shell.messages.tenancy.domainNotAllowed", "Email addresses at {domain} aren't allowed on this platform.", { domain: str(p.domain, t("shell.messages.tenancy.thisDomain", "this domain")) }),
  "tenancy.wouldLockOut": () => t("shell.messages.tenancy.wouldLockOut", "This setting would lock you out. Keep your own email domain allowed."),
  "tenancy.noDomains": () => t("shell.messages.tenancy.noDomains", "Allow at least one email domain or exception."),
  "tenancy.roleInUse": (p) => (str(p.count, "") === "1"
    ? t("shell.messages.tenancy.roleInUseOne", "1 person still has this role. Move them to another role first.")
    : str(p.count, "") === ""
      ? t("shell.messages.tenancy.roleInUseSome", "Some people still have this role. Move them to another role first.")
      : t("shell.messages.tenancy.roleInUseMany", "{count} people still have this role. Move them to another role first.", { count: str(p.count, "") })),
  "tenancy.roleLimit": () => t("shell.messages.tenancy.roleLimit", "A workspace can have at most 5 custom roles."),
  "tenancy.alreadyMember": () => t("shell.messages.tenancy.alreadyMember", "This person is already in the workspace or invited."),
  "tenancy.inviteeInactive": () => t("shell.messages.tenancy.inviteeInactive", "This account is deactivated. Ask a platform admin."),
  "tenancy.membershipSuspended": () => t("shell.messages.tenancy.membershipSuspended", "This person's membership is suspended."),
  "tenancy.selfChange": () => t("shell.messages.tenancy.selfChange", "Only the super admin can change their own platform roles."),
  "tenancy.superAdminOnly": () => t("shell.messages.tenancy.superAdminOnly", "Only the super admin can do this."),
  "tenancy.selfDeactivate": () => t("shell.messages.tenancy.selfDeactivate", "You can't deactivate yourself."),
  "tenancy.targetNoAccount": () => t("shell.messages.tenancy.targetNoAccount", "This person has no account yet."),
  "tenancy.signInRequired": () => t("shell.messages.tenancy.signInRequired", "Sign in first."),
  "tenancy.builtInRole": () => t("shell.messages.tenancy.builtInRole", "Built-in roles can't be changed or deleted."),
  "tenancy.roleKeyTaken": () => t("shell.messages.tenancy.roleKeyTaken", "A role with this key already exists."),
  "tenancy.unknownRole": () => t("shell.messages.tenancy.unknownRole", "This role doesn't exist in the workspace."),
  "tenancy.invalidArgs": () => t("shell.messages.tenancy.invalidArgs", "Some details aren't valid. Check them and try again."),
  "tenancy.roleNotFound": () => t("shell.messages.tenancy.roleNotFound", "This role no longer exists in the workspace."),
  "tenancy.roleExists": () => t("shell.messages.tenancy.roleExists", "A role with this key already exists."),
  "tenancy.memberNotFound": () => t("shell.messages.tenancy.memberNotFound", "This person is not in the workspace."),
  "tenancy.workspaceNotFound": () => t("shell.messages.tenancy.workspaceNotFound", "This workspace no longer exists."),
  "tenancy.accountNotFound": () => t("shell.messages.tenancy.accountNotFound", "This person has no account yet."),
  "tenancy.notAllowed": () => t("shell.messages.tenancy.notAllowed", "You don't have access."),
  "tenancy.invalidInput": () => t("shell.messages.tenancy.invalidInput", "Some details aren't valid. Check them and try again."),
  "tenancy.invalidName": () => t("shell.messages.tenancy.invalidName", "Use 1 to 60 characters for the name."),
  "tenancy.invalidWorkspaceName": (p) => workspaceNameRuleText(p.rule),
  "tenancy.workspaceRenamed": () => t("shell.messages.tenancy.workspaceRenamed", "Someone else renamed this workspace just now. Check the current name and try again."),
  "tenancy.invalidEmail": () => t("shell.messages.tenancy.invalidEmail", "Enter a valid email address."),
  "tenancy.invalidRole": () => t("shell.messages.tenancy.invalidRole", "Choose a valid role."),
  "tenancy.invalidDomain": () => t("shell.messages.tenancy.invalidDomain", "Enter a valid email domain, like example.com."),
  "tenancy.tooMany": () => t("shell.messages.tenancy.tooMany", "There are too many entries. Remove some and try again."),
  "tenancy.notPending": () => t("shell.messages.tenancy.notPending", "This invitation is no longer pending."),
  "fn.workspaceInactive": () => t("shell.messages.fn.workspaceInactive", "This workspace is suspended by a platform admin."),
  "iam.unavailable": () => t("shell.messages.iam.unavailable", "Roles and permissions can't be reached right now. Nothing was changed. Try again in a moment."),
  "iam.forbidden": () => t("shell.messages.iam.forbidden", "The platform's access service refused this change. Nothing was changed."),
  "iam.notFound": () => t("shell.messages.iam.notFound", "This role or organization no longer exists in the access service."),
};

/** The plain sentence for a messageKey, or null when the key is unknown (the caller falls back to the code text). */
export function tenancyMessage(messageKey: string | undefined, params?: Params): string | null {
  if (!messageKey || !Object.prototype.hasOwnProperty.call(TENANCY_MESSAGE_TEXT, messageKey)) return null;
  return TENANCY_MESSAGE_TEXT[messageKey](params ?? {});
}

