/** The conversation's history, for those who want it: a small "Transcript" toggle (closed by default, never opened by
 *  itself) and a slim drawer with everything said so far. Esc closes it. */
import { useEffect, useRef, useState } from "react";
import { ScrollText, X } from "lucide-react";
import { useT } from "@/i18n";
import { cn } from "@/lib/cn";
import { GUIDE_NAME } from "../ui/Avatar";
import { useChat } from "./chat";

export function Transcript({ phone = false }: { phone?: boolean }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const messages = useChat((s) => s.messages);
  const list = useRef<HTMLOListElement>(null);
  useEffect(() => { if (open) list.current?.lastElementChild?.scrollIntoView({ block: "end" }); }, [open, messages.length]);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);
  return (
    <>
      <button type="button" aria-expanded={open} aria-controls="visit-transcript" onClick={() => setOpen((v) => !v)}
        className={cn("cine-pill pointer-events-auto absolute flex h-9 items-center gap-1.5 px-3.5 text-[13px] font-medium text-ink2 transition-colors hover:text-ink",
          phone ? "right-3 top-[112px]" : "bottom-6 right-6")}>
        <ScrollText size={15} aria-hidden />{t("studio.office.visit.transcript.toggle", "Transcript")}
      </button>
      {open && <aside id="visit-transcript" aria-label={t("studio.office.visit.transcript.label", "Transcript")}
        className={cn("visit-transcript pointer-events-auto absolute flex w-[min(360px,calc(100vw-24px))] flex-col overflow-hidden", phone ? "bottom-24 right-3 top-[152px]" : "bottom-20 right-6 top-24")}>
        <div className="flex items-center justify-between border-b border-ink/[0.06] px-4 py-3">
          <span className="text-[14px] font-semibold text-ink">{t("studio.office.visit.transcript.label", "Transcript")}</span>
          <button type="button" aria-label={t("studio.office.visit.transcript.close", "Close the transcript")} onClick={() => setOpen(false)}
            className="grid h-7 w-7 place-items-center rounded-full text-ink3 hover:bg-ink/5 hover:text-ink"><X size={15} /></button>
        </div>
        <ol ref={list} className="cine-scroll flex-1 space-y-3 overflow-y-auto px-4 py-3">
          {messages.map((m) => (
            <li key={m.id} className={cn("text-[13px] leading-snug", m.from === "you" ? "text-right" : "")}>
              <span className="block text-[11px] text-ink3">{m.from === "you" ? t("studio.office.visit.chat.you", "You") : GUIDE_NAME[m.from]}</span>
              <span className={cn("inline-block max-w-[92%] whitespace-pre-wrap break-words text-left", m.from === "you" ? "rounded-xl bg-ink px-2.5 py-1 text-white" : "text-ink")}>{m.text}</span>
            </li>
          ))}
        </ol>
      </aside>}
    </>
  );
}
