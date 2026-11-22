/** 03 · Every stage, one line: the factory's stages, from plan to release on SELISE Blocks, as a pro-editor timeline. A playhead runs the line; each stage lights up while it works, then its proof document appears.
 *  On the page canvas in the theme's colours. The quality gates act on their own: a failed check goes back to the right
 *  agent, is fixed and re-verified, and the line carries on. */
import { useEffect, useRef, useState } from "react";
import {
  BookOpen, Check, ClipboardList, CodeXml, DoorOpen, FileCheck2, FlaskConical, Layers, Rocket, RotateCcw, ScanEye, ShieldCheck,
} from "lucide-react";
import { STAGES, type StageDef } from "@/data/pipeline";
import type { StageId } from "@/data/types";
import { t, useT } from "@/i18n";
import { cn } from "@/lib/cn";
import { Container, Feature, Section, SectionHeader, rich, stageCode, stageLabel, stagePlain } from "./parts";
import { Reveal, useInView, usePageVisible, useReducedMotion } from "./motion";

const ICON: Record<StageId, typeof Check> = {
  "01": ClipboardList, "02": CodeXml, "03": ScanEye, "04": FlaskConical, "05": ShieldCheck, "06": BookOpen, "07": DoorOpen, deploy: Rocket,
};

const RUN_MS = 14000; // the playhead crosses the line
const HOLD_MS = 2600; // everything done, then the next run
const N = STAGES.length;

/** how quality is kept without anyone waiting: the quality gates */
const rules = () => [
  { icon: ShieldCheck, title: t("landing.line.rule1Title", "Verified at every stage"), text: t("landing.line.rule1Text", "Code review, tests and a security scan run on every build, automatically.") },
  { icon: RotateCcw, title: t("landing.line.rule2Title", "Fixed and re-verified"), text: t("landing.line.rule2Text", "A failed check goes straight back to the right stage. The fix is checked again, and the line keeps moving.") },
  { icon: Layers, title: t("landing.line.rule3Title", "Built for volume"), text: t("landing.line.rule3Text", "Features build side by side, each on its own line. One workspace, many apps.") },
];

/** a step read out for screen readers: its code (none for the release to Blocks), its name and what it does */
const stageAria = (s: StageDef) => (s.id === "deploy"
  ? t("landing.line.stageAriaDeploy", "{name}: {text}", { name: stageLabel(s), text: stagePlain(s) })
  : t("landing.line.stageAria", "{code} {name}: {text}", { code: s.id, name: stageLabel(s), text: stagePlain(s) }));

