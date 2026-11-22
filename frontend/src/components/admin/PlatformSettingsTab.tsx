import { useState, type KeyboardEvent, type ReactNode } from "react";
import { AtSign, UserCheck, X } from "lucide-react";
import { Button, Card, Chip, IconButton, Input, Label } from "@/ui/kit";
import { SignupModeCard } from "./SignupModeCard";
import { settleWrite, usePlatformSettings, useSaveSetting, type PlatformAccess } from "@/blocks/admin";
import {
  allowedDomainsFrom, checkAllowedDomains, checkQaExceptions, isValidDomain, isValidEmail, normalizeDomain, normalizeEmail,
  parseSettingValue,
} from "@/domain/platform";
import { useT } from "@/i18n";

type SettingKey = "allowedEmailDomains" | "qaExceptions";
const ICON = { size: 18, strokeWidth: 1.75 } as const;
const same = (a: string[], b: string[]) => a.length === b.length && a.every((v, i) => v === b[i]);

interface ListCardProps {
  settingKey: SettingKey;
  title: string;
  icon: ReactNode;
  intro: string;
  addLabel: string;
  placeholder: string;
  emptyText: string;
  saved: string[];
  isDefault?: boolean;
  canEdit: boolean;
  normalize: (raw: string) => string;
  isValid: (v: string) => boolean;
  invalidText: string;
  check: (list: string[]) => { ok: true; values: string[] } | { ok: false; message: string };
  doneText: string;
}

function ListCard(p: ListCardProps) {
  const t = useT();
  const save = useSaveSetting();
  const [draft, setDraft] = useState<string[] | null>(null);
  const [baseline, setBaseline] = useState<string[] | null>(null);
  const [input, setInput] = useState("");
  const [addError, setAddError] = useState("");
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const base = baseline ?? p.saved;
  const list = draft ?? base;
  const changed = !same(list, base);
  const inputId = `${p.settingKey}-add`;
  const errId = `${p.settingKey}-add-error`;

  const add = () => {
    const v = p.normalize(input);
    if (!v) return;
    if (!p.isValid(v)) { setAddError(p.invalidText); return; }
    if (list.includes(v)) { setAddError(t("platform.admin.settings.alreadyInList", "{value} is already in the list.", { value: v })); return; }
    setDraft([...list, v]); setInput(""); setAddError(""); setResult(null);
  };
  const remove = (v: string) => {
    const next = list.filter((x) => x !== v);
    const c = p.check(next);
    if (!c.ok && next.length === 0 && p.settingKey === "allowedEmailDomains") { setAddError(c.message); return; }
    setDraft(next); setAddError(""); setResult(null);
  };
  const onKey = (e: KeyboardEvent<HTMLInputElement>) => { if (e.key === "Enter") { e.preventDefault(); add(); } };
  const onSave = async () => {
    const c = p.check(list);
    if (!c.ok) { setResult({ ok: false, text: c.message }); return; }
    setBusy(true); setResult(null);
    const r = await settleWrite(save.mutateAsync({ key: p.settingKey, values: c.values }));
    setBusy(false);
    if (r.ok) { setBaseline(c.values); setDraft(c.values); setResult({ ok: true, text: p.doneText }); }
    else setResult({ ok: false, text: r.error });
  };

  return (
    <Card title={p.title} icon={p.icon}
      action={p.isDefault && !changed ? <Chip tone="neutral">{t("platform.admin.settings.default", "Default")}</Chip> : undefined}>
      <p className="max-w-prose text-[14px] text-ink2">{p.intro}</p>
      {list.length === 0 ? (
        <p className="mt-4 text-[14px] text-ink3">{p.emptyText}</p>
      ) : (
        <ul className="mt-4 flex flex-wrap gap-2" aria-label={p.title}>
          {list.map((v) => (
            <li key={v} className="flex items-center gap-1 rounded-full bg-surface2 py-1 pl-4 pr-1 text-[14px] text-ink">
              <span className="min-w-0 break-all">{v}</span>
              {p.canEdit && (
                <IconButton className="!h-8 !w-8" icon={<X size={16} strokeWidth={1.75} />} label={t("platform.admin.settings.removeValue", "Remove {value}", { value: v })} onClick={() => remove(v)} />
              )}
            </li>
          ))}
        </ul>
      )}
      {p.canEdit ? (
        <div className="mt-5">
          <label htmlFor={inputId}><Label>{p.addLabel}</Label></label>
          <div className="flex flex-wrap items-center gap-2">
            <div className="min-w-[200px] flex-1">
              <Input id={inputId} value={input} placeholder={p.placeholder} autoComplete="off" spellCheck={false}
                aria-invalid={addError ? true : undefined} aria-describedby={addError ? errId : undefined}
                onChange={(e) => { setInput(e.target.value); setAddError(""); }} onKeyDown={onKey} />
            </div>
            <Button variant="ghost" onClick={add}>{t("platform.admin.settings.add", "Add")}</Button>
          </div>
          {addError && <p id={errId} role="alert" className="mt-2 text-[13px] text-danger">{addError}</p>}
          <div className="mt-5 flex flex-wrap items-center gap-3">
            <Button variant="secondary" disabled={busy || !changed} onClick={onSave}>{t("platform.admin.settings.save", "Save")}</Button>
            {busy && <span aria-busy="true" className="text-[13px] text-ink3">{t("platform.admin.settings.saving", "Saving…")}</span>}
            {result && (result.ok
              ? <p role="status" className="text-[13px] text-[rgb(var(--c-success-text))]">{result.text}</p>
              : <p role="alert" className="text-[13px] text-danger">{result.text}</p>)}
          </div>
        </div>
      ) : (
        <p className="mt-4 text-[13px] text-ink3">{t("platform.admin.settings.readOnly", "Only people who manage platform settings can change this.")}</p>
      )}
    </Card>
  );
}

