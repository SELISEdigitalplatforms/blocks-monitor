import { useEffect, useRef, useState, type FormEvent } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { ArrowRight, Eye, EyeOff, LoaderCircle } from "lucide-react";
import { Banner, Button, Input } from "@/ui/kit";
import {
  PASSWORD_MAX,
  activateAccount,
  checkActivationCode,
  newPasswordError,
  resendActivationLink,
  resetPassword,
  validCode,
} from "@/blocks/account";
import { setNotice } from "@/blocks/session";
import { AUTH_SWITCH } from "./auth";
import { PasswordStrength } from "./PasswordStrength";
import { useT } from "@/i18n";

const LABEL = "mb-1.5 block text-[12px] font-medium uppercase tracking-wider text-ink2";
const LINK = "font-medium text-accent underline-offset-4 hover:underline";

type Result = { ok: true } | { ok: false; reason: "invalid-code" | "password-rejected" | "unavailable"; message: string };

function PasswordField({ id, label, value, onChange, shown, onToggle, disabled, describedBy, invalid, strength }: {
  id: string; label: string; value: string; onChange: (v: string) => void; shown: boolean; onToggle: () => void;
  disabled: boolean; describedBy?: string; invalid?: boolean; strength?: string;
}) {
  const t = useT();
  return (
    <div className="si-field">
      <label htmlFor={id} className={LABEL}>{label}</label>
      <div className="relative">
        <Input id={id} type={shown ? "text" : "password"} autoComplete="new-password" className="pr-12" maxLength={PASSWORD_MAX}
          value={value} readOnly={disabled} aria-invalid={invalid ? true : undefined} aria-describedby={describedBy}
          onChange={(e) => onChange(e.target.value)} />
        <button type="button" aria-pressed={shown} aria-label={shown ? t("auth.passwordField.hide", "Hide password") : t("auth.passwordField.show", "Show password")} disabled={disabled}
          onClick={onToggle}
          className="absolute right-1.5 top-1/2 grid h-9 w-9 -translate-y-1/2 place-items-center rounded-full text-ink2 hover:bg-line hover:text-ink disabled:opacity-45">
          {shown ? <EyeOff size={18} strokeWidth={1.75} aria-hidden="true" /> : <Eye size={18} strokeWidth={1.75} aria-hidden="true" />}
        </button>
      </div>
      {strength && <PasswordStrength password={value} id={strength} />}
    </div>
  );
}

/** The shared new-password form: New password + Confirm, checked client-side; IAM is the authority. */
function PasswordForm({ leaving, label, submitLabel, busyLabel, onSubmit, withName }: {
  leaving: boolean; label: string; submitLabel: string; busyLabel: string; withName?: boolean;
  onSubmit: (password: string, name?: { firstName: string; lastName: string }) => Promise<Result>;
}) {
  const t = useT();
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [shown, setShown] = useState(false);
  const [error, setError] = useState("");
  const [failure, setFailure] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const inFlight = useRef(false);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => { alive.current = false; };
  }, []);
  const busy = submitting || leaving;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (inFlight.current || busy) return;
    const problem = withName && (!firstName.trim() || !lastName.trim())
      ? t("auth.newPassword.nameRequired", "Enter your first and last name.")
      : newPasswordError(password, confirm);
    setFailure("");
    if (problem) {
      setError(problem);
      document.getElementById("np-password")?.focus();
      return;
    }
    setError("");
    inFlight.current = true;
    setSubmitting(true);
    const pw = password;
    const res = await onSubmit(pw, withName ? { firstName: firstName.trim(), lastName: lastName.trim() } : undefined);
    inFlight.current = false;
    if (!alive.current) return;
    setPassword("");
    setConfirm("");
    setSubmitting(false);
    if (!res.ok) setFailure(res.message);
  };

  return (
    <form noValidate onSubmit={submit} className="mt-6" aria-label={label}>
      {withName && (
        <div className="mb-5 grid gap-5 sm:grid-cols-2">
          <div>
            <label htmlFor="np-first" className={LABEL}>{t("auth.newPassword.firstName", "First name")}</label>
            <Input id="np-first" autoComplete="given-name" maxLength={60} value={firstName} readOnly={busy}
              onChange={(e) => { setFirstName(e.target.value); setError(""); }} />
          </div>
          <div>
            <label htmlFor="np-last" className={LABEL}>{t("auth.newPassword.lastName", "Last name")}</label>
            <Input id="np-last" autoComplete="family-name" maxLength={60} value={lastName} readOnly={busy}
              onChange={(e) => { setLastName(e.target.value); setError(""); }} />
          </div>
        </div>
      )}
      <PasswordField id="np-password" label={t("auth.newPassword.newLabel", "New password")} value={password} shown={shown} disabled={busy}
        onToggle={() => setShown((s) => !s)} strength="np-strength" invalid={!!error}
        describedBy={["np-strength", error && "np-error"].filter(Boolean).join(" ")}
        onChange={(v) => { setPassword(v); setError(""); }} />
      <div className="mt-5">
        <PasswordField id="np-confirm" label={t("auth.newPassword.confirmLabel", "Confirm password")} value={confirm} shown={shown} disabled={busy}
          onToggle={() => setShown((s) => !s)} invalid={!!error} describedBy={error ? "np-error" : undefined}
          onChange={(v) => { setConfirm(v); setError(""); }} />
      </div>
      {error && <p id="np-error" role="alert" className="mt-2 text-[13px] text-danger">{error}</p>}
      {failure && <p role="alert" className="mt-4 text-[13px] text-danger">{failure}</p>}
      <div className="si-field mt-6">
        <Button variant="primary" size="lg" type="submit" className="w-full" aria-busy={submitting} disabled={leaving}
          iconRight={!submitting ? <ArrowRight size={18} strokeWidth={1.75} aria-hidden="true" /> : undefined}
          icon={submitting ? <LoaderCircle size={18} strokeWidth={1.75} aria-hidden="true" className="animate-spin" /> : undefined}>
          {submitting ? busyLabel : submitLabel}
        </Button>
      </div>
    </form>
  );
}

