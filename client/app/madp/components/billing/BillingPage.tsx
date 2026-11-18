/** /billing: the organization's plan and its payments. Current plan, status and renewal day; change plan (checkout:
 *  moving up starts at once, moving down on the renewal day), cancel at the end of the period, resume; the payment
 *  history with receipts. Every member reads; only the organization's owners change anything (billing.payments.list,
 *  billing.subscription.*). */
import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { CalendarClock, FileText, Receipt, Wallet } from "lucide-react";
import { Button, Card, Chip, EmptyState, Modal, PageHeader } from "@/madp/ui/kit";
import { useT } from "@/madp/i18n";
import { useCurrentWorkspace } from "@/madp/state/workspaces";
import type { BillingAccountView, InvoiceView, PaymentView } from "@/madp/domain/payments";
import { byNewest } from "@/madp/lib/newest";
import { ChangePlanDialog } from "./PlanCards";
import { checkoutErrorText, useBillingAccount, useCancelPlan, useResumePlan, useSyncBilling } from "./checkoutData";
import { dayText, money, paidWith, paymentLabel, renewalSentence, subscriptionStatus } from "./checkoutText";

export default function BillingPage() {
  const t = useT();
  const ws = useCurrentWorkspace();
  const account = useBillingAccount(ws?.id);
  return (
    <>
      <PageHeader eyebrow={t("billing.page.eyebrow", "Billing")} title={t("billing.page.title", "Plan and payments")}
        subtitle={ws ? t("billing.page.subtitle", "For {workspace}. Receipts for every payment stay here.", { workspace: ws.name }) : undefined} />
      {!ws || account.isPending ? (
        <div role="status" aria-label={t("billing.page.loading", "Loading your plan")} className="flex flex-col gap-6">
          <span className="hatched block h-40 rounded-card bg-surface2" />
          <span className="hatched block h-56 rounded-card bg-surface2" />
        </div>
      ) : account.isError || !account.data ? (
        <EmptyState icon={<Wallet size={28} strokeWidth={1.75} />} title={t("billing.page.errorTitle", "Your plan can't be shown right now")}
          text={t("billing.page.errorText", "Try again in a moment. Your plan and credit are not affected.")} />
      ) : (
        <BillingView account={account.data} workspaceId={ws.id} workspaceName={ws.name} />
      )}
    </>
  );
}

