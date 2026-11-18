import { useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { ResetPassword } from "./ResetPassword";
import { emailError } from "./auth";
import { useT } from "@/madp/i18n";

/** The reset request as its own page (links in e-mails and on the confirmation page point here). */
export function ForgotPasswordView() {
  const t = useT();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const [initialEmail] = useState(() => {
    const q = params.get("email") ?? "";
    return q && !emailError(q) ? q : "";
  });
  return (
    <section aria-labelledby="auth-title" className="w-full">
      <h1 id="auth-title" tabIndex={-1} className="text-[28px] font-medium leading-tight tracking-[-0.02em] outline-none sm:text-[32px]">
        {t("auth.forgot.title", "Reset your password")}
      </h1>
      <p className="mb-6 mt-2 text-[15px] text-ink2">{t("auth.forgot.intro", "Enter your work email and we will send you a link to set a new password. The link works once, for one hour.")}</p>
      <ResetPassword initialEmail={initialEmail} onBack={() => navigate(initialEmail ? `/sign-in?email=${encodeURIComponent(initialEmail)}` : "/sign-in")} />
    </section>
  );
}
