/** Approvals entry point under the lock card: what is saved for stage and production, and a link that opens L8's policy
 *  editor on this page. No approval editing in this card. */
import { Link } from "react-router-dom";
import type { PolicyState } from "@/madp/blocks/scope/records";
import { Card } from "@/madp/ui/kit";
import { APPROVALS_SETUP_PATH } from "../links";
import { t, useT } from "@/madp/i18n";

type Policies = { stage: PolicyState; production: PolicyState };

/** An approval step's kind in plain words (read at call time, in the current language). */
function stepName(type: string): string {
  switch (type) {
    case "architect": return t("analysis.scope.approvals.step.architect", "architect");
    case "security": return t("analysis.scope.approvals.step.security", "security");
    case "qa": return t("analysis.scope.approvals.step.qa", "QA tester");
    case "custom": return t("analysis.scope.approvals.step.custom", "custom approver");
    default: return t("analysis.scope.approvals.step.approver", "approver");
  }
}

/** Only the SAVED approval policies count (the Release step reads the same records with the same rule): none saved =
 *  "not set up yet"; saved = who approves, by name ("Staging: Anna Rossi, Ben Okafor"), or its steps while nobody is
 *  chosen yet ("Staging: architect, security (no approver chosen yet)"). Never an id.
 *  "Staging: Anna Rossi · Production: not set up yet" */
export function approvalsSummary(policies: Policies | null, nameOf?: (userId: string) => string): string {
  const line = (label: string, p: PolicyState | undefined) => {
    if (p === "unreadable") return t("analysis.scope.approvals.unreadable", "{label}: couldn't be read", { label });
    if (!p || p.steps.length === 0) return t("analysis.scope.approvals.notSetUp", "{label}: not set up yet", { label });
    const names = nameOf ? [...new Set(p.steps.flatMap((s) => s.approverUserIds))].map((id) => nameOf(id)).filter((n) => n.trim() !== "") : [];
    return names.length > 0
      ? `${label}: ${[...new Set(names)].join(", ")}`
      : t("analysis.scope.approvals.noApprover", "{label}: {steps} (no approver chosen yet)", { label, steps: p.steps.map((s) => stepName(s.type)).join(", ") });
  };
  return `${line(t("analysis.scope.approvals.staging", "Staging"), policies?.stage)} · ${line(t("analysis.scope.approvals.production", "Production"), policies?.production)}`;
}

export function ApprovalsEntry({ projectId, policies, canManage, loading = false, nameOf }: {
  projectId: string; policies: Policies | null; canManage: boolean; loading?: boolean; nameOf?: (userId: string) => string;
}) {
  const t = useT();
  return (
    <Card title={t("analysis.scope.approvals.title", "Approvals")}>
      {loading ? <p role="status" className="text-[13px] text-ink2">{t("analysis.scope.now.loadingApprovals", "Loading the approvals…")}</p> : <p className="text-[13px] text-ink2">{approvalsSummary(policies, nameOf)}</p>}
      <p className="mt-1 text-[12px] text-ink3">{t("analysis.scope.approvals.waits", "A release to staging or production waits for these approvals.")}</p>
      {canManage && (
        <Link id="scope-approvals-setup" to={APPROVALS_SETUP_PATH(projectId)}
          className="mt-3 inline-flex h-8 items-center rounded-full bg-surface2 px-3.5 text-[13px] font-medium text-ink outline-none transition hover:bg-line focus-visible:ring-2 focus-visible:ring-accent/50">
          {t("analysis.scope.approvals.setUp", "Set up approvals")}
        </Link>
      )}
    </Card>
  );
}
