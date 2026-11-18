import { useEffect, useState, type CSSProperties, type FormEvent, type KeyboardEvent } from "react";
import { ArrowRight, Eye, EyeOff, LoaderCircle } from "lucide-react";
import { Button, Input } from "@/madp/ui/kit";
import { signIn } from "@/madp/blocks/session";
import { resendVerification } from "@/madp/blocks/signup";
import { emailError, forgetRememberedEmail, loginMessage } from "./auth";
import { useT } from "@/madp/i18n";
import { useSearchParams } from "react-router-dom";
import { hostedLoginEnabled } from "@/madp/blocks/config";
import { startHostedLogin } from "@/madp/blocks/oidc";

const stagger = (n: number) => ({ "--si-i": n } as CSSProperties);

type Errors = { email?: string; password?: string };

const LABEL = "mb-1.5 block text-[12px] font-medium uppercase tracking-wider text-ink2";

/** The sign-in form only: inline checks, then SELISE Blocks IAM decides (it also enforces the lockout). */
type SignInFormProps = {
  initialEmail: string; onSignedIn: () => void; onForgot: (email: string) => void; disabled: boolean; onPending: (on: boolean) => void;
};

export function SignInForm(props: SignInFormProps) {
  return hostedLoginEnabled() ? <HostedSignInForm {...props} /> : <PasswordSignInForm {...props} />;
}

function HostedSignInForm({ disabled, onPending }: SignInFormProps) {
  const t = useT();
  const [params] = useSearchParams();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function submit(e: FormEvent) {
    e.preventDefault();
    if (disabled || busy) return;
    setBusy(true);
    setError(null);
    onPending(true);
    try { await startHostedLogin(params.get("next")); }
    catch {
      setError(t("auth.signIn.hostedFailed", "We couldn't open secure sign-in. Please try again."));
      setBusy(false);
      onPending(false);
    }
  }
  return <form onSubmit={submit}>
    <p className="si-field text-[15px] leading-relaxed text-ink2" style={stagger(0)}>
      {t("auth.signIn.hostedIntro", "Continue to secure sign-in to enter your email and password. Your workspace access stays the same.")}
    </p>
    {error && <p role="alert" className="mt-4 text-[13px] text-danger">{error}</p>}
    <div className="si-field mt-6" style={stagger(3)}>
      <Button variant="primary" size="lg" type="submit" className="w-full" aria-busy={busy} disabled={disabled || busy}
        iconRight={!busy ? <ArrowRight size={18} strokeWidth={1.75} aria-hidden="true" /> : undefined}
        icon={busy ? <LoaderCircle size={18} strokeWidth={1.75} aria-hidden="true" className="animate-spin" /> : undefined}>
        {busy ? t("auth.signIn.submitting", "Signing in…") : t("auth.signIn.submit", "Sign in")}
      </Button>
    </div>
  </form>;
}

