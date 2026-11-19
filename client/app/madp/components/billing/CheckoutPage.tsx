/** /billing/checkout?plan=<key>[&code=<code>]: buying a plan the way AI subscriptions are bought. The order summary
 *  (plan, price, credit, help, renewal day), "Have a code?" with live checking, the payment step (a code today; card
 *  payments say plainly they are being connected, never a card form), confirm, and the receipt. Free switches the plan
 *  (at renewal when moving down); Enterprise goes to sales. Every figure is the server's (billing.checkout.*). */
import { useEffect, useRef, useState, type FormEvent } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { CheckCircle2, CreditCard, Receipt, Ticket } from "lucide-react";
import { cn } from "@/madp/lib/cn";
import { Button, Card, Chip, EmptyState, Input, PageHeader } from "@/madp/ui/kit";
import { useCurrentWorkspace } from "@/madp/state/workspaces";
import { useT } from "@/madp/i18n";
import type { CheckoutView } from "@/madp/domain/payments";
import { ContactSalesDialog } from "@/madp/components/pricing/ContactSalesDialog";
import { couponProblem, normaliseCoupon, useBillingPlans } from "./billingData";
import { applyCheckoutCode, checkoutErrorText, startCheckout, useBillingAccount, useChangePlan, useConfirmCheckout } from "./checkoutData";
import { dayText, dueSentence, money, paidWith, summaryLines } from "./checkoutText";
import { FunctionError } from "@/madp/blocks/fn";
import type { BillingPlan } from "./types";
import { rewritePath } from "@/madp/lib/pathPrefix";

/** A button that opens a page (a button, never a button inside a link). */
function GoButton({ to, variant, children }: { to: string; variant?: "primary" | "ghost"; children: string }) {
  const navigate = useNavigate();
  return <Button variant={variant} onClick={() => navigate(to)}>{children}</Button>;
}

const keyOf = (e: unknown): string => (e instanceof FunctionError ? e.messageKey ?? e.code : "");

export default function CheckoutPage() {
  const [params] = useSearchParams();
  const planKey = (params.get("plan") ?? "").trim().toLowerCase();
  const code = params.get("code") ?? "";
  const ws = useCurrentWorkspace();
  const plans = useBillingPlans(true);
  const plan = plans.data?.find((p) => p.key === planKey) ?? null;

  if (!planKey) return <NoPlan />;
  if (!ws || plans.isPending) return <Loading />;
  if (!plan) {
    return plans.isError ? <Unavailable /> : <NoPlan unknown />;
  }
  if (plan.contactSales || plan.priceUsd === null) return <SalesStep plan={plan} />;
  if (plan.priceUsd <= 0) return <FreeStep plan={plan} workspaceId={ws.id} />;
  return <PaidCheckout plan={plan} workspaceId={ws.id} workspaceName={ws.name} initialCode={code} />;
}

function Loading() {
  const t = useT();
  return (
    <div role="status" aria-label={t("billing.checkout.loading", "Loading checkout")} className="flex flex-col gap-6">
      <span className="block h-9 w-72 animate-pulse rounded-full bg-surface2 motion-reduce:animate-none" />
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_380px]">
        <span className="hatched block h-64 rounded-card bg-surface2" />
        <span className="hatched block h-64 rounded-card bg-surface2" />
      </div>
    </div>
  );
}

function Unavailable() {
  const t = useT();
  return (
    <>
      <PageHeader eyebrow={t("billing.checkout.eyebrow", "Checkout")} title={t("billing.checkout.unavailableTitle", "Checkout isn't available right now")} />
      <EmptyState title={t("billing.checkout.plansUnreadableTitle", "The plans can't be read right now")} text={t("billing.checkout.plansUnreadableText", "Try again in a moment. Nothing was charged and your plan is unchanged.")}
        action={<Link to="/pricing" className="text-[14px] font-medium text-[rgb(var(--c-accent-text))] underline-offset-4 hover:underline">{t("billing.checkout.seePlans", "See the plans")}</Link>} />
    </>
  );
}

