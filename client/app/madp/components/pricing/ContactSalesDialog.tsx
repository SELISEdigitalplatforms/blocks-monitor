/** "Contact sales" for a signed-in person: the short, prefilled message of Settings (ContactSalesForm), sent as the
 *  organization's plan request (billing.requestPurchase {planKey, note}); the sales team answers by e-mail. A visitor who
 *  is not signed in goes to sign-up first (the pricing card links there), so the request always has an account to answer. */
import { useState } from "react";
import { useT } from "@/madp/i18n";
import { Button, Modal } from "@/madp/ui/kit";
import { useCurrentWorkspace } from "@/madp/state/workspaces";
import type { PublicPlan } from "@/madp/domain/publicPlans";
import { ContactSalesForm } from "@/madp/components/billing/PlanCards";
import { billingErrorText, useRequestPurchase } from "@/madp/components/billing/billingData";
import { contactSalesDraft } from "@/madp/components/billing/usageText";

export function ContactSalesDialog({ plan, onClose }: { plan: PublicPlan | null; onClose: () => void }) {
  const t = useT();
  const ws = useCurrentWorkspace();
  const request = useRequestPurchase(ws?.id);
  const [note, setNote] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const message = note ?? contactSalesDraft(ws?.name ?? null, plan?.name);

  const close = () => {
    onClose();
    setNote(null);
    setSent(false);
    request.reset();
  };
  const send = () => {
    if (!plan || !ws) return;
    request.mutate({ planKey: plan.key, note: message }, { onSuccess: () => setSent(true) });
  };

  const footer = sent ? (
    <Button variant="primary" onClick={close}>{t("common.actions.done", "Done")}</Button>
  ) : (
    <>
      <Button variant="ghost" onClick={close}>{t("common.actions.cancel", "Cancel")}</Button>
      <Button variant="primary" disabled={!ws || request.isPending || !message.trim()} onClick={send}>
        {request.isPending ? t("pricing.contact.sending", "Sending…") : t("pricing.contact.send", "Send to sales")}
      </Button>
    </>
  );

  return (
    <Modal open={plan !== null} onClose={close} title={t("pricing.contact.title", "Talk to us about {plan}", { plan: plan?.name ?? "Enterprise" })} footer={footer}>
      {sent ? (
        <p role="status" className="rounded-block bg-success-soft px-4 py-3 text-[14px] text-ink">
          {t("pricing.contact.sent", "Thank you. Our sales team has your message and replies by e-mail within one working day.")}
        </p>
      ) : (
        <div className="space-y-4">
          <p className="text-[14px] text-ink2">
            {t("pricing.contact.intro", "Tell us a little about your team and what you plan to build. We agree the credit, the parallel builds and the team with you.")}
          </p>
          {ws ? (
            <ContactSalesForm value={message} onChange={setNote} disabled={request.isPending} />
          ) : (
            <p role="status" className="rounded-block bg-surface2 px-4 py-3 text-[14px] text-ink2">
              {t("pricing.contact.orgLoading", "Your organization is still loading. Try again in a moment.")}
            </p>
          )}
          {request.isError && <p role="alert" className="text-[13px] text-danger">{billingErrorText(request.error)}</p>}
        </div>
      )}
    </Modal>
  );
}
