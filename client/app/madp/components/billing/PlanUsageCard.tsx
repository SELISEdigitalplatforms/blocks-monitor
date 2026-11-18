/** Settings → Plan and usage: the credit left (the card's one focal figure), what was used this month in USD and
 *  tokens, the plan, the agents working now and what each project cost; "Redeem a coupon" and "Change plan". */
import { useState, type FormEvent, type ReactNode } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { Ticket, Wallet } from "lucide-react";
import { cn } from "@/madp/lib/cn";
import { useT } from "@/madp/i18n";
import { Bar, Button, Card, Dot, EmptyState, Input } from "@/madp/ui/kit";
import { useCurrentWorkspace } from "@/madp/state/workspaces";
import { billingErrorText, couponProblem, isBillingMissing, normaliseCoupon, useBillingSummary, useRedeemCoupon } from "./billingData";
import { ChangePlanDialog } from "./PlanCards";
import type { BillingSummary } from "./types";
import {
  agentsText, assistedText, creditNotice, jobsText, creditState, leftUsd, pendingText, renewsText, streamsText, tokensText, usd, usedOf, usedShare,
} from "./usageText";

export type PlanUsageState =
  | { kind: "loading" }
  | { kind: "unavailable"; missing: boolean }
  | { kind: "ready"; summary: BillingSummary };

/** The card's state from the summary read: the last summary stays while a later read fails. */
export function planUsageState(read: { data?: BillingSummary; isError: boolean; error: unknown }, hasWorkspace: boolean): PlanUsageState {
  if (read.data) return { kind: "ready", summary: read.data };
  if (!hasWorkspace) return { kind: "unavailable", missing: true };
  if (read.isError) return { kind: "unavailable", missing: isBillingMissing(read.error) };
  return { kind: "loading" };
}

function Fact({ label, value, sub }: { label: string; value: ReactNode; sub?: ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-[13px] text-ink3">{label}</dt>
      <dd className="num mt-1 text-[17px] font-medium leading-snug text-ink">{value}</dd>
      {sub && <dd className="mt-0.5 text-[13px] text-ink2">{sub}</dd>}
    </div>
  );
}

/** The redeem form: one field and one button, the answer under it. */
export function RedeemCouponForm({ onRedeem, pending, error, done }: {
  onRedeem: (code: string) => void; pending: boolean; error: string | null; done: boolean;
}) {
  const t = useT();
  const [code, setCode] = useState("");
  const [touched, setTouched] = useState(false);
  const problem = couponProblem(code);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    setTouched(true);
    if (!problem) onRedeem(normaliseCoupon(code));
  };
  return (
    <form onSubmit={submit} className="flex flex-col gap-2" noValidate>
      <label htmlFor="coupon-code" className="text-[13px] font-medium text-ink">{t("billing.planUsage.couponCode", "Coupon code")}</label>
      <div className="flex flex-col gap-2 sm:flex-row">
        <Input id="coupon-code" value={code} onChange={(e) => { setCode(e.target.value); setTouched(false); }} autoComplete="off" spellCheck={false}
          placeholder={t("billing.planUsage.couponPlaceholder", "For example SPRING-50")} aria-invalid={touched && problem ? true : undefined} disabled={pending}
          className="uppercase sm:max-w-xs" />
        <Button type="submit" variant="ghost" disabled={pending}>{pending ? t("billing.planUsage.redeeming", "Redeeming…") : t("billing.planUsage.redeem", "Redeem")}</Button>
      </div>
      {touched && problem && <p role="alert" className="text-[13px] text-danger">{problem}</p>}
      {error && <p role="alert" className="text-[13px] text-danger">{error}</p>}
      {done && !error && <p role="status" className="text-[13px] text-[rgb(var(--c-success-text))]">{t("billing.planUsage.redeemed", "Coupon redeemed. Your credit is updated.")}</p>}
    </form>
  );
}