function NoPlan({ unknown = false }: { unknown?: boolean }) {
  const t = useT();
  return (
    <>
      <PageHeader eyebrow={t("billing.checkout.eyebrow", "Checkout")} title={unknown ? t("billing.checkout.planNotOffered", "This plan is not offered") : t("billing.checkout.choosePlanFirst", "Choose a plan first")} />
      <EmptyState title={unknown ? t("billing.checkout.planNotOfferedTitle", "We don't offer this plan") : t("billing.checkout.noPlanChosen", "No plan chosen")} text={t("billing.checkout.pickPlanText", "Pick the plan that fits how you work on the pricing page.")}
        action={<GoButton to="/pricing" variant="primary">{t("billing.checkout.seePlans", "See the plans")}</GoButton>} />
    </>
  );
}

function SalesStep({ plan }: { plan: BillingPlan }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  return (
    <>
      <PageHeader eyebrow={t("billing.checkout.eyebrow", "Checkout")} title={t("billing.checkout.salesTitle", "{plan} is agreed with you", { plan: plan.name })} subtitle={t("billing.checkout.salesSubtitle", "Credit, parallel builds and the team are set together with our sales team. There is nothing to pay here.")} />
      <Card>
        <div className="flex flex-wrap items-center gap-4">
          <p className="min-w-0 flex-1 basis-72 text-[14px] text-ink2">{t("billing.checkout.salesText", "Tell us about your team and what you plan to build. We reply by e-mail within one working day.")}</p>
          <Button variant="primary" onClick={() => setOpen(true)}>{t("billing.checkout.contactSales", "Contact sales")}</Button>
        </div>
      </Card>
      <ContactSalesDialog plan={open ? { ...plan, creditUsd: plan.creditUsd ?? 0, priority: plan.priority ?? 0 } : null} onClose={() => setOpen(false)} />
    </>
  );
}

/** Free: no payment. Moving down from a paid plan takes effect on the renewal day. */
function FreeStep({ plan, workspaceId }: { plan: BillingPlan; workspaceId: string }) {
  const t = useT();
  const account = useBillingAccount(workspaceId);
  const change = useChangePlan(workspaceId);
  const sub = account.data?.subscription;
  const answer = change.data;
  return (
    <>
      <PageHeader eyebrow={t("billing.checkout.eyebrow", "Checkout")} title={t("billing.checkout.switchTo", "Switch to {plan}", { plan: plan.name })} subtitle={t("billing.checkout.freeSubtitle", "Free has no monthly price. Credit you have left stays until you use it.")} />
      <Card>
        {account.isPending ? (
          <p role="status" className="text-[14px] text-ink3">{t("billing.checkout.readingPlan", "Reading your plan…")}</p>
        ) : account.isError || !sub ? (
          <p role="alert" className="text-[14px] text-danger">{checkoutErrorText(account.error)}</p>
        ) : answer?.action === "scheduled" ? (
          <Done title={t("billing.checkout.movesOn", "Your organization moves to {plan} on {date}", { plan: plan.name, date: dayText(answer.effectiveAt) })}
            text={t("billing.checkout.keepUntilResume", "Until then you keep {current} and its credit. You can resume {current} before that day on the Billing page.", { current: sub.planName })} />
        ) : sub.planKey === plan.key ? (
          <Done title={t("billing.checkout.youreOn", "You're on {plan}", { plan: plan.name })} text={t("billing.checkout.nothingToChange", "There is nothing to change.")} />
        ) : sub.nextPlan?.key === plan.key || sub.cancelAtPeriodEnd ? (
          <Done title={t("billing.checkout.movesOn", "Your organization moves to {plan} on {date}", { plan: plan.name, date: dayText(sub.renewsAt) })} text={t("billing.checkout.staysUntilThen", "{current} stays until then.", { current: sub.planName })} />
        ) : (
          <div className="flex flex-col gap-4">
            <p className="text-[14px] text-ink2">
              {sub.status === "past_due"
                ? t("billing.checkout.pastDueSwitch", "The {current} plan's payment is due. Switching ends it now; credit you have left stays.", { current: sub.planName })
                : sub.renewsAt
                  ? t("billing.checkout.staysUntilDate", "{current} stays until {date}. On that day your organization moves to {plan}; nothing is refunded and no credit is taken back.", { current: sub.planName, date: dayText(sub.renewsAt), plan: plan.name })
                  : t("billing.checkout.movesNow", "Your organization moves to {plan}.", { plan: plan.name })}
            </p>
            {change.isError && <p role="alert" className="text-[13px] text-danger">{checkoutErrorText(change.error)}</p>}
            <div><Button variant="primary" disabled={change.isPending} onClick={() => change.mutate(plan.key)}>{change.isPending ? t("billing.checkout.switching", "Switching…") : t("billing.checkout.switchTo", "Switch to {plan}", { plan: plan.name })}</Button></div>
          </div>
        )}
      </Card>
    </>
  );
}

