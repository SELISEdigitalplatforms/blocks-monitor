import { useState } from "react";
import { UserPlus } from "lucide-react";
import { Button, Card, Chip } from "@/madp/ui/kit";
import { useSaveSignupMode, useSignupSettings } from "@/madp/blocks/signupSettings";
import type { SignupMode } from "@/madp/domain/signup";
import { t, useT } from "@/madp/i18n";

function options(): { mode: SignupMode; title: string; text: string }[] {
  return [
    { mode: "open", title: t("platform.admin.signupMode.openTitle", "Open"),
      text: t("platform.admin.signupMode.openText", "Anyone can create an account at the sign-up page, confirm their email and start on the Free plan.") },
    { mode: "invite-only", title: t("platform.admin.signupMode.inviteTitle", "Invite-only"),
      text: t("platform.admin.signupMode.inviteText", "New people join only by invitation. The sign-up page tells visitors how to get access.") },
  ];
}

/** Platform -> Settings: open public sign-up or keep the platform invite-only (PlatformSetting auth.signup). */
export function SignupModeCard({ canEdit }: { canEdit: boolean }) {
  const t = useT();
  const q = useSignupSettings(true);
  const save = useSaveSignupMode();
  const [draft, setDraft] = useState<SignupMode | null>(null);
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);
  const saved = q.data?.mode ?? null;
  const value = draft ?? saved;
  const changed = draft !== null && draft !== saved;

  const onSave = () => {
    if (!draft) return;
    setResult(null);
    save.mutate(draft, {
      onSuccess: (d) => { setDraft(null); setResult({ ok: true, text: d.mode === "open" ? t("platform.admin.signupMode.savedOpen", "Sign-up is open.") : t("platform.admin.signupMode.savedInvite", "Sign-up is invite-only.") }); },
      onError: (e) => setResult({ ok: false, text: e.message || t("platform.admin.signupMode.saveFailed", "The setting could not be saved. Try again in a moment.") }),
    });
  };

  return (
    <Card title={t("platform.admin.signupMode.title", "Who can create an account")} icon={<UserPlus size={18} strokeWidth={1.75} />}
      action={q.data?.isDefault && !changed ? <Chip tone="neutral">{t("platform.admin.signupMode.default", "Default")}</Chip> : undefined}>
      {q.isError ? (
        <p role="alert" className="text-[14px] text-danger">{t("platform.admin.signupMode.loadFailed", "This setting could not be loaded. Try again in a moment.")}</p>
      ) : value === null ? (
        <p aria-busy="true" className="text-[14px] text-ink3">{t("platform.admin.signupMode.loading", "Loading…")}</p>
      ) : (
        <fieldset disabled={!canEdit || save.isPending}>
          <legend className="sr-only">{t("platform.admin.signupMode.title", "Who can create an account")}</legend>
          <div className="grid gap-3 sm:grid-cols-2">
            {options().map((o) => (
              <label key={o.mode}
                className={`flex cursor-pointer items-start gap-3 rounded-block p-4 ring-1 transition ${value === o.mode ? "bg-accent/[0.06] ring-accent" : "bg-surface2 ring-transparent hover:ring-line"}`}>
                <input type="radio" name="signup-mode" value={o.mode} checked={value === o.mode}
                  onChange={() => { setDraft(o.mode); setResult(null); }} className="mt-1 accent-[rgb(var(--c-accent))]" />
                <span>
                  <span className="block text-[15px] font-medium text-ink">{o.title}</span>
                  <span className="mt-1 block text-[13px] text-ink2">{o.text}</span>
                </span>
              </label>
            ))}
          </div>
          {canEdit ? (
            <div className="mt-5 flex flex-wrap items-center gap-3">
              <Button variant="secondary" disabled={!changed || save.isPending} onClick={onSave}>{t("platform.admin.signupMode.save", "Save")}</Button>
              {save.isPending && <span aria-busy="true" className="text-[13px] text-ink3">{t("platform.admin.signupMode.saving", "Saving…")}</span>}
              {result && (result.ok
                ? <p role="status" className="text-[13px] text-[rgb(var(--c-success-text))]">{result.text}</p>
                : <p role="alert" className="text-[13px] text-danger">{result.text}</p>)}
            </div>
          ) : (
            <p className="mt-4 text-[13px] text-ink3">{t("platform.admin.signupMode.readOnly", "Only people who manage platform settings can change this.")}</p>
          )}
        </fieldset>
      )}
    </Card>
  );
}