export function BillingView({ account, workspaceId, workspaceName }: { account: BillingAccountView; workspaceId: string; workspaceName: string }) {
  const t = useT();
  const navigate = useNavigate();
  const s = account.subscription;
  const status = subscriptionStatus(s);
  const cancel = useCancelPlan(workspaceId);
  const resume = useResumePlan(workspaceId);
  const [choosing, setChoosing] = useState(false);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [receipt, setReceipt] = useState<PaymentView | null>(null);
  const sync = useSyncBilling(workspaceId);
  const synced = useRef<string | null>(null);
  // Held in Blocks Utilities: once per visit, its renewals, payments and bought credit are brought here.
  useEffect(() => {
    if (account.source !== "blocks-utilities" || synced.current === workspaceId) return;
    synced.current = workspaceId;
    sync.mutate();
  }, [account.source, workspaceId, sync]);
  const paid = (s.priceUsd ?? 0) > 0;
  const error = cancel.isError ? cancel.error : resume.isError ? resume.error : null;
  const busy = cancel.isPending || resume.isPending;

  return (
    <div className="flex flex-col gap-6">
      <Card title={t("billing.page.currentPlan", "Current plan")} icon={<CalendarClock size={18} strokeWidth={1.75} />}>
        <div className="flex flex-wrap items-start justify-between gap-x-8 gap-y-4">
          <div className="min-w-0 flex-1 basis-72">
            <div className="flex flex-wrap items-center gap-3">
              <span className="text-[24px] font-medium leading-tight tracking-[-0.02em] text-ink">{s.planName}</span>
              <Chip tone={status.tone}>{status.label}</Chip>
            </div>
            <p className="num mt-1 text-[14px] text-ink2">{s.priceUsd ? t("billing.page.perMonth", "{price} a month", { price: money(s.priceUsd) }) : t("billing.page.noMonthlyPrice", "No monthly price")}</p>
            {renewalSentence(s) && <p className="mt-3 text-[14px] text-ink">{renewalSentence(s)}</p>}
            {s.statusNote && s.status !== "past_due" && <p className="mt-2 text-[13px] text-ink2">{s.statusNote}</p>}
          </div>
          {account.canManage && (
            <div className="flex flex-wrap gap-3">
              {s.status === "past_due" ? (
                <Button variant="primary" onClick={() => navigate(`/billing/checkout?plan=${encodeURIComponent(s.planKey)}`)}>{t("billing.page.payWithCode", "Pay with a code")}</Button>
              ) : s.cancelAtPeriodEnd || s.nextPlan ? (
                <Button variant="primary" disabled={busy} onClick={() => resume.mutate()}>{resume.isPending ? t("billing.page.resuming", "Resuming…") : t("billing.page.keepPlan", "Keep {plan}", { plan: s.planName })}</Button>
              ) : (
                <Button variant="primary" onClick={() => setChoosing(true)}>{t("billing.page.changePlan", "Change plan")}</Button>
              )}
              {paid && !s.cancelAtPeriodEnd && (
                <Button variant="ghost" disabled={busy} onClick={() => setConfirmCancel(true)}>{t("billing.page.cancelPlan", "Cancel plan")}</Button>
              )}
            </div>
          )}
        </div>
        {!account.canManage && <p className="mt-4 text-[13px] text-ink3">{t("billing.page.ownersOnly", "Only the organization's owners can change or cancel the plan.")}</p>}
        {error && <p role="alert" className="mt-4 text-[13px] text-danger">{checkoutErrorText(error)}</p>}
        <p className="mt-4 border-t border-line pt-4 text-[13px] text-ink2">
          {account.provider.acceptsCards
            ? t("billing.page.paidByCard", "Plans are paid by card or with a code.")
            : t("billing.page.paidByCode", "Plans are paid with a code from our sales team today. Card payments are being connected.")}
        </p>
      </Card>

      <Card title={t("billing.page.paymentHistory", "Payment history")} icon={<Receipt size={18} strokeWidth={1.75} />}>
        {account.payments.length === 0 ? (
          <p className="text-[14px] text-ink2">{t("billing.page.noPayments", "No payments yet. Each payment and renewal appears here with its receipt.")}</p>
        ) : (
          <PaymentTable payments={account.payments} onOpen={setReceipt} />
        )}
      </Card>

      {account.invoices && (
        <Card title={t("billing.page.invoices", "Invoices")} icon={<FileText size={18} strokeWidth={1.75} />}>
          {account.invoices.length === 0 ? (
            <p className="text-[14px] text-ink2">{t("billing.page.noInvoices", "No invoices yet. Each invoice and credit note appears here.")}</p>
          ) : (
            <InvoiceTable invoices={account.invoices} />
          )}
        </Card>
      )}

      <ChangePlanDialog open={choosing} onClose={() => setChoosing(false)} workspaceId={workspaceId} workspaceName={workspaceName} currentKey={s.planKey} />
      <Modal open={confirmCancel} onClose={() => setConfirmCancel(false)} title={t("billing.page.cancelTitle", "Cancel {plan}?", { plan: s.planName })} footer={
        <>
          <Button variant="ghost" onClick={() => setConfirmCancel(false)}>{t("billing.page.keepPlan", "Keep {plan}", { plan: s.planName })}</Button>
          <Button variant="primary" disabled={cancel.isPending} onClick={() => cancel.mutate(undefined, { onSettled: () => setConfirmCancel(false) })}>
            {cancel.isPending ? t("billing.page.cancelling", "Cancelling…")
              : s.status === "past_due" ? t("billing.page.endNow", "End {plan} now", { plan: s.planName })
              : t("billing.page.cancelAtEnd", "Cancel at the end of the period")}
          </Button>
        </>
      }>
        <p className="text-[14px] text-ink2">
          {s.status === "past_due"
            ? t("billing.page.cancelPastDue", "The payment for this period is due, so {plan} ends now and your organization moves to Free. Credit you have left stays.", { plan: s.planName })
            : t("billing.page.cancelText", "{plan} stays until {date}. After that your organization is on Free. Credit you have left stays, and you can resume before that day.", { plan: s.planName, date: dayText(s.renewsAt) })}
        </p>
      </Modal>
      <ReceiptDialog payment={receipt} workspaceName={workspaceName} onClose={() => setReceipt(null)} />
    </div>
  );
}

