// Platform > Plans: the plans organizations can be on, the two pricing settings (price factor, sign-up credit), and
// payments and access (how plans are paid, whether new work needs credit, internal organizations).
import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { freshnessQuery } from "@/blocks/data/freshness";
import { Check, Pencil, SlidersHorizontal } from "lucide-react";
import { Button, Card, Chip, EmptyState, IconButton, Input, Label, Modal, Select, Textarea } from "@/ui/kit";
import { callFunction, useFunctionMutation } from "@/blocks/fn";
import { adminErrorMessage } from "@/blocks/admin";
import { PaywallSettingsCard } from "@/components/platform/billing/PaywallSettingsCard";
import {
  ASSISTED, MAX_FEATURES, MAX_FEATURE_LENGTH, MAX_PRICE_FACTOR, isUsdAmount,
  type Assisted, type BillingSettings, type PlanView,
} from "@/domain/billing";
import { t, useT } from "@/i18n";

const ASSISTED_LABEL: Record<Assisted, () => string> = {
  none: () => t("platform.plans.assisted.none", "No consultant"),
  "tech-lead": () => t("platform.plans.assisted.techLead", "Tech-lead consultant"),
  business: () => t("platform.plans.assisted.business", "Business consultant"),
  dedicated: () => t("platform.plans.assisted.dedicated", "Dedicated team"),
};
const assistedLabel = (a: Assisted): string => (Object.prototype.hasOwnProperty.call(ASSISTED_LABEL, a) ? ASSISTED_LABEL[a]() : a);

