import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { cn } from "@/madp/lib/cn";
import { Banner } from "@/madp/ui/kit";
import { useSession } from "@/madp/blocks/session";
import { SignInForm } from "./SignInForm";
import { ResetPassword } from "./ResetPassword";
import { PasteLinkView } from "./PasteLinkView";
import { AUTH_SWITCH, authHref, emailError, type AuthViewProps } from "./auth";
import { useT } from "@/madp/i18n";

function pasteHref(params: URLSearchParams): string {
  const q = new URLSearchParams();
  const next = params.get("next");
  const email = params.get("email");
  if (next) q.set("next", next);
  if (email) q.set("email", email);
  q.set("paste", "1");
  return `/sign-in?${q.toString()}`;
}

type View = "signin" | "reset";

/** The sign-in view inside the form pane: the sign-in and reset views share one grid cell and cross-fade. */
export function SignInView({ onSignedIn, onPending, leaving }: AuthViewProps) {
  const t = useT();
  const [params, setParams] = useSearchParams();
  const [initialEmail] = useState(() => {
    const q = params.get("email") ?? "";
    return q && !emailError(q) ? q : "";
  });
  const notice = useSession((st) => st.notice);
  const forgot = params.get("forgot") === "1";
  const [view, setView] = useState<View>(forgot ? "reset" : "signin");
  const [resetEmail, setResetEmail] = useState(initialEmail);
  const [openCount, setOpenCount] = useState(0);
  const reset = view === "reset";

  function openReset(email: string) {
    setResetEmail(email);
    setOpenCount((n) => n + 1);
    setView("reset");
  }
  function backToSignIn() {
    setView("signin");
    window.setTimeout(() => document.getElementById("si-forgot")?.focus(), 0);
  }

  const signInPanel = useRef<HTMLDivElement>(null);
  const resetPanel = useRef<HTMLDivElement>(null);

  // The hidden panel is inert (React 18 has no typed `inert` prop); declared before the focus effect so inert is lifted first.
  useLayoutEffect(() => {
    signInPanel.current?.toggleAttribute("inert", reset);
    resetPanel.current?.toggleAttribute("inert", !reset);
  }, [reset]);

  useEffect(() => {
    if (!reset) return;
    const timer = window.setTimeout(() => document.getElementById("si-reset-email")?.focus(), 0);
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") backToSignIn(); };
    document.addEventListener("keydown", onKey);
    return () => { window.clearTimeout(timer); document.removeEventListener("keydown", onKey); };
  }, [reset]);

  if (params.get("paste") === "1") {
    return (
      <PasteLinkView leaving={leaving} onBack={() => {
        const q = new URLSearchParams(params);
        q.delete("paste");
        setParams(q, { replace: true });
      }} />
    );
  }

  const fade = "transition-[opacity,visibility] duration-300";
  return (
    <section aria-labelledby="auth-title" data-leaving={leaving || undefined} className="w-full">
      <h1 id="auth-title" tabIndex={-1} className="text-[28px] font-medium leading-tight tracking-[-0.02em] outline-none sm:text-[32px]">
        {reset ? t("auth.forgot.title", "Reset your password") : t("auth.signIn.title", "Welcome back")}
      </h1>
      <p className="mt-2 text-[15px] text-ink2">
        {reset ? t("auth.signIn.resetIntro", "Enter your work email and we will send you a link to set a new password.") : t("auth.signIn.intro", "Sign in to your workspace.")}
      </p>

      {notice && <Banner tone="neutral" className="mt-6" title={notice} />}

      <div className="mt-6 grid [&>*]:[grid-area:1/1]">
        <div ref={signInPanel} data-panel="signin" aria-hidden={reset || undefined} className={cn(fade, reset && "invisible opacity-0")}>
          <SignInForm initialEmail={initialEmail} onSignedIn={onSignedIn} onForgot={openReset} disabled={leaving} onPending={onPending} />
          <p className="mt-7 text-center text-[14px] text-ink2">
            {t("auth.signIn.newHere", "New to MADP Factory?")}{" "}
            <Link to={authHref("signup", { next: params.get("next"), plan: params.get("plan") })} state={AUTH_SWITCH}
              className="font-medium text-accent underline-offset-4 hover:underline">{t("auth.common.createAnAccount", "Create an account")}</Link>
          </p>
          <p className="mt-3 text-center text-[14px] text-ink2">
            <Link to={pasteHref(params)} state={AUTH_SWITCH}
              className="font-medium text-accent underline-offset-4 hover:underline">{t("auth.signIn.pasteLink", "Have a link from an email? Paste it here")}</Link>
          </p>
        </div>
        <div ref={resetPanel} data-panel="reset" aria-hidden={!reset || undefined} className={cn(fade, !reset && "invisible opacity-0")}>
          <ResetPassword key={openCount} initialEmail={resetEmail} onBack={backToSignIn} />
        </div>
      </div>
    </section>
  );
}
