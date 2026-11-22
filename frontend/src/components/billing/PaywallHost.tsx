/** The paywall: when the platform enforces billing and new work (a build, an analysis, a fix round) is refused because
 *  the organization has no credit left (billing.paywall), a calm dialog says so and offers the two ways on: "Choose a
 *  plan" (the plan cards, then checkout) and "Redeem a code" (credit codes add credit here; plan codes go to checkout). */
import { useEffect, useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { Button, Input, Modal } from "@/ui/kit";
import { FunctionError, PAYWALL_EVENT } from "@/blocks/fn";
import { useCurrentWorkspace } from "@/state/workspaces";
import { useT } from "@/i18n";
import { couponProblem, normaliseCoupon, useBillingSummary, useRedeemCoupon } from "./billingData";
import { checkoutErrorText } from "./checkoutData";
import { ChangePlanDialog } from "./PlanCards";

export function PaywallHost() {
  const ws = useCurrentWorkspace();
  const [open, setOpen] = useState(false);
  const [choosing, setChoosing] = useState(false);
  // read only while the plans are open (the same shared read the usage pill uses)
  const summary = useBillingSummary(choosing ? ws?.id : null);
  useEffect(() => {
    const show = () => setOpen(true);
    window.addEventListener(PAYWALL_EVENT, show);
    return () => window.removeEventListener(PAYWALL_EVENT, show);
  }, []);
  return (
    <>
      <PaywallDialog open={open} workspaceId={ws?.id ?? null} onClose={() => setOpen(false)} onChoosePlan={() => { setOpen(false); setChoosing(true); }} />
      <ChangePlanDialog open={choosing} onClose={() => setChoosing(false)} workspaceId={ws?.id ?? null} workspaceName={ws?.name ?? null} currentKey={summary.data?.plan?.key ?? null} />
    </>
  );
}

export function PaywallDialog({ open, workspaceId, onClose, onChoosePlan }: { open: boolean; workspaceId: string | null; onClose: () => void; onChoosePlan: () => void }) {
  const t = useT();
  const navigate = useNavigate();
  const redeem = useRedeemCoupon(workspaceId);
  const [redeeming, setRedeeming] = useState(false);
  const [code, setCode] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
  const close = () => {
    onClose();
    setRedeeming(false);
    setCode("");
    setProblem(null);
    redeem.reset();
  };
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const p = couponProblem(code);
    if (p) return setProblem(p);
    const c = normaliseCoupon(code);
    redeem.mutate(c, {
      onError: (err) => {
        // a plan code pays a plan: it is used at checkout, for the plan it names
        if (err instanceof FunctionError && err.messageKey === "billing.coupon.useAtCheckout") {
          const plan = typeof err.params?.planKey === "string" ? err.params.planKey : "";
          close();
          navigate(plan ? `/billing/checkout?plan=${encodeURIComponent(plan)}&code=${encodeURIComponent(c)}` : "/billing");
        }
      },
    });
  };
  const done = redeem.isSuccess;
  return (
    <Modal open={open} onClose={close} title={done ? t("billing.paywall.creditAdded", "Credit added") : t("billing.paywall.title", "New work waits for credit")} footer={done ? (
      <Button variant="primary" onClick={close}>{t("billing.paywall.continue", "Continue")}</Button>
    ) : (
      <>
        <Button variant="ghost" onClick={() => setRedeeming(true)} disabled={redeeming}>{t("billing.paywall.redeemCode", "Redeem a code")}</Button>
        <Button variant="primary" onClick={onChoosePlan}>{t("billing.paywall.choosePlan", "Choose a plan")}</Button>
      </>
    )}>
      {done ? (
        <p role="status" className="text-[14px] text-ink2">{t("billing.paywall.redeemed", "Your code is redeemed and your credit is updated. Start the work again when you are ready.")}</p>
      ) : (
        <div className="space-y-4">
          <p className="text-[14px] text-ink2">
            {t("billing.paywall.body", "Your organization's credit is used up, so new builds, analyses and fix rounds wait. Work that is already running finishes, and nothing you made is lost.")}
          </p>
          {redeeming && (
            <form onSubmit={submit} className="flex flex-col gap-2" noValidate>
              <label htmlFor="paywall-code" className="text-[13px] font-medium text-ink">{t("billing.paywall.codeLabel", "Code")}</label>
              <div className="flex flex-col gap-2 sm:flex-row">
                <Input id="paywall-code" autoFocus value={code} onChange={(e) => { setCode(e.target.value); setProblem(null); redeem.reset(); }} autoComplete="off"
                  spellCheck={false} placeholder={t("billing.paywall.codePlaceholder", "For example SPRING-50")} className="uppercase sm:max-w-xs" disabled={redeem.isPending} />
                <Button type="submit" disabled={redeem.isPending || !workspaceId}>{redeem.isPending ? t("billing.paywall.redeeming", "Redeeming…") : t("billing.paywall.redeem", "Redeem")}</Button>
              </div>
              {(problem || (redeem.isError && !(redeem.error instanceof FunctionError && redeem.error.messageKey === "billing.coupon.useAtCheckout"))) && (
                <p role="alert" className="text-[13px] text-danger">{problem ?? checkoutErrorText(redeem.error)}</p>
              )}
            </form>
          )}
        </div>
      )}
    </Modal>
  );
}