export function PaymentTable({ payments, onOpen }: { payments: PaymentView[]; onOpen: (p: PaymentView) => void }) {
  const t = useT();
  return (
    <table className="w-full text-[14px]">
      <caption className="sr-only">{t("billing.page.tableCaption", "Payments of this organization, newest first")}</caption>
      <thead>
        <tr className="text-left text-[12px] text-ink3">
          <th scope="col" className="py-2 pr-3 font-normal">{t("billing.page.colDate", "Date")}</th>
          <th scope="col" className="py-2 pr-3 font-normal">{t("billing.page.colWhat", "What")}</th>
          <th scope="col" className="hidden py-2 pr-3 font-normal md:table-cell">{t("billing.page.colPaidWith", "Paid with")}</th>
          <th scope="col" className="py-2 pr-3 text-right font-normal">{t("billing.page.colPaid", "Paid")}</th>
          <th scope="col" className="py-2 text-right font-normal"><span className="sr-only">{t("billing.page.colReceipt", "Receipt")}</span></th>
        </tr>
      </thead>
      <tbody className="divide-y divide-line border-t border-line">
        {byNewest(payments, (p) => p.paidAt ?? p.periodStart, (p) => p.receiptNo ?? "").map((p) => (
          <tr key={p.id}>
            <td className="num whitespace-nowrap py-3 pr-3 text-ink2">{dayText(p.paidAt ?? p.periodStart)}</td>
            <td className="min-w-0 break-words py-3 pr-3 text-ink">
              {paymentLabel(p)}
              {p.status !== "paid" && <span className="ml-2"><Chip tone={p.status === "failed" ? "danger" : "neutral"}>{p.status === "failed" ? t("billing.page.failed", "Failed") : t("billing.page.refunded", "Refunded")}</Chip></span>}
            </td>
            <td className="hidden py-3 pr-3 text-ink2 md:table-cell">{paidWith(p)}</td>
            <td className="num whitespace-nowrap py-3 pr-3 text-right font-medium text-ink">{money(p.paidUsd)}</td>
            <td className="py-3 text-right"><Button size="sm" variant="ghost" onClick={() => onOpen(p)}>{t("billing.page.receiptButton", "Receipt")}</Button></td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function ReceiptDialog({ payment, workspaceName, onClose }: { payment: PaymentView | null; workspaceName: string; onClose: () => void }) {
  const t = useT();
  const p = payment;
  const rows: [string, string][] = p ? [
    [t("billing.page.receiptNo", "Receipt"), p.receiptNo ?? ""],
    [t("billing.page.receiptDate", "Date"), dayText(p.paidAt)],
    [t("billing.page.receiptOrganization", "Organization"), workspaceName],
    [t("billing.page.receiptFor", "For"), paymentLabel(p)],
    [t("billing.page.receiptAmount", "Amount"), money(p.amountUsd)],
    ...(p.discountUsd > 0 ? [[t("billing.page.receiptCode", "Code"), `${p.couponCode ?? ""} (− ${money(p.discountUsd)})`] as [string, string]] : []),
    [t("billing.page.receiptPaid", "Paid"), `${money(p.paidUsd)} · ${paidWith(p)}`],
    [t("billing.page.receiptCredit", "Credit added"), money(p.creditUsd)],
  ] : [];
  return (
    <Modal open={p !== null} onClose={onClose} title={p ? t("billing.page.receiptTitle", "Receipt {number}", { number: p.receiptNo ?? "" }) : t("billing.page.receiptNo", "Receipt")} footer={
      <>
        <Button variant="ghost" onClick={() => window.print()}>{t("billing.page.print", "Print")}</Button>
        <Button variant="primary" onClick={onClose}>{t("billing.page.close", "Close")}</Button>
      </>
    }>
      <dl className="space-y-2 text-[14px]">
        {rows.map(([k, v]) => (
          <div key={k} className="flex justify-between gap-4">
            <dt className="text-ink3">{k}</dt>
            <dd className="num min-w-0 break-words text-right text-ink">{v}</dd>
          </div>
        ))}
      </dl>
    </Modal>
  );
}

export function InvoiceTable({ invoices }: { invoices: InvoiceView[] }) {
  const t = useT();
  return (
    <table className="w-full text-[14px]">
      <caption className="sr-only">{t("billing.page.invoicesCaption", "Invoices and credit notes of this organization, newest first")}</caption>
      <thead>
        <tr className="text-left text-[12px] text-ink3">
          <th scope="col" className="py-2 pr-3 font-normal">{t("billing.page.colDate", "Date")}</th>
          <th scope="col" className="py-2 pr-3 font-normal">{t("billing.page.colNumber", "Number")}</th>
          <th scope="col" className="hidden py-2 pr-3 font-normal md:table-cell">{t("billing.page.colPeriod", "Period")}</th>
          <th scope="col" className="py-2 text-right font-normal">{t("billing.page.colTotal", "Total")}</th>
        </tr>
      </thead>
      <tbody className="divide-y divide-line border-t border-line">
        {byNewest(invoices, (i) => i.issuedAt, (i) => i.number).map((i) => (
          <tr key={i.id}>
            <td className="num whitespace-nowrap py-3 pr-3 text-ink2">{dayText(i.issuedAt)}</td>
            <td className="min-w-0 break-words py-3 pr-3 text-ink">
              {i.number}
              {i.type === "CreditNote" && <span className="ml-2"><Chip tone="neutral">{t("billing.page.creditNote", "Credit note")}</Chip></span>}
            </td>
            <td className="num hidden whitespace-nowrap py-3 pr-3 text-ink2 md:table-cell">{i.periodStart && i.periodEnd ? t("billing.receipt.periodRange", "{from} to {to}", { from: dayText(i.periodStart), to: dayText(i.periodEnd) }) : ""}</td>
            <td className="num whitespace-nowrap py-3 text-right text-ink">{money(i.total)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