function Done({ title, text }: { title: string; text: string }) {
  const t = useT();
  return (
    <div role="status" className="flex flex-col gap-4">
      <div className="flex items-start gap-3">
        <CheckCircle2 size={20} className="mt-0.5 shrink-0 text-[rgb(var(--c-success-text))]" aria-hidden />
        <div className="min-w-0">
          <div className="text-[16px] font-medium text-ink">{title}</div>
          <p className="mt-1 text-[14px] text-ink2">{text}</p>
        </div>
      </div>
      <div className="flex flex-wrap gap-3">
        <GoButton to="/billing">{t("billing.checkout.billingAndReceipts", "Billing and receipts")}</GoButton>
        <GoButton to={rewritePath("/dashboard")} variant="ghost">{t("billing.checkout.backToProjects", "Back to your projects")}</GoButton>
      </div>
    </div>
  );
}

function PaidCheckout({ plan, workspaceId, workspaceName, initialCode }: { plan: BillingPlan; workspaceId: string; workspaceName: string; initialCode: string }) {
  const t = useT();
  const navigate = useNavigate();
  const start = useQuery({
    queryKey: ["ws", workspaceId, "billing", "checkout", plan.key],
    queryFn: () => startCheckout({ workspaceId, planKey: plan.key }),
    staleTime: Infinity,
    refetchOnWindowFocus: false,
    retry: false,
  });
  const [checkout, setCheckout] = useState<CheckoutView | null>(null);
  useEffect(() => {
    if (start.data) setCheckout(start.data);
  }, [start.data]);
  const confirm = useConfirmCheckout(workspaceId);
  const change = useChangePlan(workspaceId);
  const current = checkout ?? start.data ?? null;

  if (start.isPending) return <Loading />;
  if (start.isError) {
    const key = keyOf(start.error);
    if (key === "billing.checkout.alreadyOnPlan") {
      return (
        <>
          <PageHeader eyebrow={t("billing.checkout.eyebrow", "Checkout")} title={t("billing.checkout.youreOn", "You're on {plan}", { plan: plan.name })} />
          <Card><Done title={t("billing.checkout.isYourPlan", "{plan} is your plan", { plan: plan.name })} text={t("billing.checkout.manageOnBilling", "Change, cancel or see your receipts on the Billing page.")} /></Card>
        </>
      );
    }
    if (key === "billing.checkout.downgradeAtRenewal") {
      const answer = change.data;
      return (
        <>
          <PageHeader eyebrow={t("billing.checkout.eyebrow", "Checkout")} title={t("billing.checkout.moveTo", "Move to {plan}", { plan: plan.name })} subtitle={t("billing.checkout.downgradeSubtitle", "A lower plan starts on your renewal day. Nothing is refunded and no credit is taken back.")} />
          <Card>
            {answer?.action === "scheduled" ? (
              <Done title={t("billing.checkout.movesOn", "Your organization moves to {plan} on {date}", { plan: plan.name, date: dayText(answer.effectiveAt) })} text={t("billing.checkout.keepCurrentUntil", "Until then you keep your current plan and its credit.")} />
            ) : (
              <div className="flex flex-col gap-4">
                {change.isError && <p role="alert" className="text-[13px] text-danger">{checkoutErrorText(change.error)}</p>}
                <div><Button variant="primary" disabled={change.isPending} onClick={() => change.mutate(plan.key)}>{change.isPending ? t("billing.checkout.saving", "Saving…") : t("billing.checkout.moveAtRenewal", "Move to {plan} at renewal", { plan: plan.name })}</Button></div>
              </div>
            )}
          </Card>
        </>
      );
    }
    return (
      <>
        <PageHeader eyebrow={t("billing.checkout.eyebrow", "Checkout")} title={t("billing.checkout.planTitle", "{plan} plan", { plan: plan.name })} />
        <EmptyState title={t("billing.checkout.cantStart", "Checkout can't start")} text={checkoutErrorText(start.error)}
          action={<GoButton to="/billing">{t("billing.checkout.billingAndReceipts", "Billing and receipts")}</GoButton>} />
      </>
    );
  }
  if (!current) return <Loading />;

  if (current.status === "paid" && current.receipt) {
    return <Paid checkout={current} workspaceName={workspaceName} onDone={() => navigate(rewritePath("/dashboard"))} />;
  }

  const closed = current.status !== "open";
  return (
    <>
      <PageHeader eyebrow={t("billing.checkout.eyebrow", "Checkout")} title={current.kind === "upgrade" ? t("billing.checkout.upgradeTo", "Upgrade to {plan}", { plan: plan.name }) : t("billing.checkout.planTitle", "{plan} plan", { plan: plan.name })}
        subtitle={current.kind === "upgrade"
          ? t("billing.checkout.upgradeSubtitle", "For {org}. The new plan starts now; your renewal day stays.", { org: workspaceName })
          : t("billing.checkout.monthlySubtitle", "For {org}. Monthly, cancel at the end of any period.", { org: workspaceName })} />
      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_380px]">
        <div className="flex min-w-0 flex-col gap-6">
          <Card title={t("billing.checkout.haveCode", "Have a code?")} icon={<Ticket size={18} strokeWidth={1.75} />}>
            <CodeField checkout={current} initialCode={initialCode} disabled={closed || confirm.isPending} onChange={setCheckout} />
          </Card>
          <Card title={t("billing.checkout.payment", "Payment")} icon={<CreditCard size={18} strokeWidth={1.75} />}>
            <PaymentStep checkout={current} />
            {closed && <p role="alert" className="mt-3 text-[13px] text-danger">{t("billing.checkout.closedReload", "This checkout has closed. Reload the page to start again with today's price.")}</p>}
            {confirm.isError && <p role="alert" className="mt-3 text-[13px] text-danger">{checkoutErrorText(confirm.error)}</p>}
            <div className="mt-5 flex flex-wrap items-center gap-3">
              <Button variant="primary" disabled={!current.canConfirm || confirm.isPending}
                onClick={() => confirm.mutate(current.id, {
                  // Blocks Utilities answers its secure payment page when something is due: the buyer pays there and comes back.
                  onSuccess: (r) => (r.checkout.redirectUrl ? window.location.assign(r.checkout.redirectUrl) : setCheckout(r.checkout)),
                })}>
                {confirm.isPending ? t("billing.checkout.confirming", "Confirming…")
                  : current.redirectUrl ? t("billing.checkout.openPaymentPage", "Open the secure payment page")
                  : current.kind === "upgrade" ? t("billing.checkout.confirmUpgrade", "Confirm the upgrade") : t("billing.checkout.confirmStart", "Confirm and start {plan}", { plan: plan.name })}
              </Button>
              <Link to="/pricing" className="text-[14px] text-ink2 underline-offset-4 hover:text-ink hover:underline">{t("billing.checkout.comparePlans", "Compare plans")}</Link>
            </div>
          </Card>
        </div>
        <OrderSummary checkout={current} />
      </div>
    </>
  );
}

