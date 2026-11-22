// Platform > Plans > "Payments and access": how plans are paid (billing.provider: codes, or the Blocks payment gateway
// once it is connected), whether new work needs credit left (billing.enforce, off by default) and the internal
// organizations the paywall never stops (billing.internalWorkspaceIds). billing.paywall.get / save (super admin).
import { useEffect, useMemo, useState, type FormEvent } from "react";
import { useQuery } from "@tanstack/react-query";
import { freshnessQuery } from "@/blocks/data/freshness";
import { ShieldCheck } from "lucide-react";
import { Button, Card, Chip, Input, Label, Select } from "@/ui/kit";
import { adminErrorMessage } from "@/blocks/admin";
import { BALANCES_KEY, fetchBalances, type BalancesData } from "./balancesData";
import type { PaymentProviderId } from "@/domain/payments";
import { usePaywallSettings, useSavePaywall } from "@/components/billing/checkoutData";
import { t, useT } from "@/i18n";

function providerOptions() {
  return [
    { value: "coupon", label: t("platform.paywall.providerCoupon", "Codes only (vouchers from sales)") },
    { value: "blocks", label: t("platform.paywall.providerBlocks", "Blocks payment gateway (cards)") },
  ];
}

type Source = "factory" | "blocks-utilities";

function sourceOptions() {
  return [
    { value: "factory", label: t("platform.paywall.sourceFactory", "This platform (plans, codes and subscriptions kept here)") },
    { value: "blocks-utilities", label: t("platform.paywall.sourceUtilities", "Blocks Utilities (plans, codes, subscriptions, invoices and card payments)") },
  ];
}

/** The organization list from billing.balances.list, cached under the Credits section's key and in its shape. */
function useOrganizations() {
  return useQuery({
    queryKey: [...BALANCES_KEY],
    queryFn: fetchBalances,
    select: (d: BalancesData) => d.rows,
    ...freshnessQuery("calm"),
    retry: 0,
  });
}

