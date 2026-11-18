import { useEffect, useRef, useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ArrowRight, Eye, EyeOff, LoaderCircle } from "lucide-react";
import { Banner, Button, Input } from "@/madp/ui/kit";
import { resendVerification, verifyEmail, type VerifyAnswer } from "@/madp/blocks/signup";
import { signIn } from "@/madp/blocks/session";
import { callFunction } from "@/madp/blocks/fn";
import { afterSignupPath, parseVerifyToken } from "@/madp/domain/signup";
import { AUTH_SWITCH, authHref, loginMessage } from "./auth";
import { useT } from "@/madp/i18n";

const LABEL = "mb-1.5 block text-[12px] font-medium uppercase tracking-wider text-ink2";
const LINK = "font-medium text-accent underline-offset-4 hover:underline";

// A link is single use: React's development double mount must not spend it twice.
const pending = new Map<string, Promise<VerifyAnswer>>();
function verifyOnce(token: string): Promise<VerifyAnswer> {
  let p = pending.get(token);
  if (!p) {
    p = verifyEmail(token);
    pending.set(token, p);
    void p.then((r) => { if (!r.ok && (r.reason === "unavailable" || r.reason === "rate-limited")) pending.delete(token); });
  }
  return p;
}

/** After the first sign-in: the person's first organization (once), then checkout for a paid plan, else Home. */
export async function finishSignup(fallbackPlan: string): Promise<string> {
  try {
    const r = await callFunction<{ workspaceId: string | null; plan: string; created: boolean }>("workspace", "me.completeSignup", {});
    return afterSignupPath(r.data?.plan || fallbackPlan);
  } catch {
    // the organization can still be created from Home; the person is signed in either way
    return afterSignupPath(fallbackPlan);
  }
}

export type VerifyState =
  | { status: "checking" }
  | { status: "verified"; email: string; plan: string; firstName: string }
  | { status: "expired" | "invalid" | "used" | "unavailable" };

function Heading({ title, sub }: { title: string; sub?: string }) {
  return (
    <>
      <h1 id="auth-title" tabIndex={-1} className="text-[28px] font-medium leading-tight tracking-[-0.02em] outline-none sm:text-[32px]">{title}</h1>
      {sub && <p className="mt-2 text-[15px] text-ink2">{sub}</p>}
    </>
  );
}

/** The address is confirmed: the person signs in with the password chosen at sign-up, then lands where the plan says. */
function FirstSignIn({ email, plan, leaving }: { email: string; plan: string; leaving: boolean }) {
  const t = useT();
  const navigate = useNavigate();
  const [password, setPassword] = useState("");
  const [shown, setShown] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (busy || leaving) return;
    if (!password) { setError(t("auth.signIn.passwordRequired", "Enter your password.")); document.getElementById("vf-password")?.focus(); return; }
    setBusy(true);
    setError("");
    const r = await signIn({ email, password });
    setPassword("");
    if (!r.ok) {
      setBusy(false);
      setError(loginMessage(r.reason));
      document.getElementById("vf-password")?.focus();
      return;
    }
    navigate(await finishSignup(plan), { replace: true });
  };
  return (
    <form noValidate onSubmit={submit} className="mt-6" aria-label={t("auth.signIn.submit", "Sign in")}>
      <label htmlFor="vf-email" className={LABEL}>{t("auth.common.workEmail", "Work email")}</label>
      <Input id="vf-email" type="email" autoComplete="username" value={email} readOnly />
      <label htmlFor="vf-password" className={`${LABEL} mt-5`}>{t("auth.common.password", "Password")}</label>
      <div className="relative">
        <Input id="vf-password" type={shown ? "text" : "password"} autoComplete="current-password" className="pr-12" value={password} readOnly={busy}
          aria-invalid={error ? true : undefined} aria-describedby={error ? "vf-error" : undefined}
          onChange={(e) => { setPassword(e.target.value); setError(""); }} />
        <button type="button" aria-pressed={shown} aria-label={shown ? t("auth.passwordField.hide", "Hide password") : t("auth.passwordField.show", "Show password")} disabled={busy}
          onClick={() => setShown((s) => !s)}
          className="absolute right-1.5 top-1/2 grid h-9 w-9 -translate-y-1/2 place-items-center rounded-full text-ink2 hover:bg-line hover:text-ink disabled:opacity-45">
          {shown ? <EyeOff size={18} strokeWidth={1.75} aria-hidden="true" /> : <Eye size={18} strokeWidth={1.75} aria-hidden="true" />}
        </button>
      </div>
      {error && <p id="vf-error" role="alert" className="mt-2 text-[13px] text-danger">{error}</p>}
      <Button variant="primary" size="lg" type="submit" className="mt-6 w-full" aria-busy={busy || undefined} disabled={leaving}
        iconRight={!busy ? <ArrowRight size={18} strokeWidth={1.75} aria-hidden="true" /> : undefined}
        icon={busy ? <LoaderCircle size={18} strokeWidth={1.75} aria-hidden="true" className="animate-spin" /> : undefined}>
        {busy ? t("auth.signIn.submitting", "Signing in…") : t("auth.verifyEmail.signInContinue", "Sign in and continue")}
      </Button>
      <p className="mt-4 text-center text-[14px] text-ink2">
        <Link to={`/forgot-password?email=${encodeURIComponent(email)}`} className={LINK}>{t("auth.verifyEmail.forgot", "Forgot your password?")}</Link>
      </p>
    </form>
  );
}