/** The right column: what the plan brings, what is due today. */
export function OrderSummary({ checkout }: { checkout: CheckoutView }) {
  const t = useT();
  const { plan, money: lines } = summaryLines(checkout);
  return (
    <Card title={t("billing.checkout.orderSummary", "Order summary")} icon={<Receipt size={18} strokeWidth={1.75} />} className="lg:sticky lg:top-6">
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-[16px] font-medium text-ink">{checkout.plan.name}</span>
        {checkout.fromPlan && <Chip>{t("billing.checkout.fromPlan", "from {plan}", { plan: checkout.fromPlan.name })}</Chip>}
      </div>
      <dl className="mt-3 space-y-2 text-[14px]">
        {plan.map((l) => (
          <div key={l.label} className="flex justify-between gap-4">
            <dt className="text-ink3">{l.label}</dt>
            <dd className="num text-right text-ink">{l.value}</dd>
          </div>
        ))}
      </dl>
      <dl className="mt-4 space-y-2 border-t border-line pt-4 text-[14px]">
        {lines.map((l) => (
          <div key={l.label} className={cn("flex justify-between gap-4", l.tone === "total" && "border-t border-line pt-2")}>
            <dt className={cn("min-w-0", l.tone === "total" ? "font-medium text-ink" : "text-ink2")}>{l.label}</dt>
            <dd className={cn("num shrink-0 text-right", l.tone === "total" ? "text-[18px] font-medium text-ink" : l.tone === "discount" ? "text-[rgb(var(--c-success-text))]" : "text-ink")}>{l.value}</dd>
          </div>
        ))}
      </dl>
      <p className="mt-4 text-[13px] text-ink2">{dueSentence(checkout)}</p>
    </Card>
  );
}

