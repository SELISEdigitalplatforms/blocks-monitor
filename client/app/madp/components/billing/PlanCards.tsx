/** The plans to choose from (Free, Classic, Speed, Enterprise): a plan is confirmed at checkout
 *  (/billing/checkout?plan=<key>: moving up starts at once, moving down on the renewal day), and Enterprise sends a short
 *  prefilled "Contact sales" message (billing.requestPurchase {planKey, note}). No payment is taken in this dialog. */
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Check } from "lucide-react";
import { cn } from "@/madp/lib/cn";
import { Button, Chip, EmptyState, Label, Modal, Textarea } from "@/madp/ui/kit";
import { useT } from "@/madp/i18n";
import { billingErrorText, useBillingPlans, useRequestPurchase } from "./billingData";
import type { BillingPlan } from "./types";
import { NOTE_MAX, contactSalesDraft, planCreditText, planPriceText, planTagline, streamsText } from "./usageText";

/** One plan as a card: name, price, the help it brings, its credit and its lines; the current plan is marked. */
export function PlanCard({ plan, current, selected, onSelect }: {
  plan: BillingPlan; current: boolean; selected: boolean; onSelect: () => void;
}) {
  const t = useT();
  const priceText = planPriceText(plan);
  return (
    <button type="button" onClick={onSelect} aria-pressed={selected} disabled={current}
      className={cn("flex h-full min-w-0 flex-col rounded-card p-5 text-left outline-none ring-1 ring-inset transition focus-visible:ring-2 focus-visible:ring-accent/60",
        selected ? "bg-accent-soft ring-2 ring-accent" : "bg-surface ring-line hover:bg-surface2",
        current && "cursor-default bg-surface2 hover:bg-surface2")}>
      <div className="flex items-center justify-between gap-2">
        <span className="text-[16px] font-medium text-ink">{plan.name}</span>
        {current ? <Chip>{t("billing.plans.yourPlan", "Your plan")}</Chip> : selected ? <Check size={16} className="text-[rgb(var(--c-accent-text))]" aria-hidden /> : null}
      </div>
      <div className="num mt-3 text-[24px] font-medium leading-none tracking-[-0.02em] text-ink">
        {priceText ?? t("billing.plans.contactSales", "Contact sales")}
      </div>
      <p className="mt-2 text-[13px] text-ink2">{planTagline(plan)}</p>
      <ul className="mt-4 space-y-1.5 border-t border-line pt-4 text-[13px] text-ink2">
        <li className="num">{planCreditText(plan)}</li>
        <li className="num">{streamsText(plan.maxParallelStreams)}</li>
        {plan.features.slice(0, 4).map((f) => <li key={f}>{f}</li>)}
      </ul>
    </button>
  );
}

/** The plan grid, one column on a phone, two on a tablet, four on a wide screen. */
export function PlanGrid({ plans, currentKey, selectedKey, onSelect }: {
  plans: BillingPlan[]; currentKey: string | null; selectedKey: string | null; onSelect: (key: string) => void;
}) {
  const t = useT();
  return (
    <div role="group" aria-label={t("billing.plans.groupLabel", "Plans")} className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
      {plans.map((p) => (
        <PlanCard key={p.key} plan={p} current={p.key === currentKey} selected={p.key === selectedKey} onSelect={() => onSelect(p.key)} />
      ))}
    </div>
  );
}

/** The contact-sales request: a short message, prefilled, that the person can change. */
export function ContactSalesForm({ value, onChange, disabled }: { value: string; onChange: (v: string) => void; disabled?: boolean }) {
  const t = useT();
  return (
    <div>
      <Label>{t("billing.plans.salesMessageLabel", "Your message to our sales team")}</Label>
      <Textarea value={value} onChange={(e) => onChange(e.target.value.slice(0, NOTE_MAX))} rows={5} disabled={disabled} aria-label={t("billing.plans.salesMessageLabel", "Your message to our sales team")} />
      <p className="num mt-1 text-[12px] text-ink3">{t("billing.plans.salesReplyNote", "We reply by e-mail within one working day. {count}/{max}", { count: value.length, max: NOTE_MAX })}</p>
    </div>
  );
}