const usd = (n: number) => `USD ${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const priceText = (p: PlanView) => (p.contactSales || p.priceUsd === null
  ? t("platform.plans.contactSales", "Contact sales")
  : p.priceUsd === 0 ? t("platform.plans.free", "Free") : usd(p.priceUsd));
const streamsText = (n: number | null) => (n === null
  ? t("platform.plans.streamsCustom", "Custom")
  : n === 1 ? t("platform.plans.streamsOne", "1 at a time") : t("platform.plans.streamsMany", "{count} side by side", { count: n }));

const PLANS_KEY = ["billing", "plans"] as const;
const SETTINGS_KEY = ["billing", "settings"] as const;

function usePlans() {
  return useQuery({
    queryKey: [...PLANS_KEY, { includeInactive: true }],
    queryFn: async () => (await callFunction<{ plans: PlanView[] }>("billing", "billing.plans.list", { includeInactive: true })).data.plans,
    ...freshnessQuery("calm"),
    retry: 0,
  });
}

function useBillingSettings() {
  return useQuery({
    queryKey: [...SETTINGS_KEY],
    queryFn: async () => (await callFunction<BillingSettings>("billing", "billing.settings.get", {})).data,
    ...freshnessQuery("calm"),
    retry: 0,
  });
}

export default function PlansSection() {
  const t = useT();
  const plansQ = usePlans();
  const [editing, setEditing] = useState<PlanView | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const plans = [...(plansQ.data ?? [])].sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name));

  return (
    <div className="grid min-w-0 gap-8" aria-busy={plansQ.isPending}>
      <div className="grid min-w-0 gap-4">
        {notice && <p role="status" className="text-[14px] text-ink2">{notice}</p>}

        {plansQ.error ? (
          <p role="alert" className="text-[14px] text-danger">{adminErrorMessage(plansQ.error)}</p>
        ) : plansQ.isPending ? (
          <div className="grid gap-5 sm:grid-cols-2 2xl:grid-cols-4" aria-hidden>
            {[0, 1, 2, 3].map((i) => <div key={i} className="h-72 rounded-card bg-surface/60" />)}
          </div>
        ) : plans.length === 0 ? (
          <EmptyState icon={<SlidersHorizontal size={20} strokeWidth={1.75} />} title={t("platform.plans.emptyTitle", "No plans yet")}
            text={t("platform.plans.emptyText", "The plans organizations can choose will appear here once they are set up.")} />
        ) : (
          <div className="grid gap-5 sm:grid-cols-2 2xl:grid-cols-4">
            {plans.map((p) => (
              <PlanCard key={p.key} plan={p} onEdit={() => { setNotice(null); setEditing(p); }} />
            ))}
          </div>
        )}
      </div>

      <PricingSettingsCard />

      <PaywallSettingsCard />

      {editing && (
        <PlanEditor plan={editing} onClose={() => setEditing(null)}
          onSaved={(p) => { setEditing(null); setNotice(t("platform.plans.savedNotice", "{name} saved.", { name: p.name })); }} />
      )}
    </div>
  );
}

function PlanCard({ plan, onEdit }: { plan: PlanView; onEdit: () => void }) {
  const t = useT();
  const price = priceText(plan);
  const monthly = !(plan.contactSales || plan.priceUsd === null) && plan.priceUsd !== 0;
  return (
    <Card title={plan.name} className="flex min-w-0 flex-col"
      action={(
        <>
          {!plan.active && <Chip>{t("platform.plans.notOffered", "Not offered")}</Chip>}
          <IconButton icon={<Pencil size={16} strokeWidth={1.75} />} label={t("platform.plans.editPlan", "Edit {name}", { name: plan.name })} className="h-9 w-9" onClick={onEdit} />
        </>
      )}>
      <div className="flex flex-wrap items-baseline gap-x-2">
        <span className="text-[28px] font-medium leading-tight tracking-[-0.02em]">{price}</span>
        {monthly && <span className="text-[14px] text-ink2">{t("platform.plans.perMonth", "per month")}</span>}
      </div>
      <dl className="mt-4 grid gap-2 text-[14px]">
        <Fact term={t("platform.plans.factCredit", "Credit")} value={plan.contactSales && plan.creditUsd === 0 ? t("platform.plans.agreedWithSales", "Agreed with sales") : usd(plan.creditUsd)} />
        <Fact term={t("platform.plans.factHelp", "Help")} value={assistedLabel(plan.assisted)} />
        <Fact term={t("platform.plans.factParallelBuilds", "Parallel builds")} value={streamsText(plan.maxParallelStreams)} />
        <Fact term={t("platform.plans.factQueuePriority", "Queue priority")} value={String(plan.priority)} />
      </dl>
      {plan.features.length > 0 && (
        <ul className="mt-4 grid gap-1.5 border-t border-line pt-4 text-[14px] text-ink2">
          {plan.features.map((f, i) => (
            <li key={i} className="flex gap-2">
              <Check size={16} strokeWidth={1.75} className="mt-0.5 shrink-0 text-ink3" aria-hidden />
              <span className="min-w-0 break-words">{f}</span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function Fact({ term, value }: { term: string; value: string }) {
  return (
    <div className="flex flex-wrap justify-between gap-x-4">
      <dt className="text-ink2">{term}</dt>
      <dd className="num text-right font-medium">{value}</dd>
    </div>
  );
}

/* ── edit a plan ─────────────────────────────────────────────────────────── */

type Draft = {
  name: string; contactSales: boolean; price: string; credit: string; assisted: Assisted;
  customStreams: boolean; streams: string; priority: string; features: string; active: boolean; sortOrder: string;
};

const toDraft = (p: PlanView): Draft => ({
  name: p.name,
  contactSales: p.contactSales || p.priceUsd === null,
  price: p.priceUsd === null ? "" : String(p.priceUsd),
  credit: String(p.creditUsd),
  assisted: p.assisted,
  customStreams: p.maxParallelStreams === null,
  streams: p.maxParallelStreams === null ? "" : String(p.maxParallelStreams),
  priority: String(p.priority),
  features: p.features.join("\n"),
  active: p.active,
  sortOrder: String(p.sortOrder),
});

const num = (s: string) => (s.trim() === "" ? NaN : Number(s.trim()));
const isInt = (n: number, min: number, max: number) => Number.isInteger(n) && n >= min && n <= max;

/** The plan to save, or the first thing to fix. */
function fromDraft(base: PlanView, d: Draft): { plan: PlanView } | { error: string } {
  const name = d.name.trim();
  if (!name) return { error: t("platform.plans.errorName", "Enter the plan's name.") };
  if (name.length > 60) return { error: t("platform.plans.errorNameLength", "Keep the name to 60 characters or fewer.") };
  let priceUsd: number | null = null;
  if (!d.contactSales) {
    const price = num(d.price);
    if (!isUsdAmount(price, { allowZero: true })) return { error: t("platform.plans.errorPrice", "Enter the monthly price in USD (0 for a free plan, at most two decimals).") };
    priceUsd = price;
  }
  const credit = num(d.credit);
  if (!isUsdAmount(credit, { allowZero: true })) return { error: t("platform.plans.errorCredit", "Enter the credit in USD (0 or more, at most two decimals).") };
  let streams: number | null = null;
  if (!d.customStreams) {
    const n = num(d.streams);
    if (!isInt(n, 1, 100)) return { error: t("platform.plans.errorStreams", "Parallel builds must be a whole number from 1 to 100, or choose Custom.") };
    streams = n;
  }
  const priority = num(d.priority);
  if (!isInt(priority, 0, 1000)) return { error: t("platform.plans.errorPriority", "Queue priority must be a whole number from 0 to 1000.") };
  const sortOrder = num(d.sortOrder);
  if (!isInt(sortOrder, 0, 1000)) return { error: t("platform.plans.errorOrder", "Order must be a whole number from 0 to 1000.") };
  const features = d.features.split("\n").map((f) => f.trim()).filter(Boolean);
  if (features.length > MAX_FEATURES) return { error: t("platform.plans.errorFeatureCount", "List at most {max} features (one per line).", { max: MAX_FEATURES }) };
  const long = features.findIndex((f) => f.length > MAX_FEATURE_LENGTH);
  if (long >= 0) return { error: t("platform.plans.errorFeatureLength", "Feature {number} is longer than {max} characters. Shorten it.", { number: long + 1, max: MAX_FEATURE_LENGTH }) };
  return {
    plan: {
      ...base, name, priceUsd, contactSales: d.contactSales, creditUsd: credit, assisted: d.assisted,
      maxParallelStreams: streams, priority, features, active: d.active, sortOrder,
    },
  };
}

function PlanEditor({ plan, onClose, onSaved }: { plan: PlanView; onClose: () => void; onSaved: (p: PlanView) => void }) {
  const t = useT();
  const [d, setD] = useState<Draft>(() => toDraft(plan));
  const [error, setError] = useState<string | null>(null);
  const save = useFunctionMutation<{ plan: PlanView }, { plan: PlanView }>({
    fn: "billing", op: "billing.plans.save", invalidate: [PLANS_KEY, ["billing", "balances"]],
  });
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setD((x) => ({ ...x, [k]: v }));
  const featureLines = d.features.split("\n").filter((f) => f.trim()).length;

  async function submit(e?: FormEvent) {
    e?.preventDefault();
    if (save.isPending) return;
    const out = fromDraft(plan, d);
    if ("error" in out) { setError(out.error); return; }
    setError(null);
    try {
      const res = await save.mutateAsync({ plan: out.plan });
      onSaved(res.data.plan ?? out.plan);
    } catch (err) {
      setError(adminErrorMessage(err));
    }
  }

  const id = `plan-${plan.key}`;
  return (
    <Modal open onClose={onClose} title={t("platform.plans.editPlan", "Edit {name}", { name: plan.name })} width={620}
      footer={(
        <>
          <Button variant="ghost" onClick={onClose}>{t("platform.plans.cancel", "Cancel")}</Button>
          <Button variant="primary" onClick={() => void submit()} disabled={save.isPending} aria-busy={save.isPending}>
            {save.isPending ? t("platform.plans.saving", "Saving…") : t("platform.plans.savePlan", "Save plan")}
          </Button>
        </>
      )}>
      <form className="grid gap-5" onSubmit={(e) => void submit(e)} noValidate>
        <div>
          <label htmlFor={`${id}-name`}><Label>{t("platform.plans.nameLabel", "Name")}</Label></label>
          <Input id={`${id}-name`} value={d.name} maxLength={60} onChange={(e) => set("name", e.target.value)} />
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor={`${id}-price`}><Label>{t("platform.plans.priceLabel", "Price per month (USD)")}</Label></label>
            <Input id={`${id}-price`} type="number" inputMode="decimal" min={0} step="0.01" value={d.contactSales ? "" : d.price}
              disabled={d.contactSales} placeholder={d.contactSales ? t("platform.plans.contactSales", "Contact sales") : "0.00"} onChange={(e) => set("price", e.target.value)} />
            <CheckRow id={`${id}-contact`} checked={d.contactSales} onChange={(v) => set("contactSales", v)}>
              {t("platform.plans.noListPrice", "No list price: show \u201cContact sales\u201d")}
            </CheckRow>
          </div>
          <div>
            <label htmlFor={`${id}-credit`}><Label>{t("platform.plans.creditLabel", "Credit (USD)")}</Label></label>
            <Input id={`${id}-credit`} type="number" inputMode="decimal" min={0} step="0.01" value={d.credit} onChange={(e) => set("credit", e.target.value)} />
            <p className="mt-1.5 text-[13px] text-ink3">{t("platform.plans.creditHint", "Granted when the plan starts and every month after.")}</p>
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <Label>{t("platform.plans.helpLabel", "Help included")}</Label>
            <Select label={t("platform.plans.helpLabel", "Help included")} value={d.assisted} onChange={(v) => set("assisted", v as Assisted)}
              options={ASSISTED.map((a) => ({ value: a, label: assistedLabel(a) }))} />
          </div>
          <div>
            <label htmlFor={`${id}-streams`}><Label>{t("platform.plans.streamsLabel", "Parallel builds")}</Label></label>
            <Input id={`${id}-streams`} type="number" inputMode="numeric" min={1} max={100} step={1} value={d.customStreams ? "" : d.streams}
              disabled={d.customStreams} placeholder={d.customStreams ? t("platform.plans.streamsCustom", "Custom") : "1"} onChange={(e) => set("streams", e.target.value)} />
            <CheckRow id={`${id}-custom`} checked={d.customStreams} onChange={(v) => set("customStreams", v)}>
              {t("platform.plans.customStreams", "Custom: agreed with sales")}
            </CheckRow>
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor={`${id}-priority`}><Label>{t("platform.plans.priorityLabel", "Queue priority")}</Label></label>
            <Input id={`${id}-priority`} type="number" inputMode="numeric" min={0} step={1} value={d.priority} onChange={(e) => set("priority", e.target.value)} />
            <p className="mt-1.5 text-[13px] text-ink3">{t("platform.plans.priorityHint", "Higher goes first in the build queue.")}</p>
          </div>
          <div>
            <label htmlFor={`${id}-order`}><Label>{t("platform.plans.orderLabel", "Order on the plans page")}</Label></label>
            <Input id={`${id}-order`} type="number" inputMode="numeric" min={0} step={1} value={d.sortOrder} onChange={(e) => set("sortOrder", e.target.value)} />
          </div>
        </div>

        <div>
          <label htmlFor={`${id}-features`}><Label>{t("platform.plans.featuresLabel", "What the plan includes")}</Label></label>
          <Textarea id={`${id}-features`} rows={5} value={d.features} onChange={(e) => set("features", e.target.value)} />
          <p className={featureLines > MAX_FEATURES ? "mt-1.5 text-[13px] text-danger" : "mt-1.5 text-[13px] text-ink3"}>
            {t("platform.plans.featuresHint", "One per line, at most {max}. {used} of {max} used.", { max: MAX_FEATURES, used: featureLines })}
          </p>
        </div>

        <CheckRow id={`${id}-active`} checked={d.active} onChange={(v) => set("active", v)}>
          {t("platform.plans.offered", "Offered to organizations")}
        </CheckRow>

        {error && <p role="alert" className="text-[14px] text-danger">{error}</p>}
        <button type="submit" hidden aria-hidden tabIndex={-1} />
      </form>
    </Modal>
  );
}

function CheckRow({ id, checked, onChange, children }: { id: string; checked: boolean; onChange: (v: boolean) => void; children: ReactNode }) {
  return (
    <label htmlFor={id} className="mt-2 flex min-h-[32px] cursor-pointer items-center gap-2.5 text-[14px] text-ink2">
      <input id={id} type="checkbox" className="h-4 w-4 accent-[rgb(var(--c-accent))]" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span>{children}</span>
    </label>
  );
}

/* ── pricing settings ────────────────────────────────────────────────────── */

function PricingSettingsCard() {
  const t = useT();
  const q = useBillingSettings();
  const save = useFunctionMutation<{ priceFactor: number; signupCreditUsd: number }, BillingSettings>({
    fn: "billing", op: "billing.settings.save", invalidate: [SETTINGS_KEY],
  });
  const [factor, setFactor] = useState("");
  const [signup, setSignup] = useState("");
  const [msg, setMsg] = useState<{ tone: "status" | "alert"; text: string } | null>(null);

  useEffect(() => {
    if (!q.data) return;
    setFactor(String(q.data.priceFactor));
    setSignup(String(q.data.signupCreditUsd));
  }, [q.data]);

  const f = num(factor);
  const example = Number.isFinite(f) && f > 0 ? usd(Math.round(2 * f * 100) / 100) : null;
  const dirty = q.data !== undefined && (num(factor) !== q.data.priceFactor || num(signup) !== q.data.signupCreditUsd);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (save.isPending) return;
    const priceFactor = num(factor);
    const signupCreditUsd = num(signup);
    if (!Number.isFinite(priceFactor) || priceFactor <= 0 || priceFactor > MAX_PRICE_FACTOR) {
      setMsg({ tone: "alert", text: t("platform.plans.errorFactor", "The price factor must be more than 0 and at most {max}.", { max: MAX_PRICE_FACTOR }) });
      return;
    }
    if (!isUsdAmount(signupCreditUsd, { allowZero: true })) {
      setMsg({ tone: "alert", text: t("platform.plans.errorSignupCredit", "Enter the sign-up credit in USD (0 or more, at most two decimals).") });
      return;
    }
    setMsg(null);
    try {
      await save.mutateAsync({ priceFactor, signupCreditUsd });
      setMsg({ tone: "status", text: t("platform.plans.pricingSaved", "Pricing settings saved. New usage is charged with the new factor.") });
    } catch (err) {
      setMsg({ tone: "alert", text: adminErrorMessage(err) });
    }
  }

  return (
    <Card title={t("platform.plans.pricingTitle", "Pricing settings")} icon={<SlidersHorizontal size={18} strokeWidth={1.75} />}>
      {q.error ? (
        <p role="alert" className="text-[14px] text-danger">{adminErrorMessage(q.error)}</p>
      ) : q.isPending ? (
        <p className="text-[14px] text-ink2">{t("platform.plans.pricingLoading", "Loading pricing settings…")}</p>
      ) : (
        <form onSubmit={(e) => void submit(e)} noValidate className="grid gap-5">
          <div className="grid gap-5 md:grid-cols-2">
            <div>
              <label htmlFor="billing-factor"><Label>{t("platform.plans.factorLabel", "Price factor")}</Label></label>
              <Input id="billing-factor" type="number" inputMode="decimal" min={0.01} max={MAX_PRICE_FACTOR} step="0.01" value={factor}
                onChange={(e) => setFactor(e.target.value)} />
              <p className="mt-1.5 text-[13px] text-ink3">
                {t("platform.plans.factorHint", "Credit charged = measured cost × factor.")}{example && <> {t("platform.plans.factorExample", "A job measured at USD 2.00 takes {amount} of credit.", { amount: example })}</>}
              </p>
            </div>
            <div>
              <label htmlFor="billing-signup"><Label>{t("platform.plans.signupLabel", "Sign-up credit (USD)")}</Label></label>
              <Input id="billing-signup" type="number" inputMode="decimal" min={0} step="0.01" value={signup}
                onChange={(e) => setSignup(e.target.value)} />
              <p className="mt-1.5 text-[13px] text-ink3">{t("platform.plans.signupHint", "Given once to every new organization.")}</p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <Button type="submit" variant="secondary" disabled={save.isPending || !dirty} aria-busy={save.isPending}>
              {save.isPending ? t("platform.plans.saving", "Saving…") : t("platform.plans.saveSettings", "Save settings")}
            </Button>
            {msg && (
              <p role={msg.tone === "alert" ? "alert" : "status"} className={msg.tone === "alert" ? "text-[14px] text-danger" : "text-[14px] text-ink2"}>
                {msg.text}
              </p>
            )}
          </div>
        </form>
      )}
    </Card>
  );
}
