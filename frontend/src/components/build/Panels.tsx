/** Side panels of the Studio: the automatic quality gates and the live feed, both read from real records (the
 *  milestone's tickets and their events, and the project's engine jobs). */
import { useLayoutEffect, useRef, useState } from "react";
import { Check, LoaderCircle, Pause as HoldIcon, Radio, TriangleAlert, X } from "lucide-react";
import type { ChipTone } from "@/data/types";
import { cn } from "@/lib/cn";
import { AiTag, Card, EmptyState } from "@/ui/kit";
import type { FeedItem, Gate, GateState } from "./model";
import { StageIcon } from "./stageUi";
import { t, useT } from "@/i18n";

/* ── quality gates ────────────────────────────────────────────────────────── */

const GATE_STYLE: Record<GateState, { ring: string; word: string }> = {
  pending: { ring: "hatched bg-surface2 text-ink3", get word() { return t("build.proofDrawer.pending", "Pending"); } },
  running: { ring: "bg-accent-soft text-accent", get word() { return t("build.panels.checking", "Checking"); } },
  held: { ring: "bg-warning-soft text-warning", get word() { return t("build.timeline.onHold", "On hold"); } },
  passed: { ring: "bg-success text-white dark:text-stage", get word() { return t("build.proofDrawer.passed", "Passed"); } },
  failed: { ring: "bg-danger text-white", get word() { return t("build.panels.failed", "Failed, sent back for a fix"); } },
};

/** The four automatic quality gates of the build. */
export function QualityGates({ gates, className }: { gates: Gate[]; className?: string }) {
  const t = useT();
  return (
    <ul className={cn("space-y-1", className)} aria-label={t("build.panels.gates", "Quality gates")}>
      {gates.map((g) => {
        const s = GATE_STYLE[g.state];
        return (
          <li key={g.id} className="flex items-start gap-3 py-1.5">
            <span className={cn("mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full transition-colors duration-500", s.ring)}>
              {g.state === "passed" && <Check size={12} strokeWidth={2.25} />}
              {g.state === "failed" && <X size={12} strokeWidth={2.25} />}
              {g.state === "held" && <HoldIcon size={11} strokeWidth={2} />}
              {g.state === "running" && <LoaderCircle size={13} strokeWidth={1.75} className="animate-spin [animation-duration:1.6s]" />}
            </span>
            <span className="min-w-0 flex-1">
              <span className="flex items-center gap-2 text-[14px] font-medium">
                {g.label}
                {g.state === "failed" && <TriangleAlert size={13} strokeWidth={1.75} className="text-danger" />}
                <span className="sr-only">: {s.word}</span>
              </span>
              <span className="block text-[13px] leading-snug text-ink2">{g.detail}</span>
            </span>
          </li>
        );
      })}
    </ul>
  );
}

/* ── live feed ────────────────────────────────────────────────────────────── */

const FEED_RING: Record<ChipTone, string> = {
  neutral: "bg-surface2 text-ink2", accent: "bg-accent-soft text-accent", ai: "bg-ai-soft text-ai",
  success: "bg-success-soft text-success", warning: "bg-warning-soft text-warning", danger: "bg-danger-soft text-danger",
};

/** The feed, newest first. Past `maxHeight` the list scrolls inside the card and fades out at the bottom edge while
 *  there is more below. `when` words an item's time. */
export function LiveFeed({ items, live, liveLabel, when, maxHeight, className }: {
  items: FeedItem[]; live?: boolean; /** The word beside the title while it moves ("live", or "replay" during a replay). */ liveLabel?: string;
  when: (at: number) => string; maxHeight?: number; className?: string;
}) {
  const t = useT();
  const list = useRef<HTMLDivElement>(null);
  const [more, setMore] = useState(false);
  const measure = () => {
    const el = list.current;
    setMore(Boolean(el && el.scrollHeight - el.scrollTop - el.clientHeight > 4));
  };
  useLayoutEffect(measure, [items.length, maxHeight]);
  return (
    <Card className={className}
      title={<span className="flex items-center gap-2.5 whitespace-nowrap">{t("build.panels.feed", "Live feed")} {live && <span className="inline-flex items-center gap-1.5 text-[12px] font-normal text-ink3"><Radio size={13} strokeWidth={1.75} className="text-accent" /> {liveLabel ?? t("build.studio.liveWord", "live")}</span>}</span>}
      action={<AiTag><span className="hidden sm:inline">{t("build.panels.reported", "Reported by the factory")}</span><span className="sm:hidden">AI</span></AiTag>}>
      {items.length === 0 ? (
        <EmptyState title={t("build.panels.feedEmptyTitle", "The feed starts with the build")} text={t("build.panels.feedEmptyText", "Every build step, every ticket move and every note the agents record appears here as it happens.")} />
      ) : (
        <div ref={list} onScroll={measure} style={maxHeight ? { maxHeight } : undefined}
          className={cn(maxHeight && "scroll-thin -mx-2 overflow-y-auto px-2", more && "[mask-image:linear-gradient(to_bottom,black_80%,transparent)]")}>
          <ol role="log" aria-live="polite" aria-label={t("build.panels.feed", "Live feed")} className="relative space-y-1">
            {items.map((e, i) => (
              <li key={e.key} className={cn("flex gap-3 rounded-block px-2 py-2 animate-rise", i === 0 && live && "bg-surface2")}>
                <span className={cn("grid h-7 w-7 shrink-0 place-items-center rounded-full", FEED_RING[e.tone])}>
                  <StageIcon id={e.stage} size={14} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block break-words text-[14px] leading-snug text-ink">{e.text}</span>
                  <span className="num mt-0.5 block text-[12px] text-ink3">{e.who} · {when(e.at)}</span>
                </span>
              </li>
            ))}
          </ol>
        </div>
      )}
    </Card>
  );
}
