// Platform management → Model accounts: the accounts the engine hosts work with (Claude subscriptions and the API key),
// how much of each limit is used, when it resets, which ones rest, and people's settings (in rotation, standby or off;
// order; a note). The rotation threshold is set here too. Accounts themselves are added on the engine host, never here.
// The layout shows the section's name and summary; this file renders the content only.
import { useState } from "react";
import { Cpu, KeyRound, RotateCw } from "lucide-react";
import { Bar, Button, Card, Chip, EmptyState, Input, Select } from "@/ui/kit";
import { usePlatformAccess } from "@/blocks/admin";
import { t, useT } from "@/i18n";
import {
  AI_ACCOUNT_SETTABLE, AI_MANAGE_PERMISSION, AI_NOTE_MAX, ENGINE_VIEW_PERMISSION, MIN_ROTATE_AT_PERCENT, checkRotateAt,
  type AiAccountChange, type AiAccountStatus, type AiAccountView, type AiAccountsAnswer,
} from "@/domain/platformEngine";
import { ago, dateTime, until, useAiAccounts, useSaveAiAccounts } from "../engineData";

const ICON = { size: 18, strokeWidth: 1.75 } as const;

/** What an account's status is called, in the current language. */
export function statusText(status: AiAccountStatus): string {
  switch (status) {
    case "active": return t("platform.aiAccounts.status.active", "In rotation");
    case "standby": return t("platform.aiAccounts.status.standby", "Standby");
    case "cooling": return t("platform.aiAccounts.status.cooling", "Resting");
    case "disabled": return t("platform.aiAccounts.status.disabled", "Off");
  }
}
const STATUS_TONE = { active: "success", standby: "neutral", cooling: "warning", disabled: "neutral" } as const;
function providerText(provider: AiAccountView["provider"]): string {
  return provider === "anthropic-api"
    ? t("platform.aiAccounts.provider.apiKey", "API key (pay per use)")
    : t("platform.aiAccounts.provider.subscription", "Claude subscription");
}

function UsageBar({ label, value, threshold }: { label: string; value: number | null; threshold: number }) {
  const t = useT();
  if (value === null) return <span className="text-[13px] text-ink3">{t("platform.aiAccounts.usage.notMeasured", "Not measured yet")}</span>;
  const tone = value >= threshold ? "danger" : value >= threshold - 15 ? "warning" : "accent";
  return (
    <div className="min-w-[96px]" title={t("platform.aiAccounts.usage.title", "{label}: {value} % used", { label, value })}>
      <div className="text-right text-[13px] tabular-nums text-ink">{Math.round(value)} %</div>
      <Bar value={value} tone={tone} className="mt-1" />
    </div>
  );
}

type Draft = { status: AiAccountStatus; priority: string; note: string };
const draftOf = (a: AiAccountView): Draft => ({ status: a.status === "cooling" ? "active" : a.status, priority: String(a.priority), note: a.note });

/** The changes between the saved accounts and the drafts (only what differs), or an error text. */
export function changesFrom(accounts: readonly AiAccountView[], drafts: Readonly<Record<string, Draft>>): { ok: true; changes: AiAccountChange[] } | { ok: false; message: string } {
  const changes: AiAccountChange[] = [];
  for (const a of accounts) {
    const d = drafts[a.itemId];
    if (!d) continue;
    const base = draftOf(a);
    const c: AiAccountChange = { itemId: a.itemId };
    if (d.status !== base.status) c.status = d.status;
    if (d.priority.trim() !== base.priority) {
      const n = Number(d.priority);
      if (!Number.isInteger(n) || n < 0 || n > 1000) return { ok: false, message: t("platform.aiAccounts.accounts.orderInvalid", "The order of {account} must be a whole number from 0 to 1000.", { account: a.label }) };
      c.priority = n;
    }
    if (d.note.trim() !== base.note) c.note = d.note.trim();
    if (Object.keys(c).length > 1) changes.push(c);
  }
  return { ok: true, changes };
}

