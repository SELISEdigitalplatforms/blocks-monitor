import { useState, type FormEvent } from "react";
import { Link2 } from "lucide-react";
import { Button, Input } from "@/madp/ui/kit";
import { parseAccountLink } from "@/madp/blocks/account";
import { ActivateView, NewPasswordView } from "./SetPasswordView";
import { useT } from "@/madp/i18n";

type Parsed = { kind: "reset" | "activation"; code: string };

/** Paste the reset or activation link from an email: the code stays in component state only. */
export function PasteLinkView({ leaving, title, onBack, onDone }: { leaving: boolean; title?: string; onBack?: () => void; onDone?: () => void }) {
  const t = useT();
  const [raw, setRaw] = useState("");
  const [error, setError] = useState("");
  const [link, setLink] = useState<Parsed | null>(null);

  if (link) {
    return link.kind === "reset"
      ? <NewPasswordView leaving={leaving} code={link.code} onDone={onDone} />
      : <ActivateView leaving={leaving} code={link.code} />;
  }

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (leaving) return;
    const r = await parseAccountLink(raw);
    if (!r.ok) {
      setError(r.message);
      return;
    }
    setError("");
    setRaw("");
    setLink(r.link);
  };

  return (
    <section aria-labelledby="auth-title" data-leaving={leaving || undefined} className="w-full">
      <h1 id="auth-title" tabIndex={-1} className="text-[28px] font-medium leading-tight tracking-[-0.02em] outline-none sm:text-[32px]">
        {title ?? t("auth.pasteLink.title", "Paste the link from your email")}
      </h1>
      <p className="mt-2 text-[15px] text-ink2">
        {t("auth.pasteLink.intro", "Copy the whole link from the email MADP Factory sent you (right-click it, then Copy link) and paste it here.")}
      </p>
      <form noValidate onSubmit={submit} className="mt-6" aria-label={t("auth.pasteLink.title", "Paste the link from your email")}>
        <Input aria-label={t("auth.pasteLink.inputLabel", "Link from your email")} inputMode="url" autoComplete="off" spellCheck={false} maxLength={2048}
          value={raw} readOnly={leaving} aria-invalid={error ? true : undefined} aria-describedby={error ? "pl-error" : undefined}
          onChange={(e) => { setRaw(e.target.value); if (error) setError(""); }} />
        {error && <p id="pl-error" role="alert" className="mt-2 text-[13px] text-danger">{error}</p>}
        <Button variant="primary" size="lg" type="submit" className="mt-6 w-full" disabled={leaving}
          icon={<Link2 size={18} strokeWidth={1.75} aria-hidden="true" />}>
          {t("common.actions.continue", "Continue")}
        </Button>
        {onBack && (
          <Button variant="ghost" type="button" className="mt-3 w-full" onClick={onBack}>{t("common.actions.back", "Back")}</Button>
        )}
      </form>
    </section>
  );
}
