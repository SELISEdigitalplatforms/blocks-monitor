/** The account menu's credit row: "Credit: USD 37.60 left", a menu item to Settings → Plan and usage. Nothing shows
 *  while the summary loads or when billing is not available. */
import { Link } from "react-router-dom";
import { Wallet } from "lucide-react";
import { cn } from "@/lib/cn";
import { useT } from "@/i18n";
import { Dot } from "@/ui/kit";
import { useCurrentWorkspace } from "@/state/workspaces";
import { useBillingSummary } from "./billingData";
import type { BillingSummary } from "./types";
import { creditLine, creditState } from "./usageText";

export function CreditMenuItem({ summary, className, onSelect }: { summary: BillingSummary; className?: string; onSelect?: () => void }) {
  useT();
  const state = creditState(summary);
  return (
    <Link to="/settings#plan" role="menuitem" onClick={onSelect} className={cn(className, "num")} data-credit={state}>
      <Wallet size={16} aria-hidden />
      <span className="min-w-0 flex-1">{creditLine(summary)}</span>
      {state !== "ok" && <span className="self-center"><Dot tone={state === "out" ? "danger" : "warning"} /></span>}
    </Link>
  );
}

export function CreditMenuLine({ className, onSelect }: { className?: string; onSelect?: () => void }) {
  const workspace = useCurrentWorkspace();
  const summary = useBillingSummary(workspace?.id);
  if (!summary.data) return null;
  return <CreditMenuItem summary={summary.data} className={className} onSelect={onSelect} />;
}