export function AccountsTable({ answer, now, canManage, onSave, busy }: {
  answer: AiAccountsAnswer;
  now: number;
  canManage: boolean;
  onSave?: (changes: AiAccountChange[]) => Promise<string | null>;
  busy?: boolean;
}) {
  const t = useT();
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);
  const set = (a: AiAccountView, patch: Partial<Draft>) => {
    setDrafts((cur) => ({ ...cur, [a.itemId]: { ...(cur[a.itemId] ?? draftOf(a)), ...patch } }));
    setResult(null);
  };
  const pending = changesFrom(answer.accounts, drafts);
  const dirty = pending.ok ? pending.changes.length > 0 : true;
  const save = async () => {
    if (!pending.ok) return setResult({ ok: false, text: pending.message });
    if (!onSave || pending.changes.length === 0) return;
    const error = await onSave(pending.changes);
    if (error) setResult({ ok: false, text: error });
    else {
      setDrafts({});
      setResult({ ok: true, text: t("platform.aiAccounts.accounts.saved", "Saved. The engine uses the new settings from its next lane on (within a minute).") });
    }
  };
  const statusOptions = AI_ACCOUNT_SETTABLE.map((s) => ({ value: s, label: statusText(s) }));

  return (
    <Card title={t("platform.aiAccounts.accounts.title", "Accounts")} icon={<Cpu {...ICON} />}>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[860px] text-left text-[14px]">
          <caption className="sr-only">{t("platform.aiAccounts.accounts.caption", "The model accounts of the engine hosts, their usage and settings")}</caption>
          <thead className="text-[12px] text-ink3">
            <tr>
              <th scope="col" className="py-2 pr-4 font-medium">{t("platform.aiAccounts.accounts.colAccount", "Account")}</th>
              <th scope="col" className="py-2 pr-4 font-medium">{t("platform.aiAccounts.accounts.colStatus", "Status")}</th>
              <th scope="col" className="py-2 pr-4 text-right font-medium">{t("platform.aiAccounts.accounts.col5h", "5 hours")}</th>
              <th scope="col" className="py-2 pr-4 text-right font-medium">{t("platform.aiAccounts.accounts.col7d", "7 days")}</th>
              <th scope="col" className="py-2 pr-4 font-medium">{t("platform.aiAccounts.accounts.colResets", "Resets")}</th>
              <th scope="col" className="py-2 pr-4 font-medium">{t("platform.aiAccounts.accounts.colLastUsed", "Last used")}</th>
              <th scope="col" className="py-2 pr-4 font-medium">{t("platform.aiAccounts.accounts.colOrder", "Order")}</th>
              <th scope="col" className="py-2 font-medium">{t("platform.aiAccounts.accounts.colNote", "Note")}</th>
            </tr>
          </thead>
          <tbody>
            {answer.accounts.map((a) => {
              const d = drafts[a.itemId] ?? draftOf(a);
              const resets = until(a.resetsAt, now);
              return (
                <tr key={a.itemId} className="border-t border-line align-top">
                  <td className="py-3 pr-4">
                    <div className="font-medium text-ink">{a.label}</div>
                    <div className="flex items-center gap-1 text-[12px] text-ink3">
                      {a.provider === "anthropic-api" && <KeyRound size={12} strokeWidth={1.75} aria-hidden />}
                      {providerText(a.provider)}
                    </div>
                  </td>
                  <td className="py-3 pr-4">
                    {canManage ? (
                      <div className="space-y-1">
                        <Select size="sm" label={t("platform.aiAccounts.accounts.statusOf", "Status of {account}", { account: a.label })} value={d.status} onChange={(v) => set(a, { status: v as AiAccountStatus })} options={statusOptions} />
                        {a.status === "cooling" && <Chip tone="warning">{t("platform.aiAccounts.accounts.restingNow", "Resting now")}</Chip>}
                      </div>
                    ) : (
                      <Chip tone={STATUS_TONE[a.status]}>{statusText(a.status)}</Chip>
                    )}
                  </td>
                  <td className="py-3 pr-4"><UsageBar label={t("platform.aiAccounts.accounts.col5h", "5 hours")} value={a.usage5hPercent} threshold={answer.rotateAtPercent} /></td>
                  <td className="py-3 pr-4"><UsageBar label={t("platform.aiAccounts.accounts.col7d", "7 days")} value={a.usage7dPercent} threshold={answer.rotateAtPercent} /></td>
                  <td className="py-3 pr-4 text-[13px] text-ink2">{resets ? <span title={dateTime(a.resetsAt)}>{resets}</span> : "—"}</td>
                  <td className="py-3 pr-4 text-[13px] text-ink2">{ago(a.lastUsedAt, now)}</td>
                  <td className="py-3 pr-4">
                    {canManage ? (
                      <Input aria-label={t("platform.aiAccounts.accounts.orderOf", "Order of {account}", { account: a.label })} inputMode="numeric" className="h-9 w-20" value={d.priority} onChange={(e) => set(a, { priority: e.target.value })} />
                    ) : (
                      <span className="tabular-nums">{a.priority}</span>
                    )}
                  </td>
                  <td className="py-3">
                    {canManage ? (
                      <Input aria-label={t("platform.aiAccounts.accounts.noteOn", "Note on {account}", { account: a.label })} className="h-9 min-w-[160px]" maxLength={AI_NOTE_MAX} value={d.note} onChange={(e) => set(a, { note: e.target.value })} />
                    ) : (
                      <span className="text-[13px] text-ink2">{a.note || "—"}</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {canManage && (
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <Button variant="primary" disabled={!dirty || busy} onClick={() => void save()}>{busy ? t("platform.aiAccounts.accounts.saving", "Saving…") : t("platform.aiAccounts.accounts.save", "Save changes")}</Button>
          {dirty && <Button variant="ghost" onClick={() => { setDrafts({}); setResult(null); }}>{t("platform.aiAccounts.accounts.discard", "Discard")}</Button>}
          {result && <span role={result.ok ? "status" : "alert"} className={result.ok ? "text-[14px] text-ink2" : "text-[14px] text-danger"}>{result.text}</span>}
        </div>
      )}
    </Card>
  );
}

export function RotationCard({ value, isDefault, canManage, onSave, busy }: {
  value: number;
  isDefault: boolean;
  canManage: boolean;
  onSave?: (n: number) => Promise<string | null>;
  busy?: boolean;
}) {
  const t = useT();
  const [draft, setDraft] = useState<string | null>(null);
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);
  const text = draft ?? String(value);
  const save = async () => {
    const c = checkRotateAt(Number(text));
    if (!c.ok) return setResult({ ok: false, text: c.message });
    const error = onSave ? await onSave(c.value) : null;
    if (error) setResult({ ok: false, text: error });
    else {
      setDraft(null);
      setResult({ ok: true, text: t("platform.aiAccounts.rotation.saved", "Saved.") });
    }
  };
  return (
    <Card title={t("platform.aiAccounts.rotation.title", "When an account rests")} icon={<RotateCw {...ICON} />} action={isDefault && draft === null ? <Chip tone="neutral">{t("platform.aiAccounts.rotation.default", "Default")}</Chip> : undefined}>
      <p className="max-w-prose text-[14px] text-ink2">
        {t("platform.aiAccounts.rotation.explain", "When an account has used this share of its 5-hour or 7-day limit, the engine stops starting new work on it and moves on to the account with the most room left. The account rests until its limit resets. When every subscription rests, the engine uses the API key, if one is set up.")}
      </p>
      <div className="mt-4 flex flex-wrap items-end gap-3">
        <label className="block">
          <span className="mb-1.5 block text-[13px] text-ink2">{t("platform.aiAccounts.rotation.restAt", "Rest an account at")}</span>
          <span className="flex items-center gap-2">
            <Input className="w-24" inputMode="numeric" aria-describedby="rotate-hint" value={text} disabled={!canManage}
              onChange={(e) => { setDraft(e.target.value); setResult(null); }} />
            <span className="text-[14px] text-ink2">{t("platform.aiAccounts.rotation.percentUsed", "% used")}</span>
          </span>
        </label>
        {canManage && <Button variant="primary" disabled={busy || draft === null || Number(draft) === value} onClick={() => void save()}>{t("platform.aiAccounts.rotation.save", "Save")}</Button>}
      </div>
      <p id="rotate-hint" className="mt-2 text-[12px] text-ink3">{t("platform.aiAccounts.rotation.hint", "From {min} to 100. The usual setting is 99.", { min: MIN_ROTATE_AT_PERCENT })}</p>
      {result && <p role={result.ok ? "status" : "alert"} className={result.ok ? "mt-2 text-[14px] text-ink2" : "mt-2 text-[14px] text-danger"}>{result.text}</p>}
    </Card>
  );
}

export function HowToAdd() {
  const t = useT();
  return (
    <Card title={t("platform.aiAccounts.howToAdd.title", "Adding an account")}>
      <div className="max-w-prose space-y-2 text-[14px] text-ink2">
        <p>
          {t("platform.aiAccounts.howToAdd.onHost", "Accounts are added on the engine host, never in this app, so no password, token or key ever passes through the platform. Each Claude subscription is its own folder in the engine's account folder, signed in once on the host. The engine finds a new folder within a minute and lists it here.")}
        </p>
        <p>
          {t("platform.aiAccounts.howToAdd.apiKey", "The API key is the same key file the engine already uses when a subscription runs out. It is used only while every subscription rests, and it is paid per use.")}
        </p>
        <p>
          {t("platform.aiAccounts.howToAdd.decide", "Here you decide which accounts are in rotation, which wait on standby and which are off, and in which order accounts with the same room left are used. The engine host's setup guide has the steps for the person who runs it.")}
        </p>
      </div>
    </Card>
  );
}

/** The section's content for an answer (rendered by tests without the data layer). */
export function AiAccountsView({ answer, now, canManage, onSaveAccounts, onSaveRotation, busy }: {
  answer: AiAccountsAnswer;
  now: number;
  canManage: boolean;
  onSaveAccounts?: (changes: AiAccountChange[]) => Promise<string | null>;
  onSaveRotation?: (n: number) => Promise<string | null>;
  busy?: boolean;
}) {
  const t = useT();
  const inRotation = answer.accounts.filter((a) => a.status === "active").length;
  return (
    <div className="space-y-6">
      {answer.accounts.length === 0 ? (
        <EmptyState icon={<Cpu size={28} strokeWidth={1.75} />} title={t("platform.aiAccounts.empty.title", "No model accounts listed yet")}
          text={t("platform.aiAccounts.empty.text", "The engine runs on its host's own sign-in. Accounts added on the engine host appear here, with how much of each limit is used and when it resets.")} />
      ) : (
        <>
          <p className="text-[14px] text-ink2" role="status">
            {inRotation === 0
              ? t("platform.aiAccounts.summary.none", "No account is in rotation right now: new work waits for a reset, or runs on the API key if one is set up.")
              : answer.accounts.length === 1
                ? t("platform.aiAccounts.summary.oneOfOne", "{n} of {total} account in rotation.", { n: inRotation, total: answer.accounts.length })
                : t("platform.aiAccounts.summary.someOfMany", "{n} of {total} accounts in rotation.", { n: inRotation, total: answer.accounts.length })}
          </p>
          <AccountsTable answer={answer} now={now} canManage={canManage} onSave={onSaveAccounts} busy={busy} />
        </>
      )}
      <RotationCard value={answer.rotateAtPercent} isDefault={answer.rotateIsDefault} canManage={canManage} onSave={onSaveRotation} busy={busy} />
      <HowToAdd />
    </div>
  );
}

const errorText = (e: unknown): string => (e instanceof Error && e.message ? e.message : t("platform.aiAccounts.saveFailed", "The change could not be saved. Nothing was changed; try again."));

export default function AiAccountsSection() {
  const t = useT();
  const access = usePlatformAccess();
  const canManage = access.isSuperAdmin || access.permissions.includes(AI_MANAGE_PERMISSION);
  const allowed = canManage || access.permissions.includes(ENGINE_VIEW_PERMISSION);
  const q = useAiAccounts(allowed);
  const save = useSaveAiAccounts();
  if (!allowed) {
    return <EmptyState icon={<Cpu size={28} strokeWidth={1.75} />} title={t("platform.aiAccounts.denied.title", "You can't see the model accounts")} text={t("platform.aiAccounts.denied.text", "Ask a platform admin for the permission to see or manage the model accounts.")} />;
  }
  if (q.isLoading) return <p className="text-[14px] text-ink3" role="status">{t("platform.aiAccounts.loading", "Reading the model accounts…")}</p>;
  if (q.isError || !q.data) {
    return (
      <EmptyState icon={<Cpu size={28} strokeWidth={1.75} />} title={t("platform.aiAccounts.readFailed.title", "The model accounts could not be read")}
        text={t("platform.aiAccounts.readFailed.text", "Nothing was changed. Try again in a moment.")} action={<Button onClick={() => void q.refetch()}>{t("platform.aiAccounts.readFailed.retry", "Try again")}</Button>} />
    );
  }
  const run = async (args: { changes?: AiAccountChange[]; rotateAtPercent?: number }): Promise<string | null> => {
    try {
      await save.mutateAsync(args);
      return null;
    } catch (e) {
      return errorText(e);
    }
  };
  return (
    <AiAccountsView answer={q.data} now={Date.now()} canManage={canManage} busy={save.isPending}
      onSaveAccounts={(changes) => run({ changes })} onSaveRotation={(n) => run({ rotateAtPercent: n })} />
  );
}