export function Line() {
  const t = useT();
  const reduced = useReducedMotion();
  const visible = usePageVisible();
  const [frameRef, inView] = useInView<HTMLDivElement>("0px");
  const [active, setActive] = useState(-1);
  const head = useRef<HTMLDivElement>(null);
  const bar = useRef<HTMLDivElement>(null);
  const elapsed = useRef(0);
  const shownActive = reduced ? N : active;

  /* one clock drives the playhead and the compact progress bar (DOM) and the active step (state, one change per step
     and run) */
  useEffect(() => {
    if (reduced || !inView || !visible) return;
    let raf = 0;
    let last = performance.now();
    let current = -2;
    const tick = (now: number) => {
      elapsed.current = (elapsed.current + (now - last)) % (RUN_MS + HOLD_MS);
      last = now;
      const p = Math.min(1, elapsed.current / RUN_MS);
      if (head.current) head.current.style.transform = `translate3d(${(p * 100).toFixed(3)}%, 0, 0)`;
      if (bar.current) bar.current.style.transform = `scaleX(${p.toFixed(4)})`;
      const idx = p >= 1 ? N : Math.floor(p * N);
      if (idx !== current) { current = idx; setActive(idx); }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [reduced, inView, visible]);

  const state = (i: number) => (i < shownActive ? "done" : i === shownActive ? "active" : "planned");
  const now = shownActive >= 0 && shownActive < N ? STAGES[shownActive] : null;

  return (
    <Section id="line" className="overflow-x-clip">
      <Container className="relative isolate">
        {/* the dark theme's blue glow over the header, clipped at the sides only: it fades out above the section on its
            own, so its top is never cut into a seam. Not in daylight: there a white oval would light only the empty
            canvas between the headline and the legend, and read as a smear; the timeline's own shadow gives it depth */}
        <div aria-hidden className="lp-glow pointer-events-none absolute -top-40 left-1/2 hidden h-[520px] w-[900px] -translate-x-1/2 rounded-full bg-[radial-gradient(closest-side,rgb(var(--c-accent)/0.08),transparent)] dark:block dark:bg-[radial-gradient(closest-side,rgb(var(--c-accent)/0.18),transparent)]" />
        <SectionHeader id="line" n="03" eyebrow={t("landing.nav.line", "The line")}
          title={rich(t("landing.line.title", "Every stage, {dim}"), { dim: <span className="lp-dim text-ink3">{t("landing.line.titleDim", "one line.")}</span> })}
          lede={t("landing.line.lede", "Each stage does its job, proves it with a document and hands over, from the plan to the release on SELISE Blocks. Nothing waits on anyone.")}
          aside={
            <ul className="flex flex-wrap gap-2 text-[12px] font-medium text-ink2" aria-label={t("landing.line.legendAria", "Legend")}>
              <li className="lp-card flex items-center gap-2 rounded-full bg-surface px-3 py-1.5 ring-1 ring-line"><span className="lp-hatch h-2 w-3 rounded-sm ring-1 ring-ink/15" /> {t("landing.line.planned", "Planned")}</li>
              <li className="lp-card flex items-center gap-2 rounded-full bg-surface px-3 py-1.5 ring-1 ring-line"><span className="h-2 w-2 rounded-full bg-accent" /> {t("landing.line.atWork", "At work")}</li>
              <li className="lp-card flex items-center gap-2 rounded-full bg-surface px-3 py-1.5 ring-1 ring-line"><Check size={12} strokeWidth={2} className="text-ink2" /> {t("landing.line.done", "Done")}</li>
              <li className="lp-card flex items-center gap-2 rounded-full bg-surface px-3 py-1.5 ring-1 ring-line"><span className="h-2 w-2 rounded-sm bg-ink" /> {t("landing.line.proofDocument", "Proof document")}</li>
            </ul>
          } />

        <Reveal delay={120} className="mt-16">
          <div ref={frameRef} className="lp-panel rounded-card bg-surface shadow-card ring-1 ring-line">
            {/* phones, tablets and small laptops: the same line as a list, top to bottom, with a progress bar for the playhead */}
            <div className="p-4 sm:p-5 xl:hidden">
              <TopBar now={now} />
              <div aria-hidden className="mb-3 h-1 overflow-hidden rounded-full bg-ink/[0.07]">
                <div ref={bar} className="h-full w-full origin-left rounded-full bg-accent will-change-transform" style={reduced ? undefined : { transform: "scaleX(0)" }} />
              </div>
              <ol className="space-y-1.5" aria-label={t("landing.stages.listAria", "The factory's stages, from plan to release")}>
                {STAGES.map((s, i) => {
                  const st = state(i);
                  const Icon = ICON[s.id];
                  const written = i < shownActive;
                  return (
                    <li key={s.id} aria-label={stageAria(s)}
                      className={cn("relative flex items-center gap-3 overflow-hidden rounded-block py-2.5 pl-3.5 pr-2.5 transition-all duration-300",
                        st === "active" && "bg-accent text-white shadow-[0_12px_32px_-12px_rgb(var(--c-accent)/0.8)] dark:shadow-[0_0_44px_-6px_rgb(var(--c-accent)/0.95)]",
                        st === "done" && "bg-ink/[0.06] text-ink ring-1 ring-ink/10",
                        st === "planned" && "lp-hatch text-ink3 ring-1 ring-ink/[0.08]")}>
                      {st === "active" && <span aria-hidden className="lp-shimmer absolute inset-y-0 left-0 w-1/3" />}
                      <Icon size={16} strokeWidth={1.75} className="relative shrink-0" />
                      <span className="relative min-w-0 flex-1 leading-tight">
                        <span className="block font-mono text-[10px] uppercase tracking-[0.14em]">{stageCode(s)}</span>
                        <span className="block truncate text-[14px] font-medium">{stageLabel(s)}</span>
                      </span>
                      <span aria-hidden className={cn("relative flex h-7 max-w-[46%] shrink-0 items-center gap-1.5 rounded-xl px-2 text-[11px] font-medium transition-all duration-300",
                        written ? "lp-proof bg-ink text-canvas" : st === "active" ? "border border-dashed border-white/60 text-white" : "border border-dashed border-ink/15 text-ink3")}>
                        <FileCheck2 size={12} strokeWidth={2} className="shrink-0" />
                        <span className="truncate">{s.artifact}</span>
                      </span>
                    </li>
                  );
                })}
              </ol>
              <NowBar now={now} compact />
            </div>

            {/* desktops (from 1280 px, where every step fits): the editor's timeline, left to right */}
            <div className="scroll-thin hidden overflow-x-auto rounded-card xl:block">
            <div className="relative min-w-[980px] p-5 md:p-6">
              <TopBar now={now} />

              <div className="relative">
              <div className="grid grid-cols-[120px_minmax(0,1fr)] gap-x-4">
                {/* ruler */}
                <div />
                <div aria-hidden className="relative grid grid-cols-8 border-b border-line pb-2 font-mono text-[10px] uppercase tracking-[0.14em] text-ink3">
                  {STAGES.map((s) => (
                    <span key={s.id} className="relative pl-2">
                      <span className="absolute bottom-[-9px] left-0 h-2 w-px bg-ink/20" />
                      {stageCode(s)}
                    </span>
                  ))}
                </div>

                {/* track: stages */}
                <TrackLabel>{t("landing.line.trackStages", "Stages")}</TrackLabel>
                <ol className="grid grid-cols-8 gap-2 py-2" aria-label={t("landing.stages.listAria", "The factory's stages, from plan to release")}>
                  {STAGES.map((s, i) => {
                    const st = state(i);
                    const Icon = ICON[s.id];
                    return (
                      <li key={s.id} aria-label={stageAria(s)}
                        className={cn("relative flex h-[88px] flex-col justify-between overflow-hidden rounded-block p-3 transition-all duration-300",
                          st === "active" && "bg-accent text-white shadow-[0_12px_32px_-12px_rgb(var(--c-accent)/0.8)] dark:shadow-[0_0_44px_-6px_rgb(var(--c-accent)/0.95)]",
                          st === "done" && "bg-ink/[0.06] text-ink ring-1 ring-ink/10",
                          st === "planned" && "lp-hatch text-ink3 ring-1 ring-ink/[0.08]")}>
                        {st === "active" && <span aria-hidden className="lp-shimmer absolute inset-y-0 left-0 w-1/3" />}
                        <span className="relative flex items-center justify-between">
                          <Icon size={16} strokeWidth={1.75} />
                          {st === "done" && <Check size={14} strokeWidth={1.75} className="text-ink2" />}
                        </span>
                        <span className="relative leading-tight">
                          <span className="block font-mono text-[10px] uppercase tracking-[0.14em]">{stageCode(s)}</span>
                          <span className="block truncate text-[13px] font-medium">{stageLabel(s)}</span>
                        </span>
                      </li>
                    );
                  })}
                </ol>

                {/* track: proof */}
                <TrackLabel>{t("landing.line.trackProof", "Proof")}</TrackLabel>
                <div className="grid grid-cols-8 gap-2 py-2" aria-hidden>
                  {STAGES.map((s, i) => {
                    const written = i < shownActive;
                    return (
                      <span key={s.id} className={cn("flex h-9 items-center gap-1.5 rounded-xl px-2.5 text-[11px] font-medium transition-all duration-300",
                        written ? "lp-proof bg-ink text-canvas" : "border border-dashed border-ink/15 text-ink3")}>
                        <FileCheck2 size={12} strokeWidth={2} className="shrink-0" />
                        <span className="truncate">{s.artifact}</span>
                      </span>
                    );
                  })}
                </div>
              </div>

              {/* the playhead */}
              {!reduced && (
                <div aria-hidden className="pointer-events-none absolute inset-y-0 left-[136px] right-0 overflow-hidden">
                  <div ref={head} className="h-full w-full will-change-transform">
                    <div className="relative ml-[5px] h-full w-px bg-accent shadow-[0_0_14px_rgb(var(--c-accent))]">
                      <span className="absolute -left-[5px] top-0 h-3 w-[11px] rounded-[3px] bg-accent" />
                    </div>
                  </div>
                </div>
              )}
              </div>

              <NowBar now={now} />
            </div>
            </div>
          </div>
        </Reveal>

        {/* quality, kept automatically */}
        <div className="mt-16 grid gap-10 border-t border-line pt-12 md:grid-cols-3">
          {rules().map((r, i) => (
            <Reveal key={r.title} delay={i * 110}><Feature {...r} /></Reveal>
          ))}
        </div>
        <Reveal delay={120} className="mt-12">
          <p className="flex items-center gap-3 text-[15px] font-medium text-ink">
            <ShieldCheck size={18} strokeWidth={1.75} className="text-accent" />
            {t("landing.line.nothingGoesLive", "Nothing goes live until every check passes.")}
          </p>
        </Reveal>
      </Container>
    </Section>
  );
}

function TrackLabel({ children }: { children: string }) {
  return (
    <div className="flex items-center font-mono text-[10.5px] font-medium uppercase tracking-[0.16em] text-ink3">{children}</div>
  );
}

/** the editor's top bar: what the line is, and the step at work */
function TopBar({ now }: { now: StageDef | null }) {
  const t = useT();
  return (
    <div className="mb-4 flex items-center gap-3 text-[12px] text-ink3">
      <span className="flex gap-1.5" aria-hidden><span className="h-2.5 w-2.5 rounded-full bg-ink/15" /><span className="h-2.5 w-2.5 rounded-full bg-ink/15" /><span className="h-2.5 w-2.5 rounded-full bg-ink/15" /></span>
      <span className="font-medium text-ink">{t("landing.line.productionLine", "Production line")}</span>
      <span className="hidden sm:inline">{t("landing.line.productionLineSub", "· one feature, from scope to production")}</span>
      <span className="ml-auto flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.14em]" aria-hidden>
        <span className={cn("h-1.5 w-1.5 rounded-full", now ? "bg-accent shadow-[0_0_10px_rgb(var(--c-accent))]" : "bg-landing-pass")} />
        {now ? t("landing.line.working", "{code} · working", { code: stageCode(now) }) : t("landing.line.live", "Live")}
      </span>
    </div>
  );
}

const liveText = () => t("landing.line.liveText", "Live on SELISE Blocks, with a proof document from every stage.");

/** what is happening now, in plain words: on one line on desktops; in the compact list it wraps, over a stack of every
 *  possible text (invisible), so the bar keeps the height of the longest and nothing below it jumps between steps */
function NowBar({ now, compact }: { now: StageDef | null; compact?: boolean }) {
  const t = useT();
  const text = now ? stagePlain(now) : liveText();
  const nowTexts = [...STAGES.map(stagePlain), liveText()];
  return (
    <div aria-hidden className={cn("flex min-h-[44px] items-center rounded-block bg-ink/[0.04] px-4 py-3 text-[13px] text-ink2 ring-1 ring-ink/[0.06]",
      compact ? "mt-4 flex-wrap gap-x-3 gap-y-1.5" : "mt-5 gap-3")}>
      {now ? (
        <>
          <span className="rounded-full bg-accent px-2 py-0.5 font-mono text-[10px] font-medium uppercase text-white">{stageCode(now)}</span>
          <span className="font-medium text-ink">{stageLabel(now)}</span>
        </>
      ) : (
        <>
          <span className="rounded-full bg-success-soft px-2 py-0.5 font-mono text-[10px] font-medium uppercase text-success">{t("landing.line.live", "Live")}</span>
          <span className="font-medium text-ink">{t("landing.line.everyCheckPassed", "Every check passed.")}</span>
        </>
      )}
      {compact ? (
        <span className="grid basis-full leading-relaxed">
          {nowTexts.map((line) => <span key={line} className={cn("col-start-1 row-start-1", line !== text && "invisible")}>{line}</span>)}
        </span>
      ) : (
        <span className="truncate">{text}</span>
      )}
    </div>
  );
}
