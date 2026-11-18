import { useRef, useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { Eye, EyeOff, KeyRound } from "lucide-react";
import { Button, Card, Input } from "@/madp/ui/kit";
import { changeMyPassword, newPasswordError } from "@/madp/blocks/account";
import { endSession } from "@/madp/blocks/session";
import { useT } from "@/madp/i18n";

const LABEL = "mb-2 block text-[13px] font-medium text-ink2";

type Errors = { current?: string; next?: string; confirm?: string };

function PasswordField({ id, label, showLabel, hideLabel, value, onChange, autoComplete, error, disabled, maxLength }: {
  id: string; label: string; showLabel: string; hideLabel: string; value: string; onChange: (v: string) => void;
  autoComplete: "current-password" | "new-password"; error?: string; disabled: boolean; maxLength?: number;
}) {
  const [shown, setShown] = useState(false);
  return (
    <div>
      <label htmlFor={id} className={LABEL}>{label}</label>
      <div className="relative">
        <Input id={id} type={shown ? "text" : "password"} autoComplete={autoComplete} maxLength={maxLength} className="pr-12"
          value={value} readOnly={disabled} aria-invalid={error ? true : undefined}
          aria-describedby={error ? `${id}-error` : undefined} onChange={(e) => onChange(e.target.value)} />
        <button type="button" aria-pressed={shown} aria-label={shown ? hideLabel : showLabel}
          disabled={disabled} onClick={() => setShown((s) => !s)}
          className="absolute right-1.5 top-1/2 grid h-9 w-9 -translate-y-1/2 place-items-center rounded-full text-ink2 hover:bg-line hover:text-ink disabled:opacity-45">
          {shown ? <EyeOff size={18} strokeWidth={1.75} aria-hidden="true" /> : <Eye size={18} strokeWidth={1.75} aria-hidden="true" />}
        </button>
      </div>
      {error && <p id={`${id}-error`} className="mt-2 text-[13px] text-danger">{error}</p>}
    </div>
  );
}

export function SecurityCard() {
  const t = useT();
  const formRef = useRef<HTMLFormElement>(null);
  const navigate = useNavigate();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [errors, setErrors] = useState<Errors>({});
  const [failure, setFailure] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    setFailure(null);
    const found: Errors = {};
    if (!current) found.current = t("settings.security.enterCurrent", "Enter your current password.");
    const nextError = newPasswordError(next, confirm);
    if (nextError) {
      if (next !== confirm && next.length >= 8 && next.length <= 64) found.confirm = nextError;
      else found.next = nextError;
    } else if (next === current) found.next = t("settings.security.chooseDifferent", "Choose a password different from the current one.");
    setErrors(found);
    if (found.current || found.next || found.confirm) return;
    setBusy(true);
    const r = await changeMyPassword(current, next);
    setBusy(false);
    setCurrent(""); setNext(""); setConfirm("");
    if (r.ok) {
      endSession(t("settings.security.changedSignInAgain", "Password changed. Please sign in again."));
      navigate("/sign-in", { replace: true });
      return;
    }
    setFailure(r.message);
  }

  return (
    <div id="security" tabIndex={-1} className="scroll-mt-6 outline-none">
      <Card title={t("settings.security.title", "Password")} icon={<KeyRound size={18} strokeWidth={1.75} />} bodyClassName="flex flex-col gap-4">
        <p className="max-w-[68ch] text-[14px] text-ink2">
          {t("settings.security.intro", "Change the password you use to sign in. You'll be signed out and sign in again with the new password.")}
        </p>
        <form ref={formRef} onSubmit={submit} noValidate className="flex max-w-[420px] flex-col gap-4">
          <PasswordField id="sec-current" label={t("settings.security.currentLabel", "Current password")}
            showLabel={t("settings.security.showCurrent", "Show current password")} hideLabel={t("settings.security.hideCurrent", "Hide current password")} autoComplete="current-password" value={current}
            onChange={(v) => { setCurrent(v); if (errors.current) setErrors((x) => ({ ...x, current: undefined })); }}
            error={errors.current} disabled={busy} />
          <PasswordField id="sec-new" label={t("settings.security.newLabel", "New password")}
            showLabel={t("settings.security.showNew", "Show new password")} hideLabel={t("settings.security.hideNew", "Hide new password")} autoComplete="new-password" maxLength={64} value={next}
            onChange={(v) => { setNext(v); if (errors.next) setErrors((x) => ({ ...x, next: undefined })); }}
            error={errors.next} disabled={busy} />
          <PasswordField id="sec-confirm" label={t("settings.security.confirmLabel", "Confirm new password")}
            showLabel={t("settings.security.showConfirm", "Show confirm new password")} hideLabel={t("settings.security.hideConfirm", "Hide confirm new password")} autoComplete="new-password" maxLength={64} value={confirm}
            onChange={(v) => { setConfirm(v); if (errors.confirm) setErrors((x) => ({ ...x, confirm: undefined })); }}
            error={errors.confirm} disabled={busy} />
          {failure && <p role="alert" className="text-[13px] text-danger">{failure}</p>}
          <div>
            <Button type="submit" variant="secondary" disabled={busy} aria-busy={busy || undefined}>
              {busy ? t("settings.security.changing", "Changing password…") : t("settings.security.change", "Change password")}
            </Button>
          </div>
        </form>
      </Card>
    </div>
  );
}
