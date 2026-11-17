import { useEffect, useRef, useState, type FormEvent } from "react";
import { Check, Copy, UserPlus } from "lucide-react";
import { Button, Input, Label, Modal } from "@/ui/kit";
import { PASSWORD_NOTE, createAccount } from "@/blocks/people";
import { t, useT } from "@/i18n";

type Reveal = { email: string; password: string; message: string; note: string };

/** Writes the password to the clipboard; false when the browser refuses. */
export async function copyPassword(password: string, clipboard: Pick<Clipboard, "writeText"> | undefined): Promise<boolean> {
  try {
    if (!clipboard) return false;
    await clipboard.writeText(password);
    return true;
  } catch {
    return false;
  }
}

export { PASSWORD_NOTE };

/** What the super admin is told after creating an account (the same sentences as handOver), in the current language. */
function handOverText(email: string, active: boolean, mustChangePassword: boolean): { message: string; note: string } {
  if (!active) {
    return {
      message: t("platform.admin.createAccount.createdInactive", "Account created for {email}, but it is not active yet. Choose Activate next to it in the list before you hand it over.", { email }),
      note: t("platform.admin.createAccount.noteInactive", "The account is not active yet: activate it in the list, then share the password privately."),
    };
  }
  return mustChangePassword
    ? { message: t("platform.admin.createAccount.createdMustChange", "Account created for {email}. They must change the temporary password when they first sign in.", { email }),
      note: t("platform.admin.createAccount.passwordNote", "Share it privately; they must change it when they first sign in.") }
    : { message: t("platform.admin.createAccount.createdActive", "Account created for {email}. It is active and ready to hand over.", { email }),
      note: t("platform.admin.createAccount.noteActive", "Share it privately and ask them to change it after they first sign in.") };
}

/** Step 2: the one-time display. The password stays in this component's props/state only. */
export function PasswordReveal({ email, password, note, onDone }: { email: string; password: string; note?: string; onDone: () => void }) {
  const t = useT();
  const [copied, setCopied] = useState<"idle" | "copied" | "manual">("idle");
  const field = useRef<HTMLDivElement>(null);
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(timer.current), []);

  const copy = async () => {
    window.clearTimeout(timer.current);
    if (await copyPassword(password, navigator.clipboard)) {
      setCopied("copied");
      timer.current = window.setTimeout(() => setCopied("idle"), 2000);
    } else {
      field.current?.querySelector("input")?.select();
      setCopied("manual");
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <div>
        <Label>{t("platform.admin.createAccount.passwordFor", "Temporary password for {email}", { email })}</Label>
        <div ref={field} className="flex flex-wrap items-center gap-2">
          <Input readOnly value={password} aria-label={t("platform.admin.createAccount.password", "Temporary password")} autoComplete="off" spellCheck={false}
            className="min-w-0 flex-1 font-mono" onFocus={(e) => e.currentTarget.select()} />
          <Button type="button" variant="secondary" onClick={() => void copy()}
            icon={copied === "copied" ? <Check size={16} strokeWidth={1.75} /> : <Copy size={16} strokeWidth={1.75} />}>
            {copied === "copied" ? t("platform.admin.createAccount.copied", "Copied") : t("platform.admin.createAccount.copy", "Copy")}
          </Button>
        </div>
        {copied === "manual" && <p role="status" className="mt-2 text-[13px] text-ink2">{t("platform.admin.createAccount.selectAndCopy", "Select and copy it")}</p>}
      </div>
      <p className="text-[14px] text-ink2">{note ?? t("platform.admin.createAccount.passwordNote", "Share it privately; they must change it when they first sign in.")}</p>
      <div className="flex flex-wrap justify-end gap-3">
        <Button type="button" variant="primary" onClick={onDone}>{t("platform.admin.createAccount.done", "Done")}</Button>
      </div>
    </div>
  );
}

export function CreateAccountDialog({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: (message: string) => void }) {
  const t = useT();
  const [email, setEmail] = useState("");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reveal, setReveal] = useState<Reveal | null>(null);
  const inFlight = useRef(false);

  useEffect(() => { if (open) { setEmail(""); setFirstName(""); setLastName(""); setError(null); } else setReveal(null); }, [open]);
  useEffect(() => () => setReveal(null), []);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (busy || inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setError(null);
    let r: Awaited<ReturnType<typeof createAccount>>;
    try { r = await createAccount({ email, firstName, lastName }); } finally { inFlight.current = false; }
    setBusy(false);
    if (r.ok) setReveal({ email: r.email, password: r.temporaryPassword, ...handOverText(r.email, r.active, r.mustChangePassword) });
    else setError(r.error);
  };

  const done = () => {
    const message = reveal?.message;
    setReveal(null);
    onClose();
    if (message) onCreated(message);
  };

  // Step 2: only Done or the close button end it, never a click on the backdrop.
  const dismiss = () => {
    if (busy) return;
    if (!reveal) { onClose(); return; }
    const ev = window.event;
    const target = ev?.type === "click" ? (ev.target as Element | null) : null;
    if (target && !target.closest?.("button")) return;
    done();
  };

  return (
    <Modal open={open} onClose={dismiss} title={reveal ? t("platform.admin.createAccount.createdTitle", "Account created") : t("platform.admin.createAccount.title", "Create account")} width={520}>
      {reveal ? (
        <PasswordReveal email={reveal.email} password={reveal.password} note={reveal.note} onDone={done} />
      ) : (
        <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
          <div>
            <Label>{t("platform.admin.createAccount.email", "Email")}</Label>
            <Input type="email" autoComplete="off" autoFocus value={email} maxLength={254} onChange={(e) => setEmail(e.target.value)} aria-label={t("platform.admin.createAccount.email", "Email")} placeholder={t("platform.admin.createAccount.emailPlaceholder", "name@company.com")} />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <Label>{t("platform.admin.createAccount.firstName", "First name")}</Label>
              <Input value={firstName} maxLength={60} onChange={(e) => setFirstName(e.target.value)} aria-label={t("platform.admin.createAccount.firstName", "First name")} />
            </div>
            <div>
              <Label>{t("platform.admin.createAccount.lastName", "Last name")}</Label>
              <Input value={lastName} maxLength={60} onChange={(e) => setLastName(e.target.value)} aria-label={t("platform.admin.createAccount.lastName", "Last name")} />
            </div>
          </div>
          <p className="text-[13px] text-ink3">{t("platform.admin.createAccount.startAccess", "They start with the same access as an invited person. Add them to a workspace or make them Super admin afterwards.")}</p>
          {error && <p role="alert" className="text-[13px] text-danger [overflow-wrap:anywhere]">{error}</p>}
          <div className="flex flex-wrap justify-end gap-3">
            <Button type="button" variant="ghost" onClick={onClose} disabled={busy}>{t("platform.admin.createAccount.cancel", "Cancel")}</Button>
            <Button type="submit" variant="primary" disabled={busy} icon={<UserPlus size={16} strokeWidth={1.75} />}>{t("platform.admin.createAccount.submit", "Create account")}</Button>
          </div>
        </form>
      )}
    </Modal>
  );
}
