import { useEffect, useRef, useState, type FormEvent } from "react";
import { ArrowRight, Eye, EyeOff, KeyRound, LoaderCircle } from "lucide-react";
import { Button, Input } from "@/madp/ui/kit";
import { PASSWORD_MAX, changeMyPassword, finishFirstPasswordChange, newPasswordError } from "@/madp/blocks/account";
import { signOut } from "@/madp/blocks/session";
import { PasswordStrength } from "./PasswordStrength";
import { useT } from "@/madp/i18n";

const LABEL = "mb-1.5 block text-[12px] font-medium uppercase tracking-wider text-ink2";

function PasswordField({ id, label, value, onChange, shown, onToggle, disabled, autoComplete, describedBy, invalid, strength }: {
  id: string; label: string; value: string; onChange: (v: string) => void; shown: boolean; onToggle: () => void; disabled: boolean;
  autoComplete: string; describedBy?: string; invalid?: boolean; strength?: string;
}) {
  const t = useT();
  return (
    <div className="si-field">
      <label htmlFor={id} className={LABEL}>{label}</label>
      <div className="relative">
        <Input id={id} type={shown ? "text" : "password"} autoComplete={autoComplete} className="pr-12" maxLength={PASSWORD_MAX}
          value={value} readOnly={disabled} aria-invalid={invalid ? true : undefined} aria-describedby={describedBy || undefined}
          onChange={(e) => onChange(e.target.value)} />
        <button type="button" aria-pressed={shown} aria-label={shown ? t("auth.passwordField.hide", "Hide password") : t("auth.passwordField.show", "Show password")} disabled={disabled} onClick={onToggle}
          className="absolute right-1.5 top-1/2 grid h-9 w-9 -translate-y-1/2 place-items-center rounded-full text-ink2 hover:bg-line hover:text-ink disabled:opacity-45">
          {shown ? <EyeOff size={18} strokeWidth={1.75} aria-hidden="true" /> : <Eye size={18} strokeWidth={1.75} aria-hidden="true" />}
        </button>
      </div>
      {strength && <PasswordStrength password={value} id={strength} />}
    </div>
  );
}

/** The forced screen after signing in with a temporary password: change it before anything else opens. */
export function MustChangePasswordView({ onDone, leaving }: { onDone: () => void; leaving: boolean }) {
  const t = useT();
  const [current, setCurrent] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [shown, setShown] = useState(false);
  const [currentError, setCurrentError] = useState("");
  const [error, setError] = useState("");
  const [failure, setFailure] = useState("");
  const [submitting, setSubmitting] = useState(false);
  /** the password change went through; only the flag clearing is left to retry */
  const [changed, setChanged] = useState(false);
  const inFlight = useRef(false);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => { alive.current = false; setCurrent(""); setPassword(""); setConfirm(""); };
  }, []);
  const busy = submitting || leaving;

  const finish = async () => {
    const done = await finishFirstPasswordChange();
    inFlight.current = false;
    if (!alive.current) return;
    setSubmitting(false);
    if (done.ok) onDone();
    else setFailure(done.message);
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (inFlight.current || busy) return;
    setFailure("");
    if (changed) {
      inFlight.current = true;
      setSubmitting(true);
      await finish();
      return;
    }
    if (!current) { setCurrentError(t("auth.mustChange.enterTemporary", "Enter your temporary password.")); document.getElementById("mc-current")?.focus(); return; }
    const problem = newPasswordError(password, confirm) ?? (password === current ? t("auth.mustChange.sameAsTemporary", "Choose a password different from the temporary one.") : null);
    if (problem) {
      setCurrentError("");
      setError(problem);
      document.getElementById("mc-password")?.focus();
      return;
    }
    setCurrentError("");
    setError("");
    inFlight.current = true;
    setSubmitting(true);
    const res = await changeMyPassword(current, password);
    if (!alive.current) { inFlight.current = false; return; }
    if (!res.ok) {
      inFlight.current = false;
      setSubmitting(false);
      if (res.reason === "wrong-current") { setCurrentError(res.message); document.getElementById("mc-current")?.focus(); }
      else setFailure(res.message);
      return;
    }
    setCurrent("");
    setPassword("");
    setConfirm("");
    setChanged(true);
    await finish();
  };

  const retry = changed && !!failure;
  return (
    <section aria-labelledby="auth-title" data-leaving={leaving || undefined} className="w-full">
      <h1 id="auth-title" tabIndex={-1} className="flex items-center gap-3 text-[28px] font-medium leading-tight tracking-[-0.02em] outline-none sm:text-[32px]">
        <KeyRound size={28} strokeWidth={1.75} aria-hidden="true" className="shrink-0 text-accent" />
        {t("auth.mustChange.title", "Set your own password")}
      </h1>
      <p className="mt-2 text-[15px] text-ink2">{t("auth.mustChange.intro", "You signed in with a temporary password. Choose your own password to continue.")}</p>
      <form noValidate onSubmit={submit} className="mt-6" aria-label={t("auth.mustChange.title", "Set your own password")}>
        {!changed && (
          <>
            <PasswordField id="mc-current" label={t("auth.mustChange.temporaryLabel", "Temporary password")} value={current} shown={shown} disabled={busy} autoComplete="current-password"
              onToggle={() => setShown((s) => !s)} invalid={!!currentError} describedBy={currentError ? "mc-current-error" : undefined}
              onChange={(v) => { setCurrent(v); setCurrentError(""); setError(""); }} />
            {currentError && <p id="mc-current-error" role="alert" className="mt-2 text-[13px] text-danger">{currentError}</p>}
            <div className="mt-5">
              <PasswordField id="mc-password" label={t("auth.newPassword.newLabel", "New password")} value={password} shown={shown} disabled={busy} autoComplete="new-password"
                onToggle={() => setShown((s) => !s)} strength="mc-strength" invalid={!!error}
                describedBy={["mc-strength", error && "mc-error"].filter(Boolean).join(" ")}
                onChange={(v) => { setPassword(v); setError(""); }} />
            </div>
            <div className="mt-5">
              <PasswordField id="mc-confirm" label={t("auth.mustChange.confirmLabel", "Confirm new password")} value={confirm} shown={shown} disabled={busy} autoComplete="new-password"
                onToggle={() => setShown((s) => !s)} invalid={!!error} describedBy={error ? "mc-error" : undefined}
                onChange={(v) => { setConfirm(v); setError(""); }} />
            </div>
            {error && <p id="mc-error" role="alert" className="mt-2 text-[13px] text-danger">{error}</p>}
          </>
        )}
        {failure && <p role="alert" className="mt-4 text-[13px] text-danger">{failure}</p>}
        <div className="si-field mt-6">
          <Button variant="primary" size="lg" type="submit" className="w-full" aria-busy={submitting} disabled={leaving}
            iconRight={!submitting ? <ArrowRight size={18} strokeWidth={1.75} aria-hidden="true" /> : undefined}
            icon={submitting ? <LoaderCircle size={18} strokeWidth={1.75} aria-hidden="true" className="animate-spin" /> : undefined}>
            {submitting ? t("common.status.saving", "Saving…") : retry ? t("common.actions.tryAgain", "Try again") : t("auth.mustChange.submit", "Set password")}
          </Button>
        </div>
      </form>
      <p className="mt-6 text-center text-[14px] text-ink2">
        <button type="button" disabled={busy} onClick={() => { void signOut(); }}
          className="font-medium text-accent underline-offset-4 hover:underline disabled:opacity-45">{t("common.actions.signOut", "Sign out")}</button>
      </p>
    </section>
  );
}