export function PaywallSettingsCard() {
  const t = useT();
  const q = usePaywallSettings(true);
  const orgs = useOrganizations();
  const save = useSavePaywall();
  const [source, setSource] = useState<Source>("factory");
  const [enforce, setEnforce] = useState(false);
  const [provider, setProvider] = useState<PaymentProviderId>("coupon");
  const [internal, setInternal] = useState<string[]>([]);
  const [search, setSearch] = useState("");
  const [msg, setMsg] = useState<{ tone: "status" | "alert"; text: string } | null>(null);

  useEffect(() => {
    if (!q.data) return;
    setSource(q.data.source ?? "factory");
    setEnforce(q.data.enforce);
    setProvider(q.data.provider);
    setInternal(q.data.internalWorkspaceIds);
  }, [q.data]);

  const dirty = q.data !== undefined && (source !== (q.data.source ?? "factory") || enforce !== q.data.enforce || provider !== q.data.provider
    || [...internal].sort().join(",") !== [...q.data.internalWorkspaceIds].sort().join(","));
  const shown = useMemo(() => {
    const rows = [...(orgs.data ?? [])].sort((a, b) => Number(internal.includes(b.workspaceId)) - Number(internal.includes(a.workspaceId)) || a.name.localeCompare(b.name));
    const s = search.trim().toLowerCase();
    return (s ? rows.filter((r) => r.name.toLowerCase().includes(s)) : rows).slice(0, 50);
  }, [orgs.data, internal, search]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (save.isPending) return;
    setMsg(null);
    try {
      const next = await save.mutateAsync({ enforce, provider, internalWorkspaceIds: internal, ...(source !== (q.data?.source ?? "factory") ? { source } : {}) });
      setMsg({
        tone: "status",
        text: next.enforce
          ? t("platform.paywall.savedEnforced", "Saved. New builds, analyses and fix rounds now need credit left, except for the internal organizations.")
          : t("platform.paywall.savedOpen", "Saved. New work starts whatever the credit."),
      });
    } catch (err) {
      setMsg({ tone: "alert", text: adminErrorMessage(err) });
    }
  }

  const status = q.data?.providerStatus;
  return (
    <Card title={t("platform.paywall.title", "Payments and access")} icon={<ShieldCheck size={18} strokeWidth={1.75} />}>
      {q.error ? (
        <p role="alert" className="text-[14px] text-danger">{adminErrorMessage(q.error)}</p>
      ) : q.isPending ? (
        <p className="text-[14px] text-ink2">{t("platform.paywall.loading", "Loading payment settings…")}</p>
      ) : (
        <form onSubmit={(e) => void submit(e)} noValidate className="grid gap-6">
          <div className="min-w-0">
            <Label>{t("platform.paywall.sourceLabel", "Where plans live")}</Label>
            <Select label={t("platform.paywall.sourceLabel", "Where plans live")} value={source} onChange={(v) => setSource(v as Source)} options={sourceOptions()} />
            <p className="mt-1.5 text-[13px] text-ink3">
              {source === "blocks-utilities"
                ? t("platform.paywall.sourceUtilitiesHint", "Plans, plan and discount codes, subscriptions, renewals, invoices, card payments and bought credit are held by Blocks Utilities. Credit codes, the credit balance and usage stay here. Move the catalogue first with scripts/blocks-utilities-sync.mjs.")
                : t("platform.paywall.sourceFactoryHint", "Plans, codes and subscriptions are kept on this platform.")}
            </p>
          </div>
          <div className="grid gap-5 md:grid-cols-2">
            <div className="min-w-0">
              <Label>{t("platform.paywall.providerLabel", "How plans are paid")}</Label>
              <Select label={t("platform.paywall.providerLabel", "How plans are paid")} value={provider} onChange={(v) => setProvider(v as PaymentProviderId)} options={providerOptions()} />
              <p className="mt-1.5 text-[13px] text-ink3">
                {provider === "blocks"
                  ? status?.id === "blocks" && status.connected
                    ? t("platform.paywall.gatewayConnectedHint", "The gateway is connected: checkout opens its secure payment page. Codes still work.")
                    : t("platform.paywall.gatewayMissingHint", "The gateway is not connected on this host yet: card payments are refused with a plain message, codes still work.")
                  : t("platform.paywall.codesHint", "A code pays a plan for its months, takes a discount off or adds credit. Nothing is charged to a card.")}
              </p>
              {status && <div className="mt-2"><Chip tone={status.connected ? "success" : "warning"}>{status.connected ? t("platform.paywall.connected", "Connected") : t("platform.paywall.notConnected", "Not connected")}</Chip></div>}
            </div>
            <div className="min-w-0">
              <Label>{t("platform.paywall.accessLabel", "Access")}</Label>
              <label htmlFor="billing-enforce" className="flex min-h-[44px] cursor-pointer items-center gap-2.5 text-[14px] text-ink">
                <input id="billing-enforce" type="checkbox" className="h-4 w-4 accent-[rgb(var(--c-accent))]" checked={enforce} onChange={(e) => setEnforce(e.target.checked)} />
                <span>{t("platform.paywall.enforceLabel", "New work needs credit left")}</span>
              </label>
              <p className="mt-1 text-[13px] text-ink3">
                {t("platform.paywall.enforceHint", "On: an organization without credit cannot start builds, analyses or fix rounds; it sees \"Choose a plan\" and \"Redeem a code\". Work already running finishes. Off: work starts whatever the credit.")}
              </p>
            </div>
          </div>

          <div className="min-w-0">
            <Label>{t("platform.paywall.internalLabel", "Internal organizations (never stopped)")}</Label>
            <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder={t("platform.paywall.findOrganization", "Find an organization")} aria-label={t("platform.paywall.findOrganization", "Find an organization")} className="sm:max-w-sm" />
            {orgs.error ? (
              <p role="alert" className="mt-2 text-[14px] text-danger">{adminErrorMessage(orgs.error)}</p>
            ) : orgs.isPending ? (
              <p className="mt-2 text-[14px] text-ink2">{t("platform.paywall.loadingOrganizations", "Loading organizations…")}</p>
            ) : shown.length === 0 ? (
              <p className="mt-2 text-[14px] text-ink2">{t("platform.paywall.noMatch", "No organization matches.")}</p>
            ) : (
              <ul className="mt-2 max-h-72 divide-y divide-line overflow-y-auto rounded-block ring-1 ring-inset ring-line">
                {shown.map((o) => {
                  const id = `internal-${o.workspaceId}`;
                  const on = internal.includes(o.workspaceId);
                  return (
                    <li key={o.workspaceId}>
                      <label htmlFor={id} className="flex min-h-[44px] cursor-pointer items-center gap-3 px-3 text-[14px]">
                        <input id={id} type="checkbox" className="h-4 w-4 accent-[rgb(var(--c-accent))]" checked={on}
                          onChange={(e) => setInternal((cur) => (e.target.checked ? [...cur, o.workspaceId] : cur.filter((x) => x !== o.workspaceId)))} />
                        <span className="min-w-0 flex-1 truncate text-ink">{o.name || o.workspaceId}</span>
                        <span className="num shrink-0 text-[13px] text-ink3">{o.planName}</span>
                      </label>
                    </li>
                  );
                })}
              </ul>
            )}
            <p className="mt-1.5 text-[13px] text-ink3">{internal.length === 0 ? t("platform.paywall.noneChosen", "None chosen.") : t("platform.paywall.chosenCount", "{count} chosen.", { count: internal.length })} {t("platform.paywall.internalHint", "Our own organizations go here so their work never waits for credit.")}</p>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <Button type="submit" variant="secondary" disabled={save.isPending || !dirty} aria-busy={save.isPending}>
              {save.isPending ? t("platform.paywall.saving", "Saving…") : t("platform.paywall.saveButton", "Save payment settings")}
            </Button>
            {msg && <p role={msg.tone === "alert" ? "alert" : "status"} className={msg.tone === "alert" ? "text-[14px] text-danger" : "text-[14px] text-ink2"}>{msg.text}</p>}
          </div>
        </form>
      )}
    </Card>
  );
}
