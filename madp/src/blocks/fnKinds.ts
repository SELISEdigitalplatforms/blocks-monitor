// Which Logic Function ops only read (kind "view" in functions/<fn>/ops/**). Every other op writes.
// test/functions/fn-kinds-contract.test.ts keeps this list equal to the functions' own metadata.
import type { FunctionName } from "./functions";

export const VIEW_OPS: ReadonlySet<string> = new Set([
  "workspace:workspace.export",
  "workspace:me.access",
  "project:doc.file.url",
  "project:request.outcome",
  "project:engine.estimates",
  "project:sample.url",
  "project:scope.attachment.url",
  "project:scope.screens.urls",
  "project:shareLink.list",
  "collab:feedback.attachment.url",
  "collab:attachment.url",
  "admin:accessRequest.list",
  "billing:billing.plans.list",
  "billing:billing.plans.public",
  "billing:billing.settings.get",
  "billing:billing.summary",
  "billing:billing.jobs.usage",
  "billing:billing.balances.list",
  "billing:billing.entries.list",
  "billing:billing.coupons.list",
  "billing:billing.purchases.list",
  "billing:billing.usage.report",
  "billing:billing.payments.list",
  "billing:billing.access",
  "billing:billing.paywall.get",
  "admin:audit.list",
  "admin:people.access",
  "admin:people.countSuperAdmins",
  "admin:people.list",
  "admin:iam.access.get",
  "admin:iam.permissions.list",
  "admin:iam.roles.list",
  "admin:iam.status",
  "admin:platform.ai.accounts.list",
  "admin:platform.engine.status",
  "admin:platformRole.list",
  "admin:security.posture",
  "admin:seed.status",
  "admin:setting.get",
  "admin:signup.settings.get",
  "admin:workspace.inspect",
  "admin:workspace.list",
]);

export function opKind(fn: FunctionName, op: string): "read" | "write" {
  return VIEW_OPS.has(`${fn}:${op}`) ? "read" : "write";
}