/** The payment step: a code pays today; card payments say plainly that they are being connected. */
export function PaymentStep({ checkout }: { checkout: CheckoutView }) {
  const t = useT();
  if (checkout.dueUsd === 0) {
    return <p className="text-[14px] text-ink2">{dueSentence(checkout)} {t("billing.checkout.confirmToStart", "Confirm to start the plan; your credit is added at once.")}</p>;
  }
  if (!checkout.provider.acceptsCards) {
    return (
      <div role="status" className="rounded-block bg-surface2 px-4 py-3 text-[14px] text-ink2">
        <div className="font-medium text-ink">{t("billing.checkout.cardsConnecting", "Card payments are being connected")}</div>
        <p className="mt-1">{checkout.blocker ?? checkout.provider.message} {t("billing.checkout.voucherAbove", "If you have a voucher from our sales team, enter it above.")}</p>
      </div>
    );
  }
  return <p className="text-[14px] text-ink2">{dueSentence(checkout)}</p>;
}

/** "Have a code?": checked as it is typed (once the code has its shape), applied, removable. */
export function CodeField({ checkout, initialCode, disabled, onChange }: {
  checkout: CheckoutView; initialCode: string; disabled: boolean; onChange: (c: CheckoutView) => void;
}) {
  const t = useT();
  const [text, setText] = useState(initialCode);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const tried = useRef<string>(checkout.code?.code ?? "");
  const apply = async (raw: string) => {
    const code = normaliseCoupon(raw);
    tried.current = code;
    setBusy(true);
    setError(null);
    try {
      onChange(await applyCheckoutCode(checkout.id, code));
    } catch (e) {
      setError(checkoutErrorText(e));
    } finally {
      setBusy(false);
    }
  };
  // live check: a code with its full shape is checked after a short pause in typing
  useEffect(() => {
    const code = normaliseCoupon(text);
    if (disabled || !code || couponProblem(code) || code === tried.current) return;
    const timer = setTimeout(() => void apply(code), 700);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text, disabled]);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const problem = couponProblem(text);
    if (problem) return setError(problem);
    void apply(text);
  };
  if (checkout.code) {
    return (
      <div className="flex flex-wrap items-center gap-3">
        <Chip tone="success" icon={<CheckCircle2 size={14} aria-hidden />}>{checkout.code.code}</Chip>
        <span className="min-w-0 flex-1 basis-48 text-[14px] text-ink2">{checkout.code.description}</span>
        <Button size="sm" variant="ghost" disabled={disabled || busy} onClick={() => { setText(""); tried.current = ""; void apply(""); }}>{t("billing.checkout.remove", "Remove")}</Button>
      </div>
    );
  }
  return (
    <form onSubmit={submit} className="flex flex-col gap-2" noValidate>
      <label htmlFor="checkout-code" className="text-[13px] text-ink2">{t("billing.checkout.codeHelp", "A voucher from our sales team pays for a plan, takes a discount off or adds credit.")}</label>
      <div className="flex flex-col gap-2 sm:flex-row">
        <Input id="checkout-code" value={text} onChange={(e) => { setText(e.target.value); setError(null); }} autoComplete="off" spellCheck={false}
          placeholder={t("billing.checkout.codePlaceholder", "For example SPRING-50")} aria-invalid={error ? true : undefined} disabled={disabled} className="uppercase sm:max-w-xs" />
        <Button type="submit" variant="ghost" disabled={disabled || busy}>{busy ? t("billing.checkout.checking", "Checking…") : t("billing.checkout.apply", "Apply")}</Button>
      </div>
      {error && <p role="alert" className="text-[13px] text-danger">{error}</p>}
    </form>
  );
}