export function PlatformSettingsTab({ access }: { access: PlatformAccess }) {
  const t = useT();
  const q = usePlatformSettings(true);
  const canEdit = access.isSuperAdmin || access.permissions.includes("platform.settings.manage");

  if (q.isError) {
    return <div role="alert" className="rounded-card bg-danger-soft p-5 text-[14px] text-danger">{(q.error as Error | null)?.message || t("platform.admin.settings.loadFailed", "The settings could not be loaded. Try again in a moment.")}</div>;
  }
  if (q.isLoading || q.data === undefined) {
    return <div aria-busy="true" className="rounded-card bg-surface p-6 text-[14px] text-ink3 shadow-card dark:ring-1 dark:ring-line">{t("platform.admin.settings.loading", "Loading settings…")}</div>;
  }
  const rec = (k: SettingKey) => q.data?.find((r) => r.Key === k)?.ValueJson;
  const domains = allowedDomainsFrom(rec("allowedEmailDomains"));
  const qa = parseSettingValue(rec("qaExceptions"));

  return (
    <div className="grid w-full gap-6">
      <SignupModeCard canEdit={canEdit} />
      <ListCard settingKey="allowedEmailDomains" title={t("platform.admin.settings.domainsTitle", "Allowed e-mail domains")} icon={<AtSign {...ICON} />}
        intro={t("platform.admin.settings.domainsIntro", "Only e-mail addresses on these domains can be invited to an organization.")}
        addLabel={t("platform.admin.settings.domainsAdd", "Add a domain")} placeholder={t("platform.admin.settings.domainsPlaceholder", "yourdomain.com")}
        emptyText={t("platform.admin.settings.domainsEmpty", "No domains yet.")}
        saved={domains.values} isDefault={domains.isDefault} canEdit={canEdit}
        normalize={normalizeDomain} isValid={isValidDomain} invalidText={t("platform.admin.settings.domainsInvalid", "Enter a domain like yourdomain.com.")}
        check={checkAllowedDomains} doneText={t("platform.admin.settings.domainsSaved", "Allowed domains saved.")} />
      <ListCard settingKey="qaExceptions" title={t("platform.admin.settings.emailsTitle", "Allowed e-mail addresses")} icon={<UserCheck {...ICON} />}
        intro={t("platform.admin.settings.emailsIntro", "People outside the allowed domains who may still join, such as clients, partners and testers.")}
        addLabel={t("platform.admin.settings.emailsAdd", "Add an e-mail address")} placeholder={t("platform.admin.settings.emailsPlaceholder", "name@company.com")}
        emptyText={t("platform.admin.settings.emailsEmpty", "No addresses yet.")}
        saved={qa} canEdit={canEdit}
        normalize={normalizeEmail} isValid={isValidEmail} invalidText={t("platform.admin.settings.emailsInvalid", "Enter a valid e-mail address.")}
        check={checkQaExceptions} doneText={t("platform.admin.settings.emailsSaved", "Allowed e-mail addresses saved.")} />
    </div>
  );
}
