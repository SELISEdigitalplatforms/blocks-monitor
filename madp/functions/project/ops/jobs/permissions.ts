// Who may act on an engine job of each kind: docs/ENGINE-CONTRACT.md section 5.
import type { EngineJobKind } from "../../../../src/domain/engineJob";
import type { WorkspacePermission } from "../../../../src/domain/rbac";

/** Permission(s) that allow acting on a job of each kind (any one of them). */
export const JOB_KIND_PERMISSION: Record<EngineJobKind, readonly WorkspacePermission[]> = {
  "requirements.draft": ["requirements.edit", "sanitization.edit"],
  "sanitization.assist": ["sanitization.edit"],
  "design.generate": ["design.edit"],
  "scope.draft": ["requirements.edit", "scope.lock"],
  "scope.grill": ["scope.lock"],
  "scope.success": ["requirements.edit", "scope.lock"],
  "milestones.suggest": ["scope.lock"],
  "board.plan": ["board.edit"],
  "build.run": ["build.run"],
  "change.build": ["build.run"],
  "change.analyse": ["build.run"],
  "fix.analyse": ["build.run"],
  "preview.deploy": ["build.run"],
  "wiki.generate": ["wiki.edit"],
  "docs.generate": ["wiki.edit"],
  "chat.reply": ["comment"],
  "setup.assist": ["business.edit"],
  "feedback.apply": ["comment"],
  "file.extract": ["business.edit"],
  "engine.skills-sync": ["workspace.manage"],
  "product.document": ["business.edit"],
};

export function kindPermissions(kind: EngineJobKind): readonly WorkspacePermission[] {
  return JOB_KIND_PERMISSION[kind];
}
