// The mf-admin op table. Every op of the `admin` function is served from here, platform ops and workspaceRole.* alike.
import { signupSettingsGet, signupSettingsSave } from "./setting/signup";
import { bindOp } from "../../workspace/ops/_shared/bind";
import type { OpTable } from "../../workspace/ops/_shared/ports";
import { accessRequestList } from "./accessRequest/list";
import { accountDeactivate } from "./account/deactivate";
import { accountReactivate } from "./account/reactivate";
import { auditList } from "./audit/list";
import { iamAccessGet, iamAccessSet } from "./iam/access";
import { iamPermissionsList } from "./iam/permissions";
import { iamRolesDelete, iamRolesList, iamRolesSave } from "./iam/roles";
import { iamSourceSet } from "./iam/source";
import { iamStatus } from "./iam/status";
import { iamSyncRun } from "./iam/sync";
import { peopleAccess } from "./people/access";
import { peopleCountSuperAdmins } from "./people/countSuperAdmins";
import { peopleCreateAccount } from "./people/createAccount";
import { peopleInvite } from "./people/invite";
import { peopleList } from "./people/list";
import { peopleResendActivation } from "./people/resendActivation";
import { peopleSetActive } from "./people/setActive";
import { peopleSetRole } from "./people/setRole";
import { platformRoleAssign } from "./platformRole/assign";
import { platformRoleDelete } from "./platformRole/delete";
import { platformRoleList } from "./platformRole/list";
import { platformRoleSave } from "./platformRole/save";
import { platformRoleUnassign } from "./platformRole/unassign";
import { settingGet } from "./setting/get";
import { settingSave } from "./setting/save";
import { workspaceInspect } from "./workspace/inspect";
import { workspaceList } from "./workspace/list";
import { workspaceSuspend } from "./workspace/suspend";
import { workspaceRoleApplyTemplate } from "./workspaceRole/applyTemplate";
import { workspaceRoleDelete } from "./workspaceRole/delete";
import { workspaceRoleSave } from "./workspaceRole/save";

export const ADMIN_OPS: OpTable = {
  "platformRole.save": platformRoleSave,
  "platformRole.delete": platformRoleDelete,
  "platformRole.assign": platformRoleAssign,
  "platformRole.unassign": platformRoleUnassign,
  "platformRole.list": platformRoleList,
  "setting.save": settingSave,
  "setting.get": settingGet,
  "signup.settings.get": signupSettingsGet,
  "signup.settings.save": signupSettingsSave,
  "audit.list": auditList,
  "workspaceRole.save": workspaceRoleSave,
  "workspaceRole.delete": workspaceRoleDelete,
  "workspaceRole.applyTemplate": workspaceRoleApplyTemplate,
  "account.deactivate": accountDeactivate,
  "account.reactivate": accountReactivate,
  "workspace.suspend": workspaceSuspend,
  "workspace.list": workspaceList,
  "workspace.inspect": workspaceInspect,
  "accessRequest.list": accessRequestList,
  "people.invite": peopleInvite,
  "people.createAccount": peopleCreateAccount,
  "people.setActive": peopleSetActive,
  "people.resendActivation": peopleResendActivation,
  "people.setRole": peopleSetRole,
  "people.list": peopleList,
  "people.countSuperAdmins": peopleCountSuperAdmins,
  "people.access": peopleAccess,
  "iam.status": iamStatus,
  "iam.roles.list": iamRolesList,
  "iam.roles.save": iamRolesSave,
  "iam.roles.delete": iamRolesDelete,
  "iam.permissions.list": iamPermissionsList,
  "iam.access.get": iamAccessGet,
  "iam.access.set": iamAccessSet,
  "iam.sync.run": iamSyncRun,
  "iam.source.set": iamSourceSet,
};

const VIEWS = ["platformRole.list", "setting.get", "signup.settings.get", "audit.list", "workspace.list", "workspace.inspect", "accessRequest.list", "people.list", "people.countSuperAdmins", "people.access", "iam.status", "iam.roles.list", "iam.permissions.list", "iam.access.get"];

export const ADMIN_DEFS = Object.entries(ADMIN_OPS).map(([op, handler]) =>
  bindOp({
    op,
    handler,
    kind: VIEWS.includes(op) ? "view" : "command",
    // The answer holds the one-time temporary password: it must never reach the Operation record.
    ...(op === "people.createAccount" ? { record: () => false } : {}),
  }),
);
