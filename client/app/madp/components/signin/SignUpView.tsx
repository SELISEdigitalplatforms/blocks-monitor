import { useEffect, useRef, useState, type FormEvent } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { ArrowRight, Eye, EyeOff, LoaderCircle, MailCheck } from "lucide-react";
import { Banner, Button, Input } from "@/madp/ui/kit";
import { loadSignupForm, resendVerification, submitSignup, type SignupForm } from "@/madp/blocks/signup";
import { FORM_MIN_MS, SIGNUP_PASSWORD_MAX, checkPassword, cleanPlanKey, defaultOrganizationName } from "@/madp/domain/signup";
import { AUTH_SWITCH, authHref, emailError } from "./auth";
import { PasswordStrength } from "./PasswordStrength";
import { t, useT } from "@/madp/i18n";
import { rich } from "@/madp/components/landing/parts";

const LABEL = "mb-1.5 block text-[12px] font-medium uppercase tracking-wider text-ink2";
const LINK = "font-medium text-accent underline-offset-4 hover:underline";

/** Links to the legal documents, set per deployment (VITE_TERMS_URL / VITE_PRIVACY_URL). */
const TERMS_URL = (import.meta.env.VITE_TERMS_URL as string | undefined) || "";
const PRIVACY_URL = (import.meta.env.VITE_PRIVACY_URL as string | undefined) || "";

/** The plans the pricing page can pass; their names are product names and stay as they are. */
const PLAN_NAMES: Record<string, string> = { free: "Free", classic: "Classic", speed: "Speed", enterprise: "Enterprise" };
const planName = (key: string) => PLAN_NAMES[key] ?? key.charAt(0).toUpperCase() + key.slice(1);

/** The sign-up could not be sent: what to tell the person, in the current language (the English is SIGNUP_MESSAGES in
 *  @/domain/signup); a password the server's policy refused keeps the server's own sentence. */
function failureText(r: { reason: "closed" | "form-expired" | "rate-limited" | "invalid" | "unavailable"; field?: "email" | "password" | "name" | "terms"; message: string }): string {
  if (r.reason === "rate-limited") return t("auth.signUp.rateLimited", "Too many attempts. Please wait a few minutes and try again.");
  if (r.reason === "form-expired") return t("auth.signUp.formExpired", "This form was open for a long time. Please send it again.");
  if (r.reason === "unavailable") return t("auth.common.unavailable", "MADP Factory can't be reached right now. Check your connection and try again.");
  if (r.field === "email") return t("auth.email.invalid", "Enter a valid work email.");
  if (r.field === "name") return t("auth.signUp.nameRequired", "Enter your name.");
  if (r.field === "terms") return t("auth.signUp.termsRequired", "Accept the terms and the privacy policy to continue.");
  return r.message;
}

type Errors = Partial<Record<"name" | "email" | "password" | "terms", string>>;

function Heading({ title, sub }: { title: string; sub?: string }) {
  return (
    <>
      <h1 id="auth-title" tabIndex={-1} className="text-[28px] font-medium leading-tight tracking-[-0.02em] outline-none sm:text-[32px]">{title}</h1>
      {sub && <p className="mt-2 text-[15px] text-ink2">{sub}</p>}
    </>
  );
}

/** Sign-up is closed (Platform settings: invite-only): people are invited, as before. */
function InviteOnly({ leaving }: { leaving: boolean }) {
  const t = useT();
  const [params] = useSearchParams();
  return (
    <>
      <Heading title={t("auth.signUp.inviteOnlyTitle", "MADP Factory is invite-only.")} sub={t("auth.signUp.inviteOnlyText", "Ask your administrator for an invitation.")} />
      <p className="mt-3 text-[15px] text-ink2">{t("auth.signUp.alreadyInvited", "Already invited? Open the activation link in your invitation email to set your password.")}</p>
      <Link to={authHref("signin", { next: params.get("next") })} state={AUTH_SWITCH} aria-disabled={leaving || undefined}
        className="mt-6 inline-flex h-12 items-center justify-center rounded-full bg-accent px-6 text-[15px] font-medium text-white hover:bg-accent-hover">
        {t("auth.signIn.submit", "Sign in")}
      </Link>
    </>
  );
}