function PasswordSignInForm({ initialEmail, onSignedIn, onForgot, disabled, onPending }: SignInFormProps) {
  const t = useT();
  const [email, setEmail] = useState(initialEmail);
  const [password, setPassword] = useState("");
  const [shown, setShown] = useState(false);
  const [caps, setCaps] = useState(false);
  const [errors, setErrors] = useState<Errors>({});
  const [summary, setSummary] = useState({ key: 0, text: "" });
  const [formError, setFormError] = useState<string | null>(null);
  const [unconfirmed, setUnconfirmed] = useState<string | null>(null);
  const [resend, setResend] = useState<{ busy: boolean; note: { ok: boolean; message: string } | null }>({ busy: false, note: null });
  const [submitting, setSubmitting] = useState(false);

  const busy = submitting || disabled;

  useEffect(() => { forgetRememberedEmail(); }, []);

  const focusField = (id: string) => document.getElementById(id)?.focus();

  const trackCaps = (e: KeyboardEvent<HTMLInputElement>) => setCaps(e.getModifierState("CapsLock"));

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (submitting || disabled) return;
    const found: Errors = {};
    const bad = emailError(email);
    if (bad) found.email = bad;
    if (!password) found.password = t("auth.signIn.passwordRequired", "Enter your password.");
    else if (password.length > 64) found.password = t("auth.signIn.passwordTooLong", "Passwords are at most {max} characters.", { max: 64 });
    setFormError(null);
    setErrors(found);
    if (found.email || found.password) {
      setSummary((s) => ({ key: s.key + 1, text: t("auth.signIn.failedSummary", "Sign-in failed. {details}", { details: [found.email, found.password].filter(Boolean).join(" ") }) }));
      focusField(found.email ? "si-email" : "si-password");
      return;
    }
    setSubmitting(true);
    onPending(true);
    const r = await signIn({ email: email.trim(), password });
    setSubmitting(false);
    setPassword("");
    if (r.ok) { onSignedIn(); return; }
    onPending(false);
    const text = loginMessage(r.reason);
    setUnconfirmed(r.reason === "not-activated" ? email.trim().toLowerCase() : null);
    setResend({ busy: false, note: null });
    setFormError(text);
    setSummary((s) => ({ key: s.key + 1, text }));
    focusField("si-password");
  };

  const emailDesc = errors.email ? "si-email-error" : undefined;
  const passDesc = [errors.password && "si-password-error", caps && "si-caps"].filter(Boolean).join(" ") || undefined;

  return (
    <div>
      <div key={summary.key} role="alert" className="sr-only">{summary.text}</div>

      <form noValidate onSubmit={submit}>
        <div className="si-field" style={stagger(0)}>
        <label htmlFor="si-email" className={LABEL}>{t("auth.common.workEmail", "Work email")}</label>
        <Input id="si-email" type="email" autoComplete="username" inputMode="email" placeholder={t("auth.common.emailPlaceholder", "name@company.com")}
          value={email} readOnly={busy} aria-invalid={errors.email ? true : undefined} aria-describedby={emailDesc}
          onChange={(e) => { setEmail(e.target.value); setUnconfirmed(null); if (errors.email) setErrors((x) => ({ ...x, email: undefined })); }} />
        {errors.email && <p id="si-email-error" className="mt-2 text-[13px] text-danger">{errors.email}</p>}
        </div>

        <div className="si-field mt-5" style={stagger(1)}>
        <label htmlFor="si-password" className={LABEL}>{t("auth.common.password", "Password")}</label>
        <div className="relative">
          <Input id="si-password" type={shown ? "text" : "password"} autoComplete="current-password" className="pr-12"
            value={password} readOnly={busy} aria-invalid={errors.password ? true : undefined} aria-describedby={passDesc}
            onChange={(e) => { setPassword(e.target.value); if (errors.password) setErrors((x) => ({ ...x, password: undefined })); }}
            onKeyDown={trackCaps} onKeyUp={trackCaps} onBlur={() => setCaps(false)} />
          <button type="button" aria-pressed={shown} aria-label={shown ? t("auth.passwordField.hide", "Hide password") : t("auth.passwordField.show", "Show password")} disabled={busy}
            onClick={() => setShown((s) => !s)}
            className="absolute right-1.5 top-1/2 grid h-9 w-9 -translate-y-1/2 place-items-center rounded-full text-ink2 hover:bg-line hover:text-ink disabled:opacity-45">
            {shown ? <EyeOff size={18} strokeWidth={1.75} aria-hidden="true" /> : <Eye size={18} strokeWidth={1.75} aria-hidden="true" />}
          </button>
        </div>
        {caps && <p id="si-caps" className="mt-2 text-[13px] text-warning" aria-live="polite">{t("auth.signIn.capsLock", "Caps Lock is on.")}</p>}
        {errors.password && <p id="si-password-error" className="mt-2 text-[13px] text-danger">{errors.password}</p>}
        </div>

        <div className="si-field mt-4 flex flex-wrap items-center justify-end gap-3" style={stagger(2)}>
          <button type="button" id="si-forgot" disabled={busy} onClick={() => onForgot(email.trim())}
            className="text-[14px] font-medium text-accent underline-offset-4 hover:underline disabled:opacity-45">{t("auth.signIn.forgot", "Forgot password?")}</button>
        </div>

        {formError && !unconfirmed && <p className="mt-4 text-[13px] text-danger">{formError}</p>}
        {unconfirmed && (
          <div className="mt-4 rounded-block bg-surface2 px-4 py-3">
            <p className="text-[14px] font-medium text-ink">{t("auth.signIn.verifyTitle", "Verify your email")}</p>
            <p className="mt-1 text-[13px] text-ink2">{loginMessage("not-activated")}</p>
            <button type="button" disabled={resend.busy}
              onClick={async () => {
                setResend({ busy: true, note: null });
                const note = await resendVerification({ email: unconfirmed });
                setResend({ busy: false, note });
              }}
              className="mt-2 text-[14px] font-medium text-accent underline-offset-4 hover:underline disabled:opacity-45">
              {resend.busy ? t("auth.common.sending", "Sending…") : t("auth.common.sendNewLink", "Send a new link")}
            </button>
            {resend.note && <p role={resend.note.ok ? "status" : "alert"} className={"mt-1 text-[13px] " + (resend.note.ok ? "text-ink2" : "text-danger")}>{resend.note.message}</p>}
          </div>
        )}

        <div className="si-field mt-6" style={stagger(3)}>
        <Button variant="primary" size="lg" type="submit" className="w-full" aria-busy={submitting}
          disabled={disabled}
          iconRight={!submitting ? <ArrowRight size={18} strokeWidth={1.75} aria-hidden="true" /> : undefined}
          icon={submitting ? <LoaderCircle size={18} strokeWidth={1.75} aria-hidden="true" className="animate-spin" /> : undefined}>
          {submitting ? t("auth.signIn.submitting", "Signing in…") : t("auth.signIn.submit", "Sign in")}
        </Button>
        </div>
      </form>
    </div>
  );
}