/** "Change plan": pick a plan and send the request; Enterprise sends a contact-sales message instead. */
export function ChangePlanDialog({ open, onClose, workspaceId, workspaceName, currentKey, pending = null, initialKey = null }: {
  open: boolean; onClose: () => void; workspaceId: string | null; workspaceName: string | null; currentKey: string | null;
  /** a request that already waits for approval, in words */
  pending?: string | null;
  /** the plan picked before (pricing page -> sign-up): selected when the dialog first opens */
  initialKey?: string | null;
}) {
  const t = useT();
  const navigate = useNavigate();
  const plans = useBillingPlans(open);
  const request = useRequestPurchase(workspaceId);
  const [selected, setSelected] = useState<string | null>(initialKey);
  const [note, setNote] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const plan = plans.data?.find((p) => p.key === selected) ?? null;
  const sales = plan?.contactSales === true;
  const message = note ?? contactSalesDraft(workspaceName, plan?.name);

  const close = () => {
    onClose();
    setSelected(null);
    setNote(null);
    setSent(false);
    request.reset();
  };
  const send = () => {
    if (!plan) return;
    if (!sales) {
      close();
      navigate(`/billing/checkout?plan=${encodeURIComponent(plan.key)}`);
      return;
    }
    request.mutate({ planKey: plan.key, note: message }, {
      onSuccess: () => setSent(true),
    });
  };

  const footer = sent ? (
    <Button variant="primary" onClick={close}>{t("billing.plans.done", "Done")}</Button>
  ) : (
    <>
      <Button variant="ghost" onClick={close}>{t("billing.plans.cancel", "Cancel")}</Button>
      <Button variant="primary" disabled={!plan || request.isPending || !workspaceId} onClick={send}>
        {request.isPending ? t("billing.plans.sending", "Sending…") : sales ? t("billing.plans.contactSales", "Contact sales")
          : plan ? t("billing.plans.continueWith", "Continue with {plan}", { plan: plan.name }) : t("billing.plans.choosePlan", "Choose a plan")}
      </Button>
    </>
  );

  return (
    <Modal open={open} onClose={close} title={t("billing.plans.changePlanTitle", "Change plan")} width={1040} footer={footer}>
      {sent ? (
        <p role="status" className="rounded-block bg-success-soft px-4 py-3 text-[14px] text-ink">{t("billing.plans.salesSent", "Thank you. Our sales team has your message and replies by e-mail within one working day.")}</p>
      ) : plans.isPending ? (
        <p role="status" className="text-[14px] text-ink3">{t("billing.plans.loading", "Loading the plans…")}</p>
      ) : !plans.data || plans.data.length === 0 ? (
        <EmptyState title={t("billing.plans.unavailableTitle", "Plans can't be shown right now")} text={t("billing.plans.unavailableText", "Try again in a moment. Your current plan and credit are not affected.")} />
      ) : (
        <div className="space-y-5">
          <p className="text-[14px] text-ink2">{t("billing.plans.intro", "Choose the plan that fits how you work and confirm it at checkout. Moving up starts at once; moving down takes effect on your renewal day.")}</p>
          {pending && <p role="status" className="rounded-block bg-surface2 px-4 py-3 text-[14px] text-ink2">{pending}</p>}
          <PlanGrid plans={plans.data} currentKey={currentKey} selectedKey={selected} onSelect={(k) => { setSelected(k); request.reset(); }} />
          {sales && <ContactSalesForm value={message} onChange={setNote} disabled={request.isPending} />}
          {request.isError && <p role="alert" className="text-[13px] text-danger">{billingErrorText(request.error)}</p>}
        </div>
      )}
    </Modal>
  );
}
