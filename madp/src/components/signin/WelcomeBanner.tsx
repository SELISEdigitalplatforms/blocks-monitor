import { useState } from "react";
import { useSearchParams } from "react-router-dom";
import { X } from "lucide-react";
import { useSession } from "@/blocks/session";
import { useT } from "@/i18n";
import { useCurrentWorkspace } from "@/state/workspaces";
import { useBillingSummary } from "@/components/billing/billingData";
import { welcomeText } from "./welcomeText";

/** Home after a new account's first sign-in (?welcome=1): one short welcome, closed for good with the X. The plan and the
 *  credit it names are the organization's own (its billing summary, the credit pill's query), said only once known. */
export function WelcomeBanner() {
  const t = useT();
  const [params, setParams] = useSearchParams();
  const name = useSession((s) => s.profile?.firstName || "");
  const [open, setOpen] = useState(params.get("welcome") === "1");
  const workspace = useCurrentWorkspace();
  const summary = useBillingSummary(open ? workspace?.id : null);
  if (!open) return null;
  const close = () => {
    setOpen(false);
    const q = new URLSearchParams(params);
    q.delete("welcome");
    setParams(q, { replace: true });
  };
  return (
    <div role="status" className="mb-6 flex items-start gap-4 rounded-card bg-surface p-5 shadow-card dark:ring-1 dark:ring-line">
      <div className="min-w-0 flex-1">
        <p className="text-[17px] font-medium text-ink">{name ? t("auth.welcome.titleNamed", "Welcome to MADP Factory, {name}.", { name }) : t("auth.welcome.title", "Welcome to MADP Factory.")}</p>
        <p className="mt-1 text-[14px] text-ink2">{welcomeText(summary.data)}</p>
      </div>
      <button type="button" aria-label={t("auth.welcome.close", "Close the welcome")} onClick={close}
        className="grid h-9 w-9 shrink-0 place-items-center rounded-full text-ink2 hover:bg-line hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60">
        <X size={18} strokeWidth={1.75} aria-hidden="true" />
      </button>
    </div>
  );
}
