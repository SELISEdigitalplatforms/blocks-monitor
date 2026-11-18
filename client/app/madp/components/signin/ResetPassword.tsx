import { useEffect, useState, type FormEvent } from "react";
import { ArrowLeft, LoaderCircle, MailCheck } from "lucide-react";
import { Button, Input } from "@/madp/ui/kit";
import { requestPasswordReset } from "@/madp/blocks/account";
import { emailError } from "./auth";
import { PasteLinkView } from "./PasteLinkView";
import { useT } from "@/madp/i18n";

type Phase = "form" | "sending" | "sent";

/** The reset view of the sign-in panel. The answer is always the same neutral message, whether or not the account exists. */
export function ResetPassword({ initialEmail, onBack }: { initialEmail: string; onBack: () => void }) {
  const t = useT();
  const [email, setEmail] = useState(initialEmail);
  const [error, setError] = useState<string | null>(null);
  const [phase, setPhase] = useState<Phase>("form");

  useEffect(() => { if (phase === "sent") document.getElementById("si-reset-back")?.focus(); }, [phase]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (phase !== "form") return;
    const msg = emailError(email);
    setError(msg);
    if (msg) { document.getElementById("si-reset-email")?.focus(); return; }
    setPhase("sending");
    await requestPasswordReset(email.trim());
    setPhase("sent");
  }

  if (phase === "sent") {
    return (
      <div className="flex flex-col gap-5">
        <div role="status" className="flex flex-col gap-5">
          <MailCheck size={28} aria-hidden className="text-success" />
          <p className="text-[15px] text-ink2">{t("auth.reset.sent", "If an account exists for that email, a reset link is on its way.")}</p>
        </div>
        <PasteLinkView leaving={false} title={t("auth.reset.pasteTitle", "Paste the reset link from your email")} onDone={onBack} />
        <Button id="si-reset-back" variant="ghost" className="w-full" onClick={onBack}>{t("auth.common.backToSignIn", "Back to sign in")}</Button>
      </div>
    );
  }

  const sending = phase === "sending";
  return (
    <form noValidate onSubmit={submit}>
      <label htmlFor="si-reset-email" className="mb-1.5 block text-[12px] font-medium uppercase tracking-wider text-ink2">{t("auth.reset.emailLabel", "Email for the reset link")}</label>
      <Input id="si-reset-email" type="email" autoComplete="username" value={email} disabled={sending}
        onChange={(e) => { setEmail(e.target.value); if (error) setError(null); }}
        aria-invalid={error ? true : undefined} aria-describedby={error ? "si-reset-error" : undefined} />
      {error && <p id="si-reset-error" className="mt-2 text-[13px] text-danger">{error}</p>}
      <Button type="submit" variant="primary" size="lg" className="mt-6 w-full" aria-busy={sending || undefined} disabled={sending}
        icon={sending ? <LoaderCircle size={16} className="animate-spin" aria-hidden /> : undefined}>
        {sending ? t("auth.common.sending", "Sending…") : t("auth.reset.submit", "Send reset link")}
      </Button>
      <button type="button" onClick={onBack}
        className="mx-auto mt-4 flex items-center gap-1.5 rounded-full px-2 py-1 text-[14px] text-ink2 transition hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60">
        <ArrowLeft size={14} aria-hidden /> {t("auth.common.backToSignIn", "Back to sign in")}
      </button>
    </form>
  );
}