/** The card's body for a state (the connected card passes the live one; tests pass each state). */
export function PlanUsageView({ state, onChangePlan, coupon }: {
  state: PlanUsageState; onChangePlan: () => void; coupon: ReactNode;
}) {
  const t = useT();
  if (state.kind === "loading") {
    return (
      <div role="status" aria-label={t("billing.planUsage.loading", "Loading your plan and usage")} className="space-y-3">
        <span className="block h-9 w-48 animate-pulse rounded-full bg-surface2 motion-reduce:animate-none" />
        <span className="block h-3 w-full animate-pulse rounded-full bg-surface2 motion-reduce:animate-none" />
      </div>
    );
  }
  if (state.kind === "unavailable") {
    return (
      <EmptyState icon={<Wallet size={28} strokeWidth={1.75} />} title={t("billing.planUsage.unavailableTitle", "Plan and usage can't be shown right now")}
        text={state.missing
          ? t("billing.planUsage.unavailableMissing", "Credit and usage appear here once billing is switched on for this workspace. Your projects keep working.")
          : t("billing.planUsage.unavailableError", "Try again in a moment. Your credit and your projects are not affected.")} />
    );
  }
  const s = state.summary;
  const credit = creditState(s);
  const notice = creditNotice(s);
  const used = usedOf(s);
  const pending = pendingText(s);
  const renews = renewsText(s.renewsAt);
  const shown = s.perProject.slice(0, 8);
  const more = s.perProject.length - shown.length;
  return (
    <div className="flex flex-col gap-6">
      {notice && (
        <div role="status" className={cn("flex flex-wrap items-center gap-x-4 gap-y-3 rounded-block px-4 py-3", credit === "out" ? "bg-danger-soft" : "bg-warning-soft")}>
          <p className="flex min-w-0 flex-1 basis-64 items-start gap-3 text-[14px] text-ink">
            <span className="mt-[7px] shrink-0 leading-none"><Dot tone={credit === "out" ? "danger" : "warning"} /></span>
            <span className="min-w-0"><span className="font-medium">{notice.title}.</span> {notice.text}</span>
          </p>
          <Button size="sm" variant="primary" onClick={onChangePlan}>{t("billing.planUsage.changePlan", "Change plan")}</Button>
        </div>
      )}

      {pending && <p role="status" className="rounded-block bg-surface2 px-4 py-3 text-[14px] text-ink2">{pending}</p>}

      {/* the focal figure: what is left */}
      <div className="flex flex-wrap items-end justify-between gap-x-8 gap-y-4">
        <div className="min-w-0">
          <div className="text-[13px] text-ink3">{t("billing.planUsage.creditLeft", "Credit left")}</div>
          <div className={cn("num mt-1 text-[40px] font-medium leading-none tracking-[-0.03em] sm:text-[48px]",
            credit === "out" ? "text-[rgb(var(--c-danger-text))]" : credit === "low" ? "text-[rgb(var(--c-warning-text))]" : "text-ink")}>
            {usd(leftUsd(s))}
          </div>
          {(s.grantedUsd > 0 || renews) && (
            <div className="num mt-2 text-[13px] text-ink2">{[s.grantedUsd > 0 ? t("billing.planUsage.ofCredit", "of {amount} credit", { amount: usd(s.grantedUsd) }) : null, renews].filter(Boolean).join(" · ")}</div>
          )}
        </div>
        {credit === "ok" && <Button onClick={onChangePlan}>{t("billing.planUsage.changePlan", "Change plan")}</Button>}
      </div>
      {s.grantedUsd > 0 && (
        <div>
          <Bar value={usedShare(s)} tone={credit === "out" ? "danger" : credit === "low" ? "warning" : "accent"} className="h-2" />
          <div className="num mt-1.5 flex justify-between text-[12px] text-ink3">
            <span>{t("billing.planUsage.shareUsed", "{share}% used", { share: Math.round(usedShare(s)) })}</span>
            <span>{t("billing.planUsage.shareLeft", "{share}% left", { share: Math.round(100 - usedShare(s)) })}</span>
          </div>
        </div>
      )}

      <dl className="grid grid-cols-1 gap-x-6 gap-y-5 sm:grid-cols-3">
        <Fact label={t("billing.planUsage.plan", "Plan")} value={s.plan?.name ?? t("billing.planUsage.noPlan", "No plan yet")}
          sub={s.plan ? `${assistedText(s.plan.assisted)} · ${streamsText(s.plan.maxParallelStreams)}` : t("billing.planUsage.chooseOne", "Choose one with Change plan.")} />
        <Fact label={used.label} value={usd(used.usd)} sub={tokensText(used.tokens)} />
        <Fact label={t("billing.planUsage.agentsNow", "Agents working now")} value={
          <span className="inline-flex items-center gap-2">{s.activeAgents > 0 && <Dot tone="accent" pulse />}{agentsText(s.activeAgents)}</span>
        } sub={jobsText(s.runningJobs)} />
      </dl>

      <p className="-mt-2 text-[13px] text-ink2">
        <Link to="/billing" className="font-medium text-[rgb(var(--c-accent-text))] underline-offset-4 hover:underline">{t("billing.planUsage.billingLink", "Billing and receipts")}</Link>
        {" "}{t("billing.planUsage.billingLinkNote", "· renewal, plan changes, cancel and payment history")}
      </p>

      <div>
        <h4 className="text-[15px] font-medium text-ink">{t("billing.planUsage.costByProject", "Cost by project")}</h4>
        {s.perProject.length === 0 ? (
          <p className="mt-2 text-[14px] text-ink2">{t("billing.planUsage.noProjects", "No project has used credit yet. Costs appear here as the agents finish their work.")}</p>
        ) : (
          <table className="mt-2 w-full text-[14px]">
            <caption className="sr-only">{t("billing.planUsage.tableCaption", "Cost by project this month")}</caption>
            <thead>
              <tr className="text-left text-[12px] text-ink3">
                <th scope="col" className="py-2 pr-3 font-normal">{t("billing.planUsage.colProject", "Project")}</th>
                <th scope="col" className="hidden py-2 pr-3 text-right font-normal sm:table-cell">{t("billing.planUsage.colTokens", "Tokens")}</th>
                <th scope="col" className="py-2 text-right font-normal">{t("billing.planUsage.colCost", "Cost")}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line border-t border-line">
              {shown.map((p) => (
                <tr key={p.projectId}>
                  <td className="break-words py-3 pr-3 text-ink">{p.name}</td>
                  <td className="num hidden py-3 pr-3 text-right text-ink2 sm:table-cell">{p.tokens.toLocaleString("en-US")}</td>
                  <td className="num py-3 text-right font-medium text-ink">{usd(p.costUsd)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {more > 0 && <p className="mt-2 text-[13px] text-ink3">{more === 1
          ? t("billing.planUsage.moreOne", "and {n} more project", { n: more })
          : t("billing.planUsage.moreMany", "and {n} more projects", { n: more })}</p>}
      </div>

      <div className="border-t border-line pt-5">
        <div className="mb-3 flex items-center gap-2 text-[15px] font-medium text-ink"><Ticket size={16} strokeWidth={1.75} aria-hidden /> {t("billing.planUsage.redeemTitle", "Redeem a coupon")}</div>
        {coupon}
      </div>
    </div>
  );
}

/** The card on the Settings page (id "plan": the pill's "Plan and usage" link and the section chip jump here). */
export function PlanUsageCard() {
  const t = useT();
  const workspace = useCurrentWorkspace();
  const summary = useBillingSummary(workspace?.id);
  const redeem = useRedeemCoupon(workspace?.id);
  // /settings?plan=enterprise#plan (Enterprise picked on the pricing page, then sign-up): the prefilled contact-sales request
  const [params, setParams] = useSearchParams();
  const [asked] = useState(() => (params.get("plan") === "enterprise" ? "enterprise" : null));
  const [choosing, setChoosing] = useState(asked !== null);
  const closeChoosing = () => {
    setChoosing(false);
    if (params.has("plan")) {
      const q = new URLSearchParams(params);
      q.delete("plan");
      setParams(q, { replace: true });
    }
  };
  const state = planUsageState(summary, Boolean(workspace));
  return (
    <div id="plan" tabIndex={-1} className="scroll-mt-6 outline-none">
      <Card title={t("billing.planUsage.title", "Plan and usage")} icon={<Wallet size={18} strokeWidth={1.75} />}>
        <PlanUsageView state={state} onChangePlan={() => setChoosing(true)}
          coupon={<RedeemCouponForm onRedeem={(code) => redeem.mutate(code)} pending={redeem.isPending}
            error={redeem.isError ? billingErrorText(redeem.error) : null} done={redeem.isSuccess} />} />
      </Card>
      <ChangePlanDialog open={choosing} onClose={closeChoosing} workspaceId={workspace?.id ?? null}
        workspaceName={workspace?.name ?? null} currentKey={summary.data?.plan?.key ?? null}
        pending={summary.data ? pendingText(summary.data) : null} initialKey={asked} />
    </div>
  );
}
