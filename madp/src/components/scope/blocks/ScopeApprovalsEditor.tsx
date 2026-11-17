/** The approval policy editor, opened in place on the Scope page (?approvals=setup) so it can be set before the build.
 *  It is L8's ApprovalPolicyEditor; saving goes through the delivery op approvalPolicy.save. */
import { useEffect, useRef } from "react";
import { useDeliveryContext } from "@/blocks/delivery/context";
import { useApprovalPolicies } from "@/blocks/delivery/hooks";
import { ApprovalPolicyEditor } from "@/components/approvals/ApprovalPolicyEditor";
import { Button } from "@/ui/kit";
import { useT } from "@/i18n";

export function ScopeApprovalsEditor({ projectId, onClose }: { projectId: string; onClose: () => void }) {
  const t = useT();
  const ctx = useDeliveryContext(projectId);
  const policies = useApprovalPolicies(ctx);
  const ref = useRef<HTMLElement>(null);

  useEffect(() => {
    ref.current?.scrollIntoView?.({ block: "start" });
    ref.current?.focus();
  }, []);

  return (
    <section ref={ref} id="approvals" tabIndex={-1} aria-labelledby="approvals-heading" className="space-y-4 outline-none">
      <div className="flex items-center">
        <h2 id="approvals-heading" className="text-[19px] font-medium">{t("analysis.scope.approvals.title", "Approvals")}</h2>
        <Button size="sm" variant="ghost" className="ml-auto" onClick={onClose}>{t("analysis.scope.approvals.done", "Done")}</Button>
      </div>
      <p className="text-[13px] text-ink2">{t("analysis.scope.approvals.choose", "Choose who approves a release to staging and to production. You can change it any time before the release.")}</p>
      {ctx.status === "loading" ? (
        <p role="status" className="text-[14px] text-ink2">{t("analysis.scope.approvals.loadingPolicy", "Loading the approval policy…")}</p>
      ) : ctx.status === "not_found" || ctx.status === "error" ? (
        <p role="alert" className="text-[13px] text-danger">{ctx.error ?? t("analysis.scope.approvals.policyFailed", "The approval policy could not be loaded.")}</p>
      ) : (
        <>
          {(policies.error || policies.unreadable.length > 0) && (
            <p role="alert" className="text-[13px] text-danger">{t("analysis.scope.approvals.someFailed", "Some approval data could not be loaded.")}</p>
          )}
          <ApprovalPolicyEditor ctx={ctx} policies={policies.data} loading={policies.isLoading} initialEnvironment="stage" />
        </>
      )}
    </section>
  );
}