/** After the form: the link is on its way (or the mail service refused it, said plainly). */
function CheckEmail({ email, mail }: { email: string; mail: "sent" | "not-sent" }) {
  const t = useT();
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ ok: boolean; message: string } | null>(null);
  const resend = async () => {
    if (busy) return;
    setBusy(true);
    setNote(await resendVerification({ email }));
    setBusy(false);
  };
  return (
    <>
      <Heading title={mail === "sent" ? t("auth.checkEmail.title", "Check your email") : t("auth.checkEmail.waitingTitle", "Your account is waiting")} />
      <div role="status" className="mt-5 flex flex-col gap-4">
        {mail === "sent" ? (
          <>
            <MailCheck size={28} aria-hidden className="text-success" />
            <p className="text-[15px] text-ink2">
              {rich(t("auth.checkEmail.sent", "We sent a link to {email} to confirm your address. Open it within 24 hours to finish creating your account."),
                { email: <span className="font-medium text-ink">{email}</span> })}
            </p>
          </>
        ) : (
          <Banner tone="warning" title={t("auth.checkEmail.mailUnavailable", "We couldn't send the email right now. Please try again in a few minutes.")} text={t("auth.checkEmail.saved", "Your details are saved. Send the link again in a few minutes.")} />
        )}
      </div>
      <p className="mt-6 text-[14px] text-ink2">{t("auth.checkEmail.notReceived", "Didn't get it? Check your spam folder, or send a new link.")}</p>
      <Button variant="secondary" size="lg" type="button" className="mt-3 w-full" aria-busy={busy || undefined} disabled={busy} onClick={resend}
        icon={busy ? <LoaderCircle size={18} strokeWidth={1.75} aria-hidden="true" className="animate-spin" /> : undefined}>
        {t("auth.common.sendNewLink", "Send a new link")}
      </Button>
      {note && <p role={note.ok ? "status" : "alert"} className={"mt-3 text-[13px] " + (note.ok ? "text-ink2" : "text-danger")}>{note.message}</p>}
      <p className="mt-6 text-center text-[14px] text-ink2">
        {t("auth.checkEmail.alreadyConfirmed", "Already confirmed?")} <Link to={authHref("signin", { email })} state={AUTH_SWITCH} className={LINK}>{t("auth.signIn.submit", "Sign in")}</Link>
      </p>
    </>
  );
}