function Heading({ title, sub }: { title: string; sub: string }) {
  return (
    <>
      <h1 id="auth-title" tabIndex={-1} className="text-[28px] font-medium leading-tight tracking-[-0.02em] outline-none sm:text-[32px]">{title}</h1>
      <p className="mt-2 text-[15px] text-ink2">{sub}</p>
    </>
  );
}

function BackLink({ to, children, leaving, onClick }: { to: string; children: string; leaving: boolean; onClick?: () => void }) {
  return (
    <p className="mt-6 text-center text-[14px] text-ink2">
      <Link to={to} state={AUTH_SWITCH} aria-disabled={leaving || undefined} tabIndex={leaving ? -1 : undefined} className={LINK}
        onClick={onClick ? (e) => { e.preventDefault(); onClick(); } : undefined}>{children}</Link>
    </p>
  );
}

/** Expired link: offer a new one, sent by user id (from the validate answer). */
function ExpiredActivation({ userId, leaving }: { userId: string; leaving: boolean }) {
  const t = useT();
  const [sending, setSending] = useState(false);
  const [note, setNote] = useState<{ ok: boolean; message: string } | null>(null);
  const send = async () => {
    if (sending || leaving || !userId) return;
    setSending(true);
    const r = await resendActivationLink(userId);
    setSending(false);
    setNote(r);
  };
  return (
    <div className="mt-6">
      <div role="alert"><Banner tone="danger" title={t("auth.activate.expired", "This activation link has expired.")} /></div>
      {userId && (
        <Button variant="primary" size="lg" type="button" className="mt-5 w-full" aria-busy={sending} disabled={leaving || sending}
          onClick={send} icon={sending ? <LoaderCircle size={18} strokeWidth={1.75} aria-hidden="true" className="animate-spin" /> : undefined}>
          {t("auth.activate.resend", "Send a new activation link")}
        </Button>
      )}
      {note && <p role={note.ok ? "status" : "alert"} className={"mt-3 text-[13px] " + (note.ok ? "text-ink2" : "text-danger")}>{note.message}</p>}
      <BackLink to="/sign-in" leaving={leaving}>{t("auth.common.backToSignIn", "Back to sign in")}</BackLink>
    </div>
  );
}