/** /activate?token=…: confirms the address of a public sign-up (the invitation link /activate?code=… is ActivateView). */
export function VerifyEmailView({ token, leaving, initial }: { token: string; leaving: boolean; initial?: VerifyState }) {
  const t = useT();
  const valid = parseVerifyToken(token) !== null;
  const [state, setState] = useState<VerifyState>(initial ?? (valid ? { status: "checking" } : { status: "invalid" }));
  const [sending, setSending] = useState(false);
  const [note, setNote] = useState<{ ok: boolean; message: string } | null>(null);
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    if (valid && !initial) {
      void verifyOnce(token).then((r) => {
        if (!alive.current) return;
        if (r.ok) setState({ status: "verified", email: r.email, plan: r.plan, firstName: r.firstName });
        else setState({ status: r.reason === "rate-limited" ? "unavailable" : r.reason });
      });
    }
    return () => { alive.current = false; };
    // one verification per link and visit
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, valid]);

  useEffect(() => { if (state.status !== "checking") document.getElementById("auth-title")?.focus(); }, [state.status]);

  const resend = async () => {
    if (sending || leaving) return;
    setSending(true);
    const r = await resendVerification({ token });
    if (!alive.current) return;
    setSending(false);
    setNote(r);
  };

  return (
    <section aria-labelledby="auth-title" data-leaving={leaving || undefined} className="w-full">
      {state.status === "checking" && (
        <>
          <Heading title={t("auth.verifyEmail.confirmingTitle", "Confirming your email")} />
          <p aria-busy="true" role="status" className="mt-6 flex items-center gap-2 text-[14px] text-ink2">
            <LoaderCircle size={18} strokeWidth={1.75} aria-hidden="true" className="animate-spin" /> {t("auth.verifyEmail.checking", "Checking your link…")}
          </p>
        </>
      )}
      {state.status === "verified" && (
        <>
          <Heading title={state.firstName ? t("auth.verifyEmail.welcomeNamed", "Welcome, {name}", { name: state.firstName }) : t("auth.verifyEmail.confirmedTitle", "Your email is confirmed")}
            sub={t("auth.verifyEmail.confirmedText", "Your email is confirmed. Sign in with the password you chose to open your workspace.")} />
          <FirstSignIn email={state.email} plan={state.plan} leaving={leaving} />
        </>
      )}
      {state.status === "used" && (
        <>
          <Heading title={t("auth.verifyEmail.usedTitle", "Your email is already confirmed")} sub={t("auth.verifyEmail.usedText", "Your email address is already confirmed. Sign in to continue.")} />
          <Link to="/sign-in" state={AUTH_SWITCH} className="mt-6 inline-flex h-12 items-center justify-center rounded-full bg-accent px-6 text-[15px] font-medium text-white hover:bg-accent-hover">
            {t("auth.signIn.submit", "Sign in")}
          </Link>
        </>
      )}
      {(state.status === "expired" || state.status === "invalid") && (
        <>
          <Heading title={state.status === "expired" ? t("auth.verifyEmail.expiredTitle", "This link has expired") : t("auth.verifyEmail.invalidTitle", "This link isn't valid")} />
          <div role="alert" className="mt-6">
            <Banner tone="danger" title={state.status === "expired" ? t("auth.verifyEmail.expiredText", "This link has expired. Send yourself a new one.") : t("auth.verifyEmail.invalidText", "This link isn't valid. Use the newest email from MADP Factory, or ask for a new link.")} />
          </div>
          {state.status === "expired" && (
            <Button variant="primary" size="lg" type="button" className="mt-5 w-full" aria-busy={sending || undefined} disabled={leaving || sending} onClick={resend}
              icon={sending ? <LoaderCircle size={18} strokeWidth={1.75} aria-hidden="true" className="animate-spin" /> : undefined}>
              {t("auth.common.sendNewLink", "Send a new link")}
            </Button>
          )}
          {note && <p role={note.ok ? "status" : "alert"} className={"mt-3 text-[13px] " + (note.ok ? "text-ink2" : "text-danger")}>{note.message}</p>}
          <p className="mt-6 text-center text-[14px] text-ink2">
            <Link to="/sign-in" state={AUTH_SWITCH} className={LINK}>{t("auth.common.backToSignIn", "Back to sign in")}</Link>
            {" · "}
            <Link to={authHref("signup")} state={AUTH_SWITCH} className={LINK}>{t("auth.common.createAnAccount", "Create an account")}</Link>
          </p>
        </>
      )}
      {state.status === "unavailable" && (
        <>
          <Heading title={t("auth.verifyEmail.confirmingTitle", "Confirming your email")} />
          <div role="alert" className="mt-6"><Banner tone="neutral" title={t("auth.common.unavailable", "MADP Factory can't be reached right now. Check your connection and try again.")} /></div>
          <Button variant="secondary" className="mt-4" onClick={() => { setState({ status: "checking" }); void verifyOnce(token).then((r) => {
            if (!alive.current) return;
            if (r.ok) setState({ status: "verified", email: r.email, plan: r.plan, firstName: r.firstName });
            else setState({ status: r.reason === "rate-limited" ? "unavailable" : r.reason });
          }); }}>{t("common.actions.tryAgain", "Try again")}</Button>
        </>
      )}
    </section>
  );
}
