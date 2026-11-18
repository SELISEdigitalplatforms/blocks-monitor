// Platform > Credits: every organization's balance (grant, adjust, history), coupons and vouchers, and purchase requests.
import { useMemo, useState, type FormEvent, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { freshnessQuery } from "@/madp/blocks/data/freshness";
import { ArrowDown, ArrowUp, Check, Copy, History, Inbox, Plus, Search, Ticket, Wallet } from "lucide-react";
import { Button, Card, Chip, EmptyState, IconButton, Input, Label, Modal, Segmented, Select, Tabs, Textarea } from "@/madp/ui/kit";
import { callFunction, useFunctionMutation } from "@/madp/blocks/fn";
import { adminErrorMessage } from "@/madp/blocks/admin";
import { BALANCES_KEY, balancesBusy, fetchBalances, type BalancesData } from "../billing/balancesData";
import { MAX_COUPON_MONTHS, usd as centsUsd, type CouponKind } from "@/madp/domain/payments";
import { t, useT } from "@/madp/i18n";
import { cn } from "@/madp/lib/cn";
import {
  COUPON_CODE, MAX_NOTE_LENGTH, couponRefusal, isUsdAmount, normalizeCouponCode,
  type BalanceRow, type CouponView, type CreditEntryView, type CreditKind, type PlanView, type PurchaseView,
} from "@/madp/domain/billing";

/* ── shared bits ─────────────────────────────────────────────────────────── */

const money = (n: number) => n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const usd = (n: number) => `USD ${money(n)}`;
const signedUsd = (n: number) => `${n > 0 ? "+" : n < 0 ? "−" : ""}USD ${money(Math.abs(n))}`;
const compact = (n: number) => {
  const a = Math.abs(n);
  const fmt = (v: number, unit: string) => `${v >= 100 ? Math.round(v) : Number(v.toFixed(1))} ${unit}`;
  if (a >= 1e9) return fmt(n / 1e9, "B");
  if (a >= 1e6) return fmt(n / 1e6, "M");
  if (a >= 1e3) return fmt(n / 1e3, "K");
  return String(Math.round(n));
};
const pad = (n: number) => String(n).padStart(2, "0");
const swissDate = (iso: string | null | undefined) => {
  const t = iso ? Date.parse(iso) : NaN;
  if (Number.isNaN(t)) return "–";
  const d = new Date(t);
  return `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()}`;
};
const swissStamp = (iso: string | null | undefined) => {
  const t = iso ? Date.parse(iso) : NaN;
  if (Number.isNaN(t)) return "–";
  const d = new Date(t);
  return `${swissDate(iso)} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
};
const num = (s: string) => (s.trim() === "" ? NaN : Number(s.trim()));

const TH = "whitespace-nowrap px-4 py-2.5 text-left text-[12px] font-medium uppercase tracking-wider text-ink3";
const TD = "px-4 py-3 align-middle";

const kindLabel = (k: CreditKind): string => {
  switch (k) {
    case "signup": return t("platform.credits.kind.signup", "Sign-up credit");
    case "plan": return t("platform.credits.kind.plan", "Plan credit");
    case "coupon": return t("platform.credits.kind.coupon", "Coupon");
    case "purchase": return t("platform.credits.kind.purchase", "Purchase");
    case "usage": return t("platform.credits.kind.usage", "Usage");
    case "adjustment": return t("platform.credits.kind.adjustment", "Adjustment");
    default: return k;
  }
};

type Notice = { tone: "status" | "alert"; text: string } | null;

function NoticeLine({ notice }: { notice: Notice }) {
  if (!notice) return null;
  return (
    <p role={notice.tone === "alert" ? "alert" : "status"} className={notice.tone === "alert" ? "text-[14px] text-danger" : "text-[14px] text-ink2"}>
      {notice.text}
    </p>
  );
}

function ErrorLine({ error }: { error: unknown }) {
  return <p role="alert" className="text-[14px] text-danger">{adminErrorMessage(error)}</p>;
}

/** A table that scrolls sideways inside its card on narrow screens. */
function TableCard({ children, label }: { children: ReactNode; label: string }) {
  return (
    <Card bodyClassName="p-0">
      <div className="scroll-thin overflow-x-auto" role="region" aria-label={label} tabIndex={0}>
        <table className="w-full min-w-[720px] border-collapse text-[14px]">{children}</table>
      </div>
    </Card>
  );
}

/* ── queries ─────────────────────────────────────────────────────────────── */

const ENTRIES_KEY = ["billing", "entries"] as const;
const COUPONS_KEY = ["billing", "coupons"] as const;
const PURCHASES_KEY = ["billing", "purchases"] as const;
const PLANS_KEY = ["billing", "plans"] as const;
/** Balances and the credit history follow the agents' work (the usage tier: every 10 s while an engine job runs, every
 *  minute otherwise, while the page is open and the tab shown); requests are near; coupons and plans change only by an
 *  edit here, so they are calm (docs/FRESHNESS.md). */
const QUERY = { ...freshnessQuery("near"), retry: 0 } as const;
const CALM = { ...freshnessQuery("calm"), retry: 0 } as const;

const useBalances = () => useQuery({
  queryKey: [...BALANCES_KEY],
  queryFn: fetchBalances,
  select: (d: BalancesData) => d.rows,
  ...freshnessQuery<BalancesData>("usage", { busy: balancesBusy }),
  retry: 0,
});
/** One organization's credit history, at the balances' pace (no read of its own to learn whether work runs). */
const useEntries = (workspaceId: string | null) => {
  const client = useQueryClient();
  return useQuery({
    queryKey: [...ENTRIES_KEY, workspaceId ?? ""],
    queryFn: async () => (await callFunction<{ entries: CreditEntryView[] }>("billing", "billing.entries.list", { workspaceId })).data.entries,
    enabled: Boolean(workspaceId),
    ...freshnessQuery<CreditEntryView[]>("usage", { busy: () => balancesBusy(client.getQueryData<BalancesData>([...BALANCES_KEY])) }),
    retry: 0,
  });
};
const useCoupons = () => useQuery({
  queryKey: [...COUPONS_KEY],
  queryFn: async () => (await callFunction<{ coupons: CouponView[] }>("billing", "billing.coupons.list", {})).data.coupons,
  ...CALM,
});
const usePurchases = () => useQuery({
  queryKey: [...PURCHASES_KEY],
  queryFn: async () => (await callFunction<{ requests: PurchaseView[] }>("billing", "billing.purchases.list", {})).data.requests,
  ...QUERY,
});
/** The same key and answer as the Plans section, so both share one cache entry. */
const usePlans = () => useQuery({
  queryKey: [...PLANS_KEY, { includeInactive: true }],
  queryFn: async () => (await callFunction<{ plans: PlanView[] }>("billing", "billing.plans.list", { includeInactive: true })).data.plans,
  ...CALM,
});

/* ── the section ─────────────────────────────────────────────────────────── */

type Part = "balances" | "coupons" | "requests";

export default function CreditsSection() {
  const t = useT();
  const [part, setPart] = useState<Part>("balances");
  const purchasesQ = usePurchases();
  const pending = (purchasesQ.data ?? []).filter((r) => r.status === "pending").length;

  const tabs: { value: Part; label: ReactNode }[] = [
    { value: "balances", label: t("platform.credits.tabBalances", "Balances") },
    { value: "coupons", label: t("platform.credits.tabCoupons", "Coupons and vouchers") },
    {
      value: "requests",
      label: (
        <span className="inline-flex items-center gap-2">
          {t("platform.credits.tabRequests", "Purchase requests")}
          {purchasesQ.data && (
            <>
              <span aria-hidden className={cn("num rounded-full px-2 py-0.5 text-[12px]",
                pending > 0 ? "bg-accent-soft text-[rgb(var(--c-accent-text))]" : "bg-surface2 text-ink3")}>
                {pending}
              </span>
              <span className="sr-only">{t("platform.credits.pendingWaiting", "{count} waiting", { count: pending })}</span>
            </>
          )}
        </span>
      ),
    },
  ];

  return (
    <div className="grid min-w-0 gap-6">
      <div className="scroll-thin min-w-0 overflow-x-auto">
        <Tabs idPrefix="credits" label={t("platform.credits.tabsLabel", "Credits")} className="max-sm:gap-4" tabs={tabs} value={part} onChange={setPart} />
      </div>
      <div role="tabpanel" id={`credits-panel-${part}`} aria-labelledby={`credits-tab-${part}`} className="min-w-0">
        {part === "balances" && <BalancesPart />}
        {part === "coupons" && <CouponsPart />}
        {part === "requests" && <RequestsPart />}
      </div>
    </div>
  );
}

/* ── (a) balances ────────────────────────────────────────────────────────── */

type SortKey = "name" | "planName" | "balanceUsd" | "grantedUsd" | "consumedUsd" | "tokens";

function BalancesPart() {
  const t = useT();
  const q = useBalances();
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: "balanceUsd", dir: 1 });
  const [filter, setFilter] = useState("");
  const [adjusting, setAdjusting] = useState<BalanceRow | null>(null);
  const [history, setHistory] = useState<BalanceRow | null>(null);
  const [notice, setNotice] = useState<Notice>(null);

  const rows = useMemo(() => {
    const f = filter.trim().toLowerCase();
    const list = (q.data ?? []).filter((r) => !f || r.name.toLowerCase().includes(f) || r.planName.toLowerCase().includes(f));
    return list.sort((a, b) => {
      const x = a[sort.key];
      const y = b[sort.key];
      const c = typeof x === "number" && typeof y === "number" ? x - y : String(x).localeCompare(String(y));
      return c * sort.dir || a.name.localeCompare(b.name);
    });
  }, [q.data, sort, filter]);

  const head = (key: SortKey, label: string, right = false) => {
    const on = sort.key === key;
    return (
      <th scope="col" className={cn(TH, right && "text-right")} aria-sort={on ? (sort.dir === 1 ? "ascending" : "descending") : "none"}>
        <button type="button" onClick={() => setSort(on ? { key, dir: sort.dir === 1 ? -1 : 1 } : { key, dir: key === "name" || key === "planName" ? 1 : -1 })}
          className={cn("inline-flex items-center gap-1 rounded uppercase tracking-wider outline-none hover:text-ink focus-visible:ring-2 focus-visible:ring-accent/50", on && "text-ink")}>
          {label}
          {on && (sort.dir === 1 ? <ArrowUp size={12} strokeWidth={2} aria-hidden /> : <ArrowDown size={12} strokeWidth={2} aria-hidden />)}
        </button>
      </th>
    );
  };

  return (
    <div className="grid min-w-0 gap-4" aria-busy={q.isPending}>
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative w-full sm:w-80">
          <Search size={16} strokeWidth={1.75} className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-ink3" aria-hidden />
          <Input aria-label={t("platform.credits.findOrganization", "Find an organization")} placeholder={t("platform.credits.findOrganization", "Find an organization")} value={filter} onChange={(e) => setFilter(e.target.value)} className="pl-10" />
        </div>
        {q.data && (
          <p className="num text-[14px] text-ink2">
            {rows.length === q.data.length
              ? t("platform.credits.orgCount", "{count} organizations", { count: q.data.length })
              : t("platform.credits.orgCountFiltered", "{shown} of {count} organizations", { shown: rows.length, count: q.data.length })}
          </p>
        )}
      </div>
      <NoticeLine notice={notice} />

      {q.error ? <ErrorLine error={q.error} /> : q.isPending ? (
        <p className="text-[14px] text-ink2">{t("platform.credits.loadingBalances", "Loading balances…")}</p>
      ) : (q.data ?? []).length === 0 ? (
        <EmptyState icon={<Wallet size={20} strokeWidth={1.75} />} title={t("platform.credits.noOrgsTitle", "No organizations yet")}
          text={t("platform.credits.noOrgsText", "Each organization's credit balance appears here as soon as it signs up.")} />
      ) : rows.length === 0 ? (
        <EmptyState icon={<Search size={20} strokeWidth={1.75} />} title={t("platform.credits.noMatchTitle", "No organization matches")} text={t("platform.credits.noMatchText", "Check the spelling or clear the search.")} />
      ) : (
        <TableCard label={t("platform.credits.balancesTable", "Balances per organization")}>
          <thead className="border-b border-line">
            <tr>
              {head("name", t("platform.credits.colOrganization", "Organization"))}
              {head("planName", t("platform.credits.colPlan", "Plan"))}
              {head("balanceUsd", t("platform.credits.colBalance", "Balance"), true)}
              {head("grantedUsd", t("platform.credits.colGranted", "Granted"), true)}
              {head("consumedUsd", t("platform.credits.colUsed", "Used"), true)}
              {head("tokens", t("platform.credits.colTokens", "Tokens"), true)}
              <th scope="col" className={TH}><span className="sr-only">{t("platform.credits.colActions", "Actions")}</span></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {rows.map((r) => (
              <tr key={r.workspaceId}>
                <td className={cn(TD, "min-w-[12rem] font-medium")}>{r.name}</td>
                <td className={cn(TD, "whitespace-nowrap text-ink2")}>{r.planName}</td>
                <td className={cn(TD, "num whitespace-nowrap text-right font-medium", r.balanceUsd < 0 && "text-danger")}>{usd(r.balanceUsd)}</td>
                <td className={cn(TD, "num whitespace-nowrap text-right text-ink2")}>{usd(r.grantedUsd)}</td>
                <td className={cn(TD, "num whitespace-nowrap text-right text-ink2")}>{usd(r.consumedUsd)}</td>
                <td className={cn(TD, "num whitespace-nowrap text-right text-ink2")} title={r.tokens.toLocaleString("en-US")}>{compact(r.tokens)}</td>
                <td className={cn(TD, "whitespace-nowrap text-right")}>
                  <span className="inline-flex gap-2">
                    <Button size="sm" variant="ghost" onClick={() => { setNotice(null); setAdjusting(r); }}>{t("platform.credits.grantOrAdjust", "Grant or adjust")}</Button>
                    <IconButton icon={<History size={16} strokeWidth={1.75} />} label={t("platform.credits.historyOf", "History of {name}", { name: r.name })} className="h-8 w-8" onClick={() => setHistory(r)} />
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </TableCard>
      )}

      {adjusting && (
        <AdjustModal row={adjusting} onClose={() => setAdjusting(null)}
          onDone={(text) => { setAdjusting(null); setNotice({ tone: "status", text }); }} />
      )}
      {/* the modal's balance line follows the live balances, not the row as it was when the modal opened */}
      {history && <HistoryModal row={(q.data ?? []).find((r) => r.workspaceId === history.workspaceId) ?? history} onClose={() => setHistory(null)} />}
    </div>
  );
}

function AdjustModal({ row, onClose, onDone }: { row: BalanceRow; onClose: () => void; onDone: (text: string) => void }) {
  const t = useT();
  const [dir, setDir] = useState<"add" | "remove">("add");
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const adjust = useFunctionMutation<{ workspaceId: string; amountUsd: number; note: string }, { entry: CreditEntryView; balanceUsd: number }>({
    fn: "billing", op: "billing.adjust",
    invalidate: (_d, a) => [BALANCES_KEY, [...ENTRIES_KEY, a.workspaceId]],
  });

  const value = num(amount);
  const signed = Number.isFinite(value) ? (dir === "add" ? value : -value) : NaN;
  const after = Number.isFinite(signed) && value > 0 ? Math.round((row.balanceUsd + signed) * 100) / 100 : null;

  async function submit(e?: FormEvent) {
    e?.preventDefault();
    if (adjust.isPending) return;
    if (!isUsdAmount(value)) { setError(t("platform.credits.errorAmount", "Enter an amount in USD above 0, with at most two decimals.")); return; }
    const reason = note.trim();
    if (!reason) { setError(t("platform.credits.errorReason", "Say why: the reason is kept in the organization's credit history.")); return; }
    if (reason.length > MAX_NOTE_LENGTH) { setError(t("platform.credits.errorReasonLength", "Keep the reason to {max} characters or fewer.", { max: MAX_NOTE_LENGTH })); return; }
    setError(null);
    try {
      const res = await adjust.mutateAsync({ workspaceId: row.workspaceId, amountUsd: signed, note: reason });
      onDone(dir === "add"
        ? t("platform.credits.addedNotice", "Added {amount} to {name}. Balance now {balance}.", { amount: usd(value), name: row.name, balance: usd(res.data.balanceUsd) })
        : t("platform.credits.removedNotice", "Removed {amount} from {name}. Balance now {balance}.", { amount: usd(value), name: row.name, balance: usd(res.data.balanceUsd) }));
    } catch (err) {
      setError(adminErrorMessage(err));
    }
  }

  return (
    <Modal open onClose={onClose} title={t("platform.credits.adjustTitle", "Credit for {name}", { name: row.name })}
      footer={(
        <>
          <Button variant="ghost" onClick={onClose}>{t("platform.credits.cancel", "Cancel")}</Button>
          <Button variant="primary" onClick={() => void submit()} disabled={adjust.isPending} aria-busy={adjust.isPending}>
            {adjust.isPending ? t("platform.credits.saving", "Saving…") : dir === "add" ? t("platform.credits.addCredit", "Add credit") : t("platform.credits.removeCredit", "Remove credit")}
          </Button>
        </>
      )}>
      <form className="grid gap-5" onSubmit={(e) => void submit(e)} noValidate>
        <p className="num text-[14px] text-ink2">{t("platform.credits.currentBalance", "Current balance:")} <span className="font-medium text-ink">{usd(row.balanceUsd)}</span></p>
        <Segmented label={t("platform.credits.addOrRemove", "Add or remove credit")} value={dir} onChange={setDir}
          options={[{ value: "add", label: t("platform.credits.addCredit", "Add credit") }, { value: "remove", label: t("platform.credits.removeCredit", "Remove credit") }]} />
        <div>
          <label htmlFor="adjust-amount"><Label>{t("platform.credits.amountLabel", "Amount (USD)")}</Label></label>
          <Input id="adjust-amount" type="number" inputMode="decimal" min={0.01} step="0.01" placeholder="0.00" value={amount}
            onChange={(e) => setAmount(e.target.value)} autoFocus />
          {after !== null && (
            <p className="num mt-1.5 text-[13px] text-ink3">{t("platform.credits.balanceAfter", "Balance afterwards: {amount}", { amount: usd(after) })}</p>
          )}
        </div>
        <div>
          <label htmlFor="adjust-note"><Label>{t("platform.credits.reasonLabel", "Reason")}</Label></label>
          <Textarea id="adjust-note" rows={3} maxLength={MAX_NOTE_LENGTH} value={note} onChange={(e) => setNote(e.target.value)}
            placeholder={t("platform.credits.reasonPlaceholder", "For example: goodwill credit after the build delay on 4 November")} />
          <p className="mt-1.5 text-[13px] text-ink3">{t("platform.credits.reasonHint", "Required. Kept in the organization's credit history.")}</p>
        </div>
        {error && <p role="alert" className="text-[14px] text-danger">{error}</p>}
        <button type="submit" hidden aria-hidden tabIndex={-1} />
      </form>
    </Modal>
  );
}

const HISTORY_LIMIT = 200;

function HistoryModal({ row, onClose }: { row: BalanceRow; onClose: () => void }) {
  const t = useT();
  const q = useEntries(row.workspaceId);
  const entries = q.data ?? [];
  return (
    <Modal open onClose={onClose} title={t("platform.credits.historyTitle", "Credit history: {name}", { name: row.name })} width={760}
      footer={<Button variant="ghost" onClick={onClose}>{t("platform.credits.close", "Close")}</Button>}>
      <div className="grid gap-4" aria-busy={q.isPending}>
        <p className="num text-[14px] text-ink2">
          {t("platform.credits.historyBalance", "Balance")} <span className="font-medium text-ink">{usd(row.balanceUsd)}</span> · {t("platform.credits.historyGrantedUsed", "granted {granted} · used {used}", { granted: usd(row.grantedUsd), used: usd(row.consumedUsd) })}
        </p>
        {q.error ? <ErrorLine error={q.error} /> : q.isPending ? (
          <p className="text-[14px] text-ink2">{t("platform.credits.loadingHistory", "Loading history…")}</p>
        ) : entries.length === 0 ? (
          <EmptyState icon={<History size={20} strokeWidth={1.75} />} title={t("platform.credits.noMovementsTitle", "No credit movements yet")}
            text={t("platform.credits.noMovementsText", "Grants, coupons, purchases and usage charges for this organization will be listed here.")} />
        ) : (
          <>
            <div className="scroll-thin overflow-x-auto rounded-block ring-1 ring-line" role="region" aria-label={t("platform.credits.historyTable", "Credit history")} tabIndex={0}>
              <table className="w-full min-w-[600px] border-collapse text-[14px]">
                <thead className="border-b border-line">
                  <tr>
                    <th scope="col" className={TH}>{t("platform.credits.colWhen", "When")}</th>
                    <th scope="col" className={TH}>{t("platform.credits.colWhat", "What")}</th>
                    <th scope="col" className={TH}>{t("platform.credits.colNote", "Note")}</th>
                    <th scope="col" className={cn(TH, "text-right")}>{t("platform.credits.colAmount", "Amount")}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {entries.slice(0, HISTORY_LIMIT).map((e) => (
                    <tr key={e.id}>
                      <td className={cn(TD, "num whitespace-nowrap text-ink2")}>{swissStamp(e.at)}</td>
                      <td className={cn(TD, "whitespace-nowrap")}>
                        {kindLabel(e.kind)}
                        {e.kind === "usage" && e.tokens > 0 && <span className="num text-ink3"> · {t("platform.credits.tokensCount", "{count} tokens", { count: compact(e.tokens) })}</span>}
                      </td>
                      <td className={cn(TD, "min-w-[12rem] text-ink2")}>{e.note || "–"}</td>
                      <td className={cn(TD, "num whitespace-nowrap text-right font-medium")}>
                        {signedUsd(e.amountUsd)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {entries.length > HISTORY_LIMIT && (
              <p className="num text-[13px] text-ink3">{t("platform.credits.historyLimit", "Showing the latest {limit} of {count} movements.", { limit: HISTORY_LIMIT, count: entries.length })}</p>
            )}
          </>
        )}
      </div>
    </Modal>
  );
}

/* ── (b) coupons and vouchers ────────────────────────────────────────────── */

type CouponSaveArgs = {
  id?: string; code?: string; amountUsd: number; planKey?: string | null; maxRedemptions?: number;
  expiresAt?: string | null; active?: boolean; note?: string;
  kind?: CouponKind; planKeys?: string[]; durationMonths?: number; percentOff?: number; amountOffUsd?: number; perPersonLimit?: number;
};

/** What a code does, in words, with the plans' names (codes saved before kinds: credit plus the plan they start). */
function couponWhat(c: CouponView, planName: (key: string | null) => string | null): string {
  if (c.legacy) {
    return [
      c.amountUsd > 0 ? t("platform.credits.legacyCredit", "{amount} credit", { amount: usd(c.amountUsd) }) : null,
      planName(c.planKey) ? t("platform.credits.legacyStarts", "starts {plan}", { plan: planName(c.planKey) ?? "" }) : null,
    ].filter(Boolean).join(", ") || t("platform.credits.creditOnly", "Credit only");
  }
  // the words of describeCoupon (domain/payments), in the current language
  const plans = c.planKeys.length
    ? c.planKeys.map((k) => planName(k) ?? k).join(t("platform.credits.couponPlanJoin", " or "))
    : null;
  const months = c.durationMonths === 1
    ? t("platform.credits.oneMonth", "1 month")
    : t("platform.credits.months", "{count} months", { count: c.durationMonths });
  if (c.kind === "credit") return t("platform.credits.couponAddsCredit", "Adds {amount} credit", { amount: centsUsd(Math.round(c.amountUsd * 100)) });
  if (c.kind === "plan") {
    return t("platform.credits.couponPaysPlan", "Pays the {plans} plan for {months}", { plans: plans ?? t("platform.credits.anyPaidPlan", "any paid plan"), months });
  }
  const off = c.percentOff
    ? t("platform.credits.percentOff", "{percent}% off", { percent: c.percentOff })
    : t("platform.credits.amountOff", "{amount} off", { amount: centsUsd(Math.round(c.amountOffUsd * 100)) });
  return plans
    ? t("platform.credits.couponDiscountPlan", "{off} the {plans} plan for {months}", { off, plans, months })
    : t("platform.credits.couponDiscountAny", "{off} any paid plan for {months}", { off, months });
}

function couponState(c: CouponView): { label: string; tone: "success" | "neutral" | "warning" } {
  const why = couponRefusal({ Active: c.active, ExpiresAt: c.expiresAt, MaxRedemptions: c.maxRedemptions, Redemptions: c.redemptions }, new Date().toISOString());
  if (why === null) return { label: t("platform.credits.stateActive", "Active"), tone: "success" };
  if (why === "expired") return { label: t("platform.credits.stateExpired", "Expired"), tone: "neutral" };
  if (why === "used-up") return { label: t("platform.credits.stateUsedUp", "Used up"), tone: "neutral" };
  return { label: t("platform.credits.stateInactive", "Inactive"), tone: "neutral" };
}

function CouponsPart() {
  const t = useT();
  const q = useCoupons();
  const plansQ = usePlans();
  const [creating, setCreating] = useState(false);
  const [confirming, setConfirming] = useState<CouponView | null>(null);
  const [notice, setNotice] = useState<Notice>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const save = useFunctionMutation<CouponSaveArgs, { coupon: CouponView }>({ fn: "billing", op: "billing.coupons.save", invalidate: [COUPONS_KEY] });

  const planName = (key: string | null) => (key ? plansQ.data?.find((p) => p.key === key)?.name ?? key : null);
  const coupons = [...(q.data ?? [])].sort((a, b) => Number(b.active) - Number(a.active) || a.code.localeCompare(b.code));

  async function copy(code: string) {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(code);
      window.setTimeout(() => setCopied((c) => (c === code ? null : c)), 1600);
    } catch {
      setNotice({ tone: "alert", text: t("platform.credits.copyFailed", "The code could not be copied. Select it and copy it by hand.") });
    }
  }

  async function deactivate() {
    const c = confirming;
    if (!c || save.isPending) return;
    try {
      await save.mutateAsync({ id: c.id, active: false, amountUsd: c.amountUsd });
      setNotice({ tone: "status", text: t("platform.credits.deactivatedNotice", "{code} can no longer be redeemed.", { code: c.code }) });
    } catch (err) {
      setNotice({ tone: "alert", text: adminErrorMessage(err) });
    }
    setConfirming(null);
  }

  return (
    <div className="grid min-w-0 gap-4" aria-busy={q.isPending}>
      <div className="flex flex-wrap items-center gap-3">
        <p className="min-w-0 flex-1 text-[14px] text-ink2">
          {t("platform.credits.couponsIntro", "A coupon adds credit, or starts a plan, when an organization redeems its code.")}
        </p>
        <Button variant="primary" icon={<Plus size={16} strokeWidth={1.75} />} onClick={() => { setNotice(null); setCreating(true); }}>{t("platform.credits.newCoupon", "New coupon")}</Button>
      </div>
      <NoticeLine notice={notice} />

      {q.error ? <ErrorLine error={q.error} /> : q.isPending ? (
        <p className="text-[14px] text-ink2">{t("platform.credits.loadingCoupons", "Loading coupons…")}</p>
      ) : coupons.length === 0 ? (
        <EmptyState icon={<Ticket size={20} strokeWidth={1.75} />} title={t("platform.credits.noCouponsTitle", "No coupons yet")}
          text={t("platform.credits.noCouponsText", "Coupons you create appear here with how often they were redeemed.")} />
      ) : (
        <TableCard label={t("platform.credits.tabCoupons", "Coupons and vouchers")}>
          <thead className="border-b border-line">
            <tr>
              <th scope="col" className={TH}>{t("platform.credits.colCode", "Code")}</th>
              <th scope="col" className={cn(TH, "text-right")}>{t("platform.credits.colCredit", "Credit")}</th>
              <th scope="col" className={TH}>{t("platform.credits.colWhatItDoes", "What it does")}</th>
              <th scope="col" className={TH}>{t("platform.credits.colRedeemed", "Redeemed")}</th>
              <th scope="col" className={TH}>{t("platform.credits.colExpires", "Expires")}</th>
              <th scope="col" className={TH}>{t("platform.credits.colStatus", "Status")}</th>
              <th scope="col" className={TH}><span className="sr-only">{t("platform.credits.colActions", "Actions")}</span></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {coupons.map((c) => {
              const st = couponState(c);
              return (
                <tr key={c.id}>
                  <td className={cn(TD, "whitespace-nowrap")}>
                    <span className="inline-flex items-center gap-2">
                      <span className="select-all font-mono text-[13px] font-medium">{c.code}</span>
                      <IconButton icon={copied === c.code ? <Check size={14} strokeWidth={2} /> : <Copy size={14} strokeWidth={1.75} />}
                        label={copied === c.code ? t("platform.credits.codeCopied", "{code} copied", { code: c.code }) : t("platform.credits.copyCode", "Copy {code}", { code: c.code })} className="h-8 w-8" onClick={() => void copy(c.code)} />
                    </span>
                    {c.note && <div className="mt-0.5 max-w-[16rem] whitespace-normal text-[13px] text-ink3">{c.note}</div>}
                  </td>
                  <td className={cn(TD, "num whitespace-nowrap text-right")}>{c.amountUsd > 0 ? usd(c.amountUsd) : "–"}</td>
                  <td className={cn(TD, "min-w-[12rem] text-ink2")}>{couponWhat(c, planName)}{c.perPersonLimit > 0 && <span className="block text-[12px] text-ink3">{c.perPersonLimit === 1 ? t("platform.credits.oncePerPerson", "Once per person") : t("platform.credits.timesPerPerson", "{count} times per person", { count: c.perPersonLimit })}</span>}</td>
                  <td className={cn(TD, "num whitespace-nowrap text-ink2")}>
                    {c.maxRedemptions > 0
                      ? t("platform.credits.redeemedOf", "{count} of {max}", { count: c.redemptions, max: c.maxRedemptions })
                      : t("platform.credits.redeemedNoLimit", "{count} (no limit)", { count: c.redemptions })}
                  </td>
                  <td className={cn(TD, "num whitespace-nowrap text-ink2")}>{c.expiresAt ? swissDate(c.expiresAt) : t("platform.credits.never", "Never")}</td>
                  <td className={TD}><Chip tone={st.tone}>{st.label}</Chip></td>
                  <td className={cn(TD, "whitespace-nowrap text-right")}>
                    {c.active && (
                      <Button size="sm" variant="danger-quiet" onClick={() => { setNotice(null); setConfirming(c); }}>{t("platform.credits.deactivate", "Deactivate")}</Button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </TableCard>
      )}

      {creating && (
        <CouponModal plans={(plansQ.data ?? []).filter((p) => p.active)} onClose={() => setCreating(false)}
          onCreated={(c) => { setCreating(false); setNotice({ tone: "status", text: t("platform.credits.couponCreated", "Coupon {code} created.", { code: c.code }) }); }} />
      )}

      <Modal open={confirming !== null} onClose={() => setConfirming(null)} title={confirming ? t("platform.credits.deactivateTitle", "Deactivate {code}?", { code: confirming.code }) : t("platform.credits.deactivateCoupon", "Deactivate coupon")}
        footer={(
          <>
            <Button variant="ghost" onClick={() => setConfirming(null)}>{t("platform.credits.keepIt", "Keep it")}</Button>
            <Button variant="danger" onClick={() => void deactivate()} disabled={save.isPending} aria-busy={save.isPending}>{t("platform.credits.deactivate", "Deactivate")}</Button>
          </>
        )}>
        <p className="text-[14px] text-ink2">
          {t("platform.credits.deactivateText", "Nobody can redeem this code any more. Credit already given stays with the organizations that redeemed it.")}
        </p>
      </Modal>
    </div>
  );
}

const kindOptions = (): { value: CouponKind; label: string }[] => [
  { value: "credit", label: t("platform.credits.kindAddsCredit", "Adds credit") },
  { value: "plan", label: t("platform.credits.kindPaysPlan", "Pays a plan for some months") },
  { value: "discount", label: t("platform.credits.kindDiscount", "Takes a discount off a plan") },
];

function CouponModal({ plans, onClose, onCreated }: { plans: PlanView[]; onClose: () => void; onCreated: (c: CouponView) => void }) {
  const t = useT();
  const paidPlans = plans.filter((p) => !p.contactSales && (p.priceUsd ?? 0) > 0);
  const [kind, setKind] = useState<CouponKind>("credit");
  const [code, setCode] = useState("");
  const [amount, setAmount] = useState("");
  const [planKey, setPlanKey] = useState(paidPlans[0]?.key ?? "");
  const [months, setMonths] = useState("1");
  const [percent, setPercent] = useState("");
  const [off, setOff] = useState("");
  const [perPerson, setPerPerson] = useState("1");
  const [max, setMax] = useState("");
  const [expires, setExpires] = useState("");
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const save = useFunctionMutation<CouponSaveArgs, { coupon: CouponView }>({ fn: "billing", op: "billing.coupons.save", invalidate: [COUPONS_KEY] });
  const today = new Date().toISOString().slice(0, 10);

  async function submit(e?: FormEvent) {
    e?.preventDefault();
    if (save.isPending) return;
    const normalized = normalizeCouponCode(code);
    if (normalized && !COUPON_CODE.test(normalized)) {
      setError(t("platform.credits.errorCode", "A code has 4 to 32 letters, digits or dashes and starts with a letter or digit. Or leave it empty."));
      return;
    }
    const maxRedemptions = max.trim() === "" ? 0 : num(max);
    if (!Number.isInteger(maxRedemptions) || maxRedemptions < 0 || maxRedemptions > 1_000_000) {
      setError(t("platform.credits.errorMax", "Times it can be redeemed must be a whole number (0 or empty for no limit)."));
      return;
    }
    const perPersonLimit = perPerson.trim() === "" ? 0 : num(perPerson);
    if (!Number.isInteger(perPersonLimit) || perPersonLimit < 0 || perPersonLimit > 1000) {
      setError(t("platform.credits.errorPerPerson", "Times one person may use it must be a whole number from 0 (no limit) to 1000."));
      return;
    }
    if (expires && expires < today) { setError(t("platform.credits.errorExpiry", "Choose an expiry date from today on.")); return; }
    if (note.trim().length > MAX_NOTE_LENGTH) { setError(t("platform.credits.errorNoteLength", "Keep the note to {max} characters or fewer.", { max: MAX_NOTE_LENGTH })); return; }
    const terms: Partial<CouponSaveArgs> & { amountUsd: number } = { kind, amountUsd: 0, perPersonLimit };
    if (kind === "credit") {
      const amountUsd = num(amount);
      if (!isUsdAmount(amountUsd)) { setError(t("platform.credits.errorCredit", "Enter the credit in USD above 0, with at most two decimals.")); return; }
      terms.amountUsd = amountUsd;
    } else {
      const durationMonths = num(months);
      if (!Number.isInteger(durationMonths) || durationMonths < 1 || durationMonths > MAX_COUPON_MONTHS) {
        setError(t("platform.credits.errorMonths", "Months must be a whole number from 1 to {max}.", { max: MAX_COUPON_MONTHS }));
        return;
      }
      terms.durationMonths = durationMonths;
      if (kind === "plan") {
        if (!planKey) { setError(t("platform.credits.errorPlan", "Choose the plan the code pays.")); return; }
        terms.planKeys = [planKey];
      } else {
        terms.planKeys = planKey ? [planKey] : [];
        const pct = percent.trim() === "" ? 0 : num(percent);
        const amt = off.trim() === "" ? 0 : num(off);
        if ((pct > 0) === (amt > 0)) { setError(t("platform.credits.errorEitherOff", "Enter either a percent off or an amount off, not both.")); return; }
        if (pct > 0 && !(Number.isInteger(pct) && pct <= 100)) { setError(t("platform.credits.errorPercent", "Percent off is a whole number from 1 to 100.")); return; }
        if (amt > 0 && !isUsdAmount(amt)) { setError(t("platform.credits.errorAmountOff", "Enter the amount off in USD, with at most two decimals.")); return; }
        terms.percentOff = pct;
        terms.amountOffUsd = amt;
      }
    }
    setError(null);
    try {
      const res = await save.mutateAsync({
        code: normalized, maxRedemptions, expiresAt: expires ? `${expires}T23:59:59.999Z` : null, active: true, note: note.trim(), ...terms,
      });
      onCreated(res.data.coupon);
    } catch (err) {
      setError(adminErrorMessage(err));
    }
  }

  const planOptions = paidPlans.map((p) => ({ value: p.key, label: p.name }));
  const planFieldLabel = kind === "plan" ? t("platform.credits.planItPays", "Plan it pays") : t("platform.credits.planItAppliesTo", "Plan it applies to");
  return (
    <Modal open onClose={onClose} title={t("platform.credits.newCoupon", "New coupon")}
      footer={(
        <>
          <Button variant="ghost" onClick={onClose}>{t("platform.credits.cancel", "Cancel")}</Button>
          <Button variant="primary" onClick={() => void submit()} disabled={save.isPending} aria-busy={save.isPending}>
            {save.isPending ? t("platform.credits.creating", "Creating…") : t("platform.credits.createCoupon", "Create coupon")}
          </Button>
        </>
      )}>
      <form className="grid gap-5" onSubmit={(e) => void submit(e)} noValidate>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor="coupon-code"><Label>{t("platform.credits.colCode", "Code")}</Label></label>
            <Input id="coupon-code" className="font-mono uppercase" maxLength={32} autoComplete="off" value={code}
              onChange={(e) => setCode(e.target.value)} placeholder={t("platform.credits.codePlaceholder", "Leave empty to generate one")} />
            <p className="mt-1.5 text-[13px] text-ink3">{t("platform.credits.codeHint", "Letters, digits and dashes. Leave empty and a code is generated.")}</p>
          </div>
          <div>
            <Label>{t("platform.credits.colWhatItDoes", "What it does")}</Label>
            <Select label={t("platform.credits.colWhatItDoes", "What it does")} value={kind} onChange={(v) => { setKind(v as CouponKind); setError(null); }} options={kindOptions()} />
          </div>
        </div>
        {kind === "credit" ? (
          <div className="sm:max-w-[50%] sm:pr-2">
            <label htmlFor="coupon-amount"><Label>{t("platform.credits.creditLabel", "Credit (USD)")}</Label></label>
            <Input id="coupon-amount" type="number" inputMode="decimal" min={0} step="0.01" placeholder="0.00" value={amount}
              onChange={(e) => setAmount(e.target.value)} />
            <p className="mt-1.5 text-[13px] text-ink3">{t("platform.credits.creditHint", "Redeemed under Settings, Plan and usage, or from the paywall.")}</p>
          </div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <Label>{planFieldLabel}</Label>
              <Select label={planFieldLabel} value={planKey} onChange={setPlanKey}
                options={kind === "plan" ? planOptions : [{ value: "", label: t("platform.credits.anyPaidPlanOption", "Any paid plan") }, ...planOptions]} />
            </div>
            <div>
              <label htmlFor="coupon-months"><Label>{t("platform.credits.monthsLabel", "Months")}</Label></label>
              <Input id="coupon-months" type="number" inputMode="numeric" min={1} max={MAX_COUPON_MONTHS} step={1} value={months}
                onChange={(e) => setMonths(e.target.value)} />
              <p className="mt-1.5 text-[13px] text-ink3">{kind === "plan"
                ? t("platform.credits.monthsPlanHint", "The plan is paid for this many months, with its monthly credit.")
                : t("platform.credits.monthsDiscountHint", "How many months the discount applies.")}</p>
            </div>
            {kind === "discount" && (
              <>
                <div>
                  <label htmlFor="coupon-percent"><Label>{t("platform.credits.percentOffLabel", "Percent off")}</Label></label>
                  <Input id="coupon-percent" type="number" inputMode="numeric" min={1} max={100} step={1} placeholder={t("platform.credits.percentPlaceholder", "For example 20")} value={percent}
                    onChange={(e) => setPercent(e.target.value)} />
                </div>
                <div>
                  <label htmlFor="coupon-off"><Label>{t("platform.credits.amountOffLabel", "Or amount off (USD)")}</Label></label>
                  <Input id="coupon-off" type="number" inputMode="decimal" min={0} step="0.01" placeholder="0.00" value={off}
                    onChange={(e) => setOff(e.target.value)} />
                </div>
                <p className="text-[13px] text-ink3 sm:col-span-2">{t("platform.credits.discountHint", "100% off pays the plan like a plan code. Less than that leaves an amount to pay by card, and card payments are being connected.")}</p>
              </>
            )}
          </div>
        )}
        <div className="grid gap-4 sm:grid-cols-3">
          <div>
            <label htmlFor="coupon-max"><Label>{t("platform.credits.timesTotalLabel", "Times in total")}</Label></label>
            <Input id="coupon-max" type="number" inputMode="numeric" min={0} step={1} placeholder={t("platform.credits.noLimit", "No limit")} value={max}
              onChange={(e) => setMax(e.target.value)} />
            <p className="mt-1.5 text-[13px] text-ink3">{t("platform.credits.timesTotalHint", "Empty or 0: no limit. Each organization uses a code once.")}</p>
          </div>
          <div>
            <label htmlFor="coupon-person"><Label>{t("platform.credits.timesPerPersonLabel", "Times per person")}</Label></label>
            <Input id="coupon-person" type="number" inputMode="numeric" min={0} step={1} value={perPerson}
              onChange={(e) => setPerPerson(e.target.value)} />
            <p className="mt-1.5 text-[13px] text-ink3">{t("platform.credits.timesPerPersonHint", "Across all their organizations. 0: no limit.")}</p>
          </div>
          <div>
            <label htmlFor="coupon-expires"><Label>{t("platform.credits.colExpires", "Expires")}</Label></label>
            <Input id="coupon-expires" type="date" min={today} value={expires} onChange={(e) => setExpires(e.target.value)} />
            <p className="mt-1.5 text-[13px] text-ink3">{t("platform.credits.expiresHint", "Empty: never. Valid to the end of that day (UTC).")}</p>
          </div>
        </div>
        <div>
          <label htmlFor="coupon-note"><Label>{t("platform.credits.couponNoteLabel", "Note (only admins see it)")}</Label></label>
          <Input id="coupon-note" maxLength={MAX_NOTE_LENGTH} value={note} onChange={(e) => setNote(e.target.value)}
            placeholder={t("platform.credits.couponNotePlaceholder", "For example: partner event, November")} />
        </div>
        {error && <p role="alert" className="text-[14px] text-danger">{error}</p>}
        <button type="submit" hidden aria-hidden tabIndex={-1} />
      </form>
    </Modal>
  );
}

/* ── (c) purchase requests ───────────────────────────────────────────────── */

function statusChip(status: PurchaseView["status"]): { label: string; tone: "accent" | "success" | "neutral" } {
  if (status === "approved") return { label: t("platform.credits.statusApproved", "Approved"), tone: "success" };
  if (status === "declined") return { label: t("platform.credits.statusDeclined", "Declined"), tone: "neutral" };
  return { label: t("platform.credits.statusWaiting", "Waiting"), tone: "accent" };
}

function RequestsPart() {
  const t = useT();
  const q = usePurchases();
  const plansQ = usePlans();
  const [deciding, setDeciding] = useState<{ request: PurchaseView; decision: "approve" | "decline" } | null>(null);
  const [notice, setNotice] = useState<Notice>(null);

  const plan = (key: string | null) => (key ? plansQ.data?.find((p) => p.key === key) ?? null : null);
  const what = (r: PurchaseView) => {
    if (r.planKey) return t("platform.credits.wantsPlan", "{plan} plan", { plan: plan(r.planKey)?.name ?? r.planKey });
    if (r.amountUsd !== null) return t("platform.credits.wantsCredit", "{amount} credit", { amount: usd(r.amountUsd) });
    return "–";
  };
  const requests = [...(q.data ?? [])].sort((a, b) =>
    Number(b.status === "pending") - Number(a.status === "pending") || Date.parse(b.createdAt) - Date.parse(a.createdAt));

  return (
    <div className="grid min-w-0 gap-4" aria-busy={q.isPending}>
      <p className="text-[14px] text-ink2">
        {t("platform.credits.requestsIntro", "Organizations ask here to start a plan or buy more credit. Waiting requests come first.")}
      </p>
      <NoticeLine notice={notice} />

      {q.error ? <ErrorLine error={q.error} /> : q.isPending ? (
        <p className="text-[14px] text-ink2">{t("platform.credits.loadingRequests", "Loading requests…")}</p>
      ) : requests.length === 0 ? (
        <EmptyState icon={<Inbox size={20} strokeWidth={1.75} />} title={t("platform.credits.noRequestsTitle", "No purchase requests yet")}
          text={t("platform.credits.noRequestsText", "When an organization asks for a plan or more credit, the request appears here for you to approve or decline.")} />
      ) : (
        <TableCard label={t("platform.credits.tabRequests", "Purchase requests")}>
          <thead className="border-b border-line">
            <tr>
              <th scope="col" className={TH}>{t("platform.credits.colOrganization", "Organization")}</th>
              <th scope="col" className={TH}>{t("platform.credits.colAskedBy", "Asked by")}</th>
              <th scope="col" className={TH}>{t("platform.credits.colWants", "Wants")}</th>
              <th scope="col" className={TH}>{t("platform.credits.colAskedOn", "Asked on")}</th>
              <th scope="col" className={TH}>{t("platform.credits.colStatus", "Status")}</th>
              <th scope="col" className={TH}><span className="sr-only">{t("platform.credits.colActions", "Actions")}</span></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {requests.map((r) => {
              const st = statusChip(r.status);
              return (
                <tr key={r.id}>
                  <td className={cn(TD, "min-w-[11rem] font-medium")}>{r.workspaceName}</td>
                  <td className={cn(TD, "text-ink2")}>
                    <span className="break-all">{r.userEmail || "–"}</span>
                    {r.note && <div className="mt-0.5 max-w-[18rem] text-[13px] text-ink3">“{r.note}”</div>}
                  </td>
                  <td className={cn(TD, "num whitespace-nowrap")}>{what(r)}</td>
                  <td className={cn(TD, "num whitespace-nowrap text-ink2")}>{swissStamp(r.createdAt)}</td>
                  <td className={TD}>
                    <Chip tone={st.tone}>{st.label}</Chip>
                    {r.status !== "pending" && r.decidedAt && <div className="num mt-1 text-[13px] text-ink3">{swissDate(r.decidedAt)}</div>}
                  </td>
                  <td className={cn(TD, "whitespace-nowrap text-right")}>
                    {r.status === "pending" && (
                      <span className="inline-flex gap-2">
                        <Button size="sm" variant="ghost" onClick={() => { setNotice(null); setDeciding({ request: r, decision: "decline" }); }}>{t("platform.credits.decline", "Decline")}</Button>
                        <Button size="sm" variant="primary" onClick={() => { setNotice(null); setDeciding({ request: r, decision: "approve" }); }}>{t("platform.credits.approve", "Approve")}</Button>
                      </span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </TableCard>
      )}

      {deciding && (
        <DecideModal request={deciding.request} decision={deciding.decision} plan={plan(deciding.request.planKey)} what={what(deciding.request)}
          onClose={() => setDeciding(null)}
          onDone={(text) => { setDeciding(null); setNotice({ tone: "status", text }); }} />
      )}
    </div>
  );
}

function DecideModal({ request, decision, plan, what, onClose, onDone }: {
  request: PurchaseView; decision: "approve" | "decline"; plan: PlanView | null; what: string;
  onClose: () => void; onDone: (text: string) => void;
}) {
  const t = useT();
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const decide = useFunctionMutation<{ id: string; decision: "approve" | "decline"; note?: string }, { request: PurchaseView }>({
    fn: "billing", op: "billing.purchases.decide",
    invalidate: [PURCHASES_KEY, BALANCES_KEY, [...ENTRIES_KEY, request.workspaceId]],
  });
  const approve = decision === "approve";
  const org = request.workspaceName;

  const consequence = approve
    ? request.planKey
      ? plan
        ? t("platform.credits.approvePlanCredit", "{org} moves to the {plan} plan now and receives its {amount} credit.", { org, plan: plan.name, amount: usd(plan.creditUsd) })
        : t("platform.credits.approvePlan", "{org} moves to the {plan} plan now and receives the plan's credit.", { org, plan: request.planKey })
      : request.amountUsd !== null
        ? t("platform.credits.approveCredit", "{amount} credit is added to {org}'s balance now.", { amount: usd(request.amountUsd), org })
        : t("platform.credits.approveCreditUnknown", "The requested credit is added to {org}'s balance now.", { org })
    : t("platform.credits.declineConsequence", "Nothing changes for {org}: no plan starts and no credit is added.", { org });

  async function submit() {
    if (decide.isPending) return;
    const text = note.trim();
    if (text.length > MAX_NOTE_LENGTH) { setError(t("platform.credits.errorNoteLength", "Keep the note to {max} characters or fewer.", { max: MAX_NOTE_LENGTH })); return; }
    setError(null);
    try {
      await decide.mutateAsync({ id: request.id, decision, ...(text ? { note: text } : {}) });
      onDone(approve
        ? t("platform.credits.approvedNotice", "Approved: {what} for {org}.", { what, org })
        : t("platform.credits.declinedNotice", "Declined: {what} for {org}.", { what, org }));
    } catch (err) {
      setError(adminErrorMessage(err));
    }
  }

  return (
    <Modal open onClose={onClose} title={approve
      ? t("platform.credits.approveTitle", "Approve {what} for {org}?", { what, org })
      : t("platform.credits.declineTitle", "Decline {what} for {org}?", { what, org })}
      footer={(
        <>
          <Button variant="ghost" onClick={onClose}>{t("platform.credits.cancel", "Cancel")}</Button>
          <Button variant={approve ? "primary" : "danger"} onClick={() => void submit()} disabled={decide.isPending} aria-busy={decide.isPending}>
            {decide.isPending ? t("platform.credits.saving", "Saving…") : approve ? t("platform.credits.approve", "Approve") : t("platform.credits.decline", "Decline")}
          </Button>
        </>
      )}>
      <div className="grid gap-5">
        <p className="text-[14px] text-ink2">{consequence}</p>
        <div>
          <label htmlFor="decide-note"><Label>{t("platform.credits.noteOptional", "Note (optional)")}</Label></label>
          <Textarea id="decide-note" rows={3} maxLength={MAX_NOTE_LENGTH} value={note} onChange={(e) => setNote(e.target.value)}
            placeholder={approve
              ? t("platform.credits.approveNotePlaceholder", "For example: invoice INV-2026-118 paid")
              : t("platform.credits.declineNotePlaceholder", "For example: please contact sales for this plan")} />
        </div>
        {error && <p role="alert" className="text-[14px] text-danger">{error}</p>}
      </div>
    </Modal>
  );
}