/** /activate?code=…: check the link first, then set the password. */
export function ActivateView({ leaving, code: given }: { leaving: boolean; code?: string }) {
  const t = useT();
  const linkInvalid = () => t("auth.activate.linkInvalid", "This activation link isn't valid. Use the newest invitation email.");
  const [params] = useSearchParams();
  const code = validCode(given ?? params.get("code"));
  const navigate = useNavigate();
  const [state, setState] = useState<
    | { status: "checking" | "already-active" }
    | { status: "valid"; firstName: string; lastName: string }
    | { status: "expired"; userId: string }
    | { status: "invalid"; message: string }
  >(() => (code ? { status: "checking" } : { status: "invalid", message: linkInvalid() }));

  useEffect(() => {
    if (!code) return;
    let live = true;
    setState({ status: "checking" });
    void checkActivationCode(code).then((r) => {
      if (!live) return;
      if (r.state === "valid") setState({ status: "valid", firstName: r.firstName, lastName: r.lastName });
      else if (r.state === "expired") setState({ status: "expired", userId: r.userId });
      else if (r.state === "already-active") setState({ status: "already-active" });
      else setState({ status: "invalid", message: r.state === "unavailable" ? r.message : linkInvalid() });
    });
    return () => { live = false; };
  }, [code]);

  const submit = async (password: string, name?: { firstName: string; lastName: string }): Promise<Result> => {
    const r = (await activateAccount(code ?? "", password, name)) as Result;
    if (r.ok) {
      setNotice(t("auth.activate.done", "Your account is active. Sign in with your new password."));
      navigate("/sign-in", { replace: true });
    }
    return r;
  };

  return (
    <section aria-labelledby="auth-title" data-leaving={leaving || undefined} className="w-full">
      <Heading title={t("auth.activate.title", "Activate your account")} sub={t("auth.activate.intro", "Set a password to finish activating your MADP Factory account.")} />
      {state.status === "checking" && (
        <p aria-busy="true" role="status" className="mt-6 flex items-center gap-2 text-[14px] text-ink2">
          <LoaderCircle size={18} strokeWidth={1.75} aria-hidden="true" className="animate-spin" />
          {t("auth.activate.checking", "Checking your activation link…")}
        </p>
      )}
      {state.status === "invalid" && (
        <div className="mt-6">
          <div role="alert"><Banner tone="danger" title={state.message} /></div>
          <BackLink to="/sign-in" leaving={leaving}>{t("auth.common.backToSignIn", "Back to sign in")}</BackLink>
        </div>
      )}
      {state.status === "expired" && <ExpiredActivation userId={state.userId} leaving={leaving} />}
      {state.status === "already-active" && (
        <div className="mt-6">
          <div role="status"><Banner tone="success" title={t("auth.activate.alreadyActive", "Your account is already active.")} /></div>
          <BackLink to="/sign-in" leaving={leaving}>{t("auth.signIn.submit", "Sign in")}</BackLink>
        </div>
      )}
      {state.status === "valid" && (
        <>
          <PasswordForm leaving={leaving} label={t("auth.activate.formLabel", "Set your password")} submitLabel={t("auth.activate.submit", "Activate account")} busyLabel={t("auth.activate.submitting", "Activating…")} onSubmit={submit}
            withName={!state.firstName || !state.lastName} />
          <BackLink to="/sign-in" leaving={leaving}>{t("auth.common.backToSignIn", "Back to sign in")}</BackLink>
        </>
      )}
    </section>
  );
}

/** /resetpassword?code=…: choose a new password. Shown inside the sign-in panel (a pasted link), `onDone` returns that
 *  panel to the sign-in form: the URL alone does not change what an already-mounted panel shows. */
export function NewPasswordView({ leaving, code: given, onDone }: { leaving: boolean; code?: string; onDone?: () => void }) {
  const t = useT();
  const [params] = useSearchParams();
  // /resetpassword?code=… (IAM's link) and /reset-password?token=… name the same one-time reset code
  const code = validCode(given ?? params.get("code") ?? params.get("token"));
  const navigate = useNavigate();
  const [expired, setExpired] = useState(!code);

  const submit = async (password: string): Promise<Result> => {
    const r = (await resetPassword(code ?? "", password)) as Result;
    if (r.ok) {
      setNotice(t("auth.newPassword.done", "Password changed. Sign in with your new password."));
      navigate("/sign-in", { replace: true });
      onDone?.();
    } else if (r.reason === "invalid-code") setExpired(true);
    return r;
  };

  return (
    <section aria-labelledby="auth-title" data-leaving={leaving || undefined} className="w-full">
      <Heading title={t("auth.newPassword.title", "Set a new password")} sub={t("auth.newPassword.intro", "Choose a new password for your account. You will be signed out on your other devices.")} />
      {expired ? (
        <div className="mt-6">
          <div role="alert"><Banner tone="danger" title={t("auth.newPassword.linkInvalid", "This reset link has expired or was already used. Request a new one.")} /></div>
          <BackLink to="/forgot-password" leaving={leaving}>{t("auth.newPassword.requestNew", "Request a new link")}</BackLink>
        </div>
      ) : (
        <>
          <PasswordForm leaving={leaving} label={t("auth.newPassword.title", "Set a new password")} submitLabel={t("auth.newPassword.submit", "Set new password")} busyLabel={t("common.status.saving", "Saving…")} onSubmit={submit} />
          <BackLink to="/sign-in" leaving={leaving} onClick={onDone}>{t("auth.common.backToSignIn", "Back to sign in")}</BackLink>
        </>
      )}
    </section>
  );
}