/** After confirm: the plan is active, the receipt. */
export function Paid({ checkout, workspaceName, onDone }: { checkout: CheckoutView; workspaceName: string; onDone: () => void }) {
  const t = useT();
  const r = checkout.receipt!;
  const rows: [string, string][] = [
    [t("billing.receipt.receipt", "Receipt"), r.receiptNo ?? ""],
    [t("billing.receipt.date", "Date"), dayText(r.paidAt)],
    [t("billing.receipt.organization", "Organization"), workspaceName],
    [t("billing.receipt.plan", "Plan"), r.kind === "upgrade" ? t("billing.receipt.planUpgrade", "{plan} (upgrade)", { plan: r.planName }) : r.planName],
    [t("billing.receipt.period", "Period"), t("billing.receipt.periodRange", "{from} to {to}", { from: dayText(r.periodStart), to: dayText(r.periodEnd) })],
    [t("billing.receipt.amount", "Amount"), money(r.amountUsd)],
    ...(r.discountUsd > 0 ? [[t("billing.receipt.code", "Code"), `${r.couponCode ?? ""} (− ${money(r.discountUsd)})`] as [string, string]] : []),
    [t("billing.receipt.paid", "Paid"), `${money(r.paidUsd)} · ${paidWith(r)}`],
    [t("billing.receipt.creditAdded", "Credit added"), money(r.creditUsd)],
    ...(r.paidThrough ? [[t("billing.receipt.paidUntil", "Paid until"), dayText(r.paidThrough)] as [string, string]] : []),
  ];
  return (
    <>
      <PageHeader eyebrow={t("billing.checkout.eyebrow", "Checkout")} title={t("billing.receipt.activeTitle", "{plan} is active", { plan: r.planName })} subtitle={t("billing.receipt.activeSubtitle", "Your credit is updated. The plan renews on {date}.", { date: dayText(checkout.renewsOn) })} />
      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_380px]">
        <Card>
          <div className="flex items-start gap-3">
            <CheckCircle2 size={22} className="mt-0.5 shrink-0 text-[rgb(var(--c-success-text))]" aria-hidden />
            <div className="min-w-0">
              <div role="status" className="text-[17px] font-medium text-ink">{t("billing.receipt.thanks", "Thank you. {plan} is on for {org}.", { plan: r.planName, org: workspaceName })}</div>
              <p className="mt-1 text-[14px] text-ink2">{t("billing.receipt.thanksText", "Your agents can use the new credit right away. Receipts stay on the Billing page.")}</p>
            </div>
          </div>
          <div className="mt-5 flex flex-wrap gap-3">
            <Button variant="primary" onClick={onDone}>{t("billing.checkout.backToProjects", "Back to your projects")}</Button>
            <GoButton to="/billing">{t("billing.checkout.billingAndReceipts", "Billing and receipts")}</GoButton>
          </div>
        </Card>
        <Card title={t("billing.receipt.receipt", "Receipt")} icon={<Receipt size={18} strokeWidth={1.75} />}>
          <dl className="space-y-2 text-[14px]">
            {rows.map(([k, v]) => (
              <div key={k} className="flex justify-between gap-4">
                <dt className="text-ink3">{k}</dt>
                <dd className="num min-w-0 break-words text-right text-ink">{v}</dd>
              </div>
            ))}
          </dl>
        </Card>
      </div>
    </>
  );
}
