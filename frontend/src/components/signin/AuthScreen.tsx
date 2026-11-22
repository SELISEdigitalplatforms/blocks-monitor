import { useEffect, useRef, useState, type ReactNode } from "react";
import { Link, Navigate, useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import { PRODUCT } from "@/data/facts";
import { useSession } from "@/blocks/session";
import { useReducedMotion } from "@/components/landing/motion";
import { Logo } from "@/ui/Shell";
import { LanguageSwitcher } from "@/i18n/LanguageSwitcher";
import { useT } from "@/i18n";
import { cn } from "@/lib/cn";
import { AUTH_SWITCH, HANDOFF_MS, authHref, isAuthSwitch, planNext, safeNext, type AuthMode, type AuthScreenMode } from "./auth";
import { CinemaPane } from "./CinemaPane";
import { SignInView } from "./SignInView";
import { SignUpView } from "./SignUpView";
import { MustChangePasswordView } from "./MustChangePasswordView";
import { ActivateView, NewPasswordView } from "./SetPasswordView";
import "./signin.css";

const SEG = "rounded-full py-2 text-center text-[14px] font-medium outline-none transition focus-visible:ring-2 focus-visible:ring-accent/50";

/** The whole /sign-in and /sign-up page: one two-pane card with the hand-off. */
export function AuthScreen({ mode, content }: { mode: AuthScreenMode; content?: ReactNode }) {
  const t = useT();
  const [params] = useSearchParams();
  // a plan picked on the pricing page: signing in to an existing account continues to that plan's next step
  const plan = params.get("plan");
  const next = safeNext(params.get("next") ?? planNext(plan));
  const location = useLocation();
  const [switched] = useState(() => isAuthSwitch(location.state));
  const reduced = useReducedMotion();
  const entrance = !reduced && !switched;
  const navigate = useNavigate();
  const signedIn = useSession((st) => st.status === "signed-in");
  const mustChange = useSession((st) => st.status === "signed-in" && st.profile?.mustChangePassword === true);
  const forced = mustChange && (mode === "signin" || mode === "signup");
  const [leaving, setLeaving] = useState(false);
  const [pending, setPending] = useState(false);
  const timer = useRef<number>();
  const activeLink = useRef<HTMLAnchorElement>(null);

  useEffect(() => () => window.clearTimeout(timer.current), []);
  useEffect(() => { if (switched) activeLink.current?.focus(); }, [switched]);

  const enter = () => {
    if (leaving || useSession.getState().profile?.mustChangePassword === true) return;
    const go = () => {
      navigate(next, { replace: true });
    };
    if (reduced) { go(); return; }
    setLeaving(true);
    timer.current = window.setTimeout(go, HANDOFF_MS);
  };

  if (!content && signedIn && !mustChange && !pending && !leaving && (mode === "signin" || mode === "signup")) return <Navigate to={next} replace />;

  const rawNext = params.get("next");
  const seg = (m: AuthMode, label: string) => {
    const active = mode === m;
    return (
      <Link ref={active ? activeLink : undefined} to={authHref(m, { next: rawNext, plan })} state={AUTH_SWITCH}
        aria-current={active ? "page" : undefined}
        className={cn(SEG, active ? "bg-surface text-ink shadow-card dark:bg-line" : "text-ink2 hover:text-ink")}>
        {label}
      </Link>
    );
  };

  return (
    <div className="si-page relative flex min-h-[100svh] flex-col overflow-x-clip bg-canvas text-ink"
      data-entrance={entrance ? "on" : "off"} data-handoff={leaving || undefined}>
      <main className="flex flex-1 items-center justify-center px-4 pt-6 pb-36 md:px-8 md:pt-10">
        <div className="si-card relative grid w-full max-w-[1180px] overflow-hidden rounded-card bg-surface shadow-float dark:ring-1 dark:ring-line md:min-h-[680px] md:grid-cols-[52fr_48fr]">
          <CinemaPane mode={mode === "signup" ? "signup" : "signin"} entrance={entrance} className="z-[2] hidden md:flex" />
          <div aria-hidden className="si-curtain pointer-events-none absolute inset-0 z-[1] hidden bg-stage md:block" />
          <section aria-labelledby="auth-title" className="si-form relative z-0 flex min-w-0 flex-col bg-surface px-5 py-6 sm:px-8 md:px-10 md:py-9 xl:px-14">
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
              <Link to="/" aria-label={t("auth.screen.logoLabel", "MADP Factory, back to the landing page")} className="flex items-center gap-2.5 md:hidden">
                <Logo size={34} />
                <span className="text-[16px] font-medium tracking-tight">{PRODUCT}</span>
              </Link>
              <LanguageSwitcher tone="auth" className="ml-auto" />
              <Link to="/" className="inline-flex items-center gap-1.5 text-[14px] font-medium text-ink2 underline-offset-4 hover:text-ink hover:underline">
                <ArrowLeft size={16} strokeWidth={1.75} /> {t("auth.screen.backToSite", "Back to the site")}
              </Link>
            </div>
            {!forced && (
              <nav aria-label={t("auth.screen.tabsLabel", "Sign in or create an account")} className="mt-5">
                <div className="grid w-full max-w-[360px] grid-cols-2 rounded-full bg-surface2 p-1 dark:ring-1 dark:ring-line">
                  {seg("signin", t("auth.screen.signInTab", "Sign in"))}
                  {/* when sign-up is invite-only, this tab explains how to get access */}
                  {seg("signup", t("auth.screen.signUpTab", "Create account"))}
                </div>
              </nav>
            )}
            <div key={mode} className="si-swap mx-auto mt-8 flex w-full max-w-[420px] flex-1 flex-col justify-center" data-switched={switched || undefined}>
              {content ?? (forced ? <MustChangePasswordView onDone={enter} leaving={leaving} />
                : mode === "signin" ? <SignInView onSignedIn={enter} onPending={setPending} leaving={leaving} />
                : mode === "signup" ? <SignUpView leaving={leaving} />
                : mode === "activate" ? <ActivateView leaving={leaving} />
                : <NewPasswordView leaving={leaving} />)}
            </div>
          </section>
        </div>
      </main>
    </div>
  );
}
