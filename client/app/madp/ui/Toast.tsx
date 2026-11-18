/** A one-message toast: showToast(text) shows it for 5 s in a polite live region mounted once in the shell. */
import { useEffect, useState } from "react";
import { create } from "zustand";
import { CircleCheck, X } from "lucide-react";
import { useT } from "@/madp/i18n";

interface ToastState { seq: number; text: string | null }
const useToast = create<ToastState>(() => ({ seq: 0, text: null }));

export function showToast(text: string): void {
  useToast.setState((s) => ({ seq: s.seq + 1, text }));
}

export function ToastHost() {
  const t = useT();
  const seq = useToast((s) => s.seq);
  const text = useToast((s) => s.text);
  const [shown, setShown] = useState<string | null>(null);

  useEffect(() => {
    if (!text) { setShown(null); return; }
    // render the text a moment after mount or change so screen readers announce it
    const show = window.setTimeout(() => setShown(text), 50);
    const hide = window.setTimeout(() => { setShown(null); useToast.setState({ text: null }); }, 5000);
    return () => { window.clearTimeout(show); window.clearTimeout(hide); };
  }, [seq, text]);

  return (
    <div role="status" aria-live="polite" className="pointer-events-none fixed inset-x-0 top-4 z-50 flex justify-center px-4">
      {shown && (
        <div key={seq} className="pointer-events-auto inline-flex max-w-full items-center gap-3 rounded-full bg-surface px-4 py-2.5 text-[14px] text-ink shadow-float dark:ring-1 dark:ring-line motion-safe:animate-rise">
          <CircleCheck size={18} className="shrink-0 text-success" aria-hidden="true" />
          <span>{shown}</span>
          <button type="button" aria-label={t("common.actions.dismiss", "Dismiss")} onClick={() => { setShown(null); useToast.setState({ text: null }); }}
            className="grid h-6 w-6 shrink-0 place-items-center rounded-full text-ink hover:bg-line focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent">
            <X size={16} aria-hidden="true" />
          </button>
        </div>
      )}
    </div>
  );
}