/** The public sign-up: name, work email, password (policy shown live), organization, terms. */
export function SignUpView({ leaving, initialForm = null, initialDone = null }: {
  leaving: boolean;
  /** a form state already known (otherwise it is loaded from the server) */
  initialForm?: SignupForm | null;
  /** the answer state already known */
  initialDone?: { email: string; mail: "sent" | "not-sent" } | null;
}) {
  const t = useT();
  const [params] = useSearchParams();
  const plan = cleanPlanKey(params.get("plan"));
  const [form, setForm] = useState<SignupForm | null>(initialForm);
  const [name, setName] = useState("");
  const [email, setEmail] = useState(() => {
    const q = params.get("email") ?? "";
    return q && !emailError(q) ? q : "";
  });
  const [password, setPassword] = useState("");
  const [organization, setOrganization] = useState("");
  const [website, setWebsite] = useState("");
  const [terms, setTerms] = useState(false);
  const [shown, setShown] = useState(false);
  const [errors, setErrors] = useState<Errors>({});
  const [failure, setFailure] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<{ email: string; mail: "sent" | "not-sent" } | null>(initialDone);
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    if (!initialForm) void loadSignupForm().then((f) => { if (alive.current) setForm(f); });
    return () => { alive.current = false; };
    // the form is loaded once per visit
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => { if (done) document.getElementById("auth-title")?.focus(); }, [done]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (busy || leaving || form?.state !== "open") return;
    const found: Errors = {};
    if (!name.trim()) found.name = t("auth.signUp.nameRequired", "Enter your name.");
    const badEmail = emailError(email);
    if (badEmail) found.email = badEmail;
    const policy = checkPassword(password, email);
    if (!policy.ok) found.password = policy.message ?? t("auth.signUp.passwordRejected", "Choose another password.");
    if (!terms) found.terms = t("auth.signUp.termsRequired", "Accept the terms and the privacy policy to continue.");
    setErrors(found);
    setFailure("");
    const first = (["name", "email", "password", "terms"] as const).find((k) => found[k]);
    if (first) { document.getElementById(`su-${first}`)?.focus(); return; }

    setBusy(true);
    // the server ignores forms sent faster than a person fills them: wait out the rest of that time instead
    const wait = form.issuedAt + FORM_MIN_MS + 250 - Date.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    const fields = { name, email, password, organization, plan, website, acceptedTerms: terms };
    let r = await submitSignup(form.ticket, fields);
    if (!r.ok && r.reason === "form-expired") {
      const fresh = await loadSignupForm();
      if (fresh.state === "open") {
        setForm(fresh);
        await new Promise((res) => setTimeout(res, FORM_MIN_MS + 250));
        r = await submitSignup(fresh.ticket, fields);
      }
    }
    if (!alive.current) return;
    setBusy(false);
    if (r.ok) {
      setPassword("");
      setDone({ email: email.trim().toLowerCase(), mail: r.mail });
      return;
    }
    if (r.reason === "closed") { setForm({ state: "invite-only" }); return; }
    if (r.field) {
      setErrors({ [r.field]: failureText(r) });
      document.getElementById(`su-${r.field}`)?.focus();
      return;
    }
    setFailure(failureText(r));
  };

  return (
    <section aria-labelledby="auth-title" data-leaving={leaving || undefined} className="w-full">
      {done ? <CheckEmail email={done.email} mail={done.mail} />
        : form === null ? (
          <>
            <Heading title={t("auth.signUp.title", "Create your account")} />
            <p aria-busy="true" role="status" className="mt-6 flex items-center gap-2 text-[14px] text-ink2">
              <LoaderCircle size={18} strokeWidth={1.75} aria-hidden="true" className="animate-spin" /> {t("auth.signUp.loading", "One moment…")}
            </p>
          </>
        )
        : form.state === "invite-only" ? <InviteOnly leaving={leaving} />
        : form.state === "unavailable" ? (
          <>
            <Heading title={t("auth.signUp.title", "Create your account")} />
            <div role="alert" className="mt-6"><Banner tone="neutral" title={t("auth.common.unavailable", "MADP Factory can't be reached right now. Check your connection and try again.")} /></div>
            <Button variant="secondary" className="mt-4" onClick={() => { setForm(null); void loadSignupForm().then(setForm); }}>{t("common.actions.tryAgain", "Try again")}</Button>
          </>
        ) : (
          <>
            <Heading title={t("auth.signUp.title", "Create your account")} sub={plan && PLAN_NAMES[plan] !== undefined ? t("auth.signUp.planPicked", "You picked the {plan} plan. You can change it later.", { plan: planName(plan) }) : t("auth.signUp.freePlan", "Start on the Free plan with sign-up credit. No card needed.")} />
            <form noValidate onSubmit={submit} className="mt-6" aria-label={t("auth.signUp.title", "Create your account")}>
              <div>
                <label htmlFor="su-name" className={LABEL}>{t("auth.signUp.nameLabel", "Your name")}</label>
                <Input id="su-name" autoComplete="name" maxLength={120} value={name} readOnly={busy}
                  aria-invalid={errors.name ? true : undefined} aria-describedby={errors.name ? "su-name-error" : undefined}
                  onChange={(e) => { setName(e.target.value); setErrors((x) => ({ ...x, name: undefined })); }} />
                {errors.name && <p id="su-name-error" className="mt-2 text-[13px] text-danger">{errors.name}</p>}
              </div>
              <div className="mt-5">
                <label htmlFor="su-email" className={LABEL}>{t("auth.common.workEmail", "Work email")}</label>
                <Input id="su-email" type="email" autoComplete="email" inputMode="email" placeholder={t("auth.common.emailPlaceholder", "name@company.com")} maxLength={254} value={email} readOnly={busy}
                  aria-invalid={errors.email ? true : undefined} aria-describedby={errors.email ? "su-email-error" : undefined}
                  onChange={(e) => { setEmail(e.target.value); setErrors((x) => ({ ...x, email: undefined })); }} />
                {errors.email && <p id="su-email-error" className="mt-2 text-[13px] text-danger">{errors.email}</p>}
              </div>
              <div className="mt-5">
                <label htmlFor="su-password" className={LABEL}>{t("auth.common.password", "Password")}</label>
                <div className="relative">
                  <Input id="su-password" type={shown ? "text" : "password"} autoComplete="new-password" className="pr-12" maxLength={SIGNUP_PASSWORD_MAX}
                    value={password} readOnly={busy} aria-invalid={errors.password ? true : undefined}
                    aria-describedby={["su-policy", errors.password && "su-password-error"].filter(Boolean).join(" ")}
                    onChange={(e) => { setPassword(e.target.value); setErrors((x) => ({ ...x, password: undefined })); }} />
                  <button type="button" aria-pressed={shown} aria-label={shown ? t("auth.passwordField.hide", "Hide password") : t("auth.passwordField.show", "Show password")} disabled={busy}
                    onClick={() => setShown((s) => !s)}
                    className="absolute right-1.5 top-1/2 grid h-9 w-9 -translate-y-1/2 place-items-center rounded-full text-ink2 hover:bg-line hover:text-ink disabled:opacity-45">
                    {shown ? <EyeOff size={18} strokeWidth={1.75} aria-hidden="true" /> : <Eye size={18} strokeWidth={1.75} aria-hidden="true" />}
                  </button>
                </div>
                <PasswordStrength password={password} email={email} id="su-policy" />
                {errors.password && <p id="su-password-error" className="mt-2 text-[13px] text-danger">{errors.password}</p>}
              </div>
              <div className="mt-5">
                <label htmlFor="su-organization" className={LABEL}>{t("auth.signUp.organizationLabel", "Organization name")} <span className="normal-case tracking-normal text-ink3">({t("common.status.optional", "optional")})</span></label>
                <Input id="su-organization" autoComplete="organization" maxLength={80} value={organization} readOnly={busy}
                  placeholder={defaultOrganizationName(name)} onChange={(e) => setOrganization(e.target.value)} />
              </div>
              {/* people never see or fill this field; scripts that fill every field do */}
              <div aria-hidden="true" className="absolute -left-[10000px] top-auto h-px w-px overflow-hidden">
                <label htmlFor="su-website">{t("auth.signUp.websiteLabel", "Website")}</label>
                <input id="su-website" name="website" type="text" tabIndex={-1} autoComplete="off" value={website} onChange={(e) => setWebsite(e.target.value)} />
              </div>
              <div className="mt-5">
                <label className="flex items-start gap-3 text-[14px] text-ink2">
                  <input id="su-terms" type="checkbox" checked={terms} disabled={busy}
                    aria-invalid={errors.terms ? true : undefined} aria-describedby={errors.terms ? "su-terms-error" : undefined}
                    onChange={(e) => { setTerms(e.target.checked); setErrors((x) => ({ ...x, terms: undefined })); }}
                    className="mt-0.5 h-4 w-4 shrink-0 rounded border-line accent-[rgb(var(--c-accent))]" />
                  <span>
                    {rich(t("auth.signUp.acceptTerms", "I accept the {terms} and the {privacy}."), {
                      terms: TERMS_URL ? <a href={TERMS_URL} target="_blank" rel="noreferrer" className={LINK}>{t("auth.signUp.termsLink", "terms of service")}</a> : t("auth.signUp.termsLink", "terms of service"),
                      privacy: PRIVACY_URL ? <a href={PRIVACY_URL} target="_blank" rel="noreferrer" className={LINK}>{t("auth.signUp.privacyLink", "privacy policy")}</a> : t("auth.signUp.privacyLink", "privacy policy"),
                    })}
                  </span>
                </label>
                {errors.terms && <p id="su-terms-error" className="mt-2 text-[13px] text-danger">{errors.terms}</p>}
              </div>
              {failure && <p role="alert" className="mt-4 text-[13px] text-danger">{failure}</p>}
              <Button variant="primary" size="lg" type="submit" className="mt-6 w-full" aria-busy={busy || undefined} disabled={leaving}
                iconRight={!busy ? <ArrowRight size={18} strokeWidth={1.75} aria-hidden="true" /> : undefined}
                icon={busy ? <LoaderCircle size={18} strokeWidth={1.75} aria-hidden="true" className="animate-spin" /> : undefined}>
                {busy ? t("auth.signUp.submitting", "Creating your account…") : t("auth.signUp.submit", "Create account")}
              </Button>
            </form>
            <p className="mt-6 text-center text-[14px] text-ink2">
              {t("auth.signUp.haveAccount", "Already have an account?")}{" "}
              <Link to={authHref("signin", { next: params.get("next"), plan })} state={AUTH_SWITCH} className={LINK}>{t("auth.signIn.submit", "Sign in")}</Link>
            </p>
          </>
        )}
    </section>
  );
}
