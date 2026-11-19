/** The cinematic opening: a full-width, full-height stage on the page canvas with a 3D concept scene (lazy), the
 *  headline, the two actions and a legend that names the station the story is passing. Neon light on
 *  the dark canvas with a film-grain finish. It is ALWAYS the dark neon stage, in light and in dark mode
 *  (owner 18.10.2026): the section carries data-theme="dark", so the tokens resolve to their dark values inside it, and
 *  the scene gets the fixed dark canvas, so a theme switch never touches it.
 *  The homepage shows the Story concept; the sample pages (/samples/foundry|blueprint|line, linked in the footer)
 *  are the same page with one of the alternative concepts. */
import { Suspense, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type RefObject } from "react";
import { Link, useParams } from "react-router-dom";
import { ArrowDown, ArrowRight } from "lucide-react";
import { ConceptScene } from "@/madp/components/hero/ConceptScene";
import { DEFAULT_CONCEPT, isConcept, type ConceptId } from "@/madp/components/hero/types";
import { useT } from "@/madp/i18n";
import { LEGEND, legendFraction, legendLabel } from "./heroLine";
import { scrollToId, useInView, usePageVisible, useReducedMotion } from "./motion";
import { rich } from "./parts";
import { FlatLine, SceneBoundary, grain, useCanvasTheme, webglAvailable } from "./stage";

function Legend({ listRef, fillRef }: { listRef: RefObject<HTMLOListElement | null>; fillRef: RefObject<HTMLSpanElement | null> }) {
  useT();
  return (
    <div className="relative w-full max-w-[860px]">
      <div aria-hidden className="absolute left-[5%] right-[5%] top-[5px] h-px bg-ink/15">
        <span ref={fillRef} className="block h-full w-full origin-left bg-accent" style={{ transform: "scaleX(0)" }} />
      </div>
      <ol ref={listRef} className="relative grid grid-cols-10" aria-label={legendLabel()}>
        {LEGEND.map((s, i) => (
          <li key={s.label} data-state={i === 0 ? "active" : "idle"}
            className="lp-legend-item flex flex-col items-center gap-2.5 text-center text-ink/55 data-[state=active]:text-ink data-[state=done]:text-ink/70">
            <span className="lp-legend-dot block h-[11px] w-[11px] rounded-full border border-ink/25 bg-canvas" />
            <span className="font-mono text-[10px] uppercase tracking-[0.14em]">{s.phase}</span>
            <span className="-mt-1.5 px-0.5 text-[12px] font-medium tracking-tight">{s.label}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}

export function Hero() {
  const t = useT();
  const reduced = useReducedMotion();
  const visible = usePageVisible();
  const [stageRef, inView] = useInView<HTMLElement>("0px");
  const { canvas, light } = useCanvasTheme("dark");
  const param = useParams().concept ?? null;
  const concept: ConceptId = isConcept(param) ? param : DEFAULT_CONCEPT;
  const [has3d] = useState(webglAvailable);
  const [ready, setReady] = useState(false);
  /* a new concept fades in again over the poster (reset during render, before the new scene can report ready) */
  const [readyConcept, setReadyConcept] = useState(concept);
  if (readyConcept !== concept) {
    setReadyConcept(concept);
    setReady(false);
  }
  const onReady = useCallback(() => setReady(true), []);
  const listRef = useRef<HTMLOListElement>(null);
  const fillRef = useRef<HTMLSpanElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const lineRef = useRef<HTMLSpanElement>(null);
  const lastIndex = useRef(0);
  const [textEdge, setTextEdge] = useState(0.64);
  const grainBg = useMemo(() => grain(), []);

  /** the scene tells the legend which station the pulse is in (DOM only, no re-render) */
  const onProgress = useCallback((index: number, head: number) => {
    const list = listRef.current;
    if (list && index !== lastIndex.current) {
      lastIndex.current = index;
      Array.from(list.children).forEach((li, k) => li.setAttribute("data-state", k < index ? "done" : k === index ? "active" : "idle"));
    }
    if (fillRef.current) fillRef.current.style.transform = `scaleX(${legendFraction(head)})`;
  }, []);

  /* where the headline ends (fraction of the stage width): the line's vanishing point keeps clear of it */
  useEffect(() => {
    const stageEl = stageRef.current;
    const line = lineRef.current;
    if (!stageEl || !line) return;
    const measure = () => {
      const st = stageEl.getBoundingClientRect();
      const l = line.getBoundingClientRect();
      if (st.width > 0) setTextEdge(Math.round(((l.right - st.left) / st.width) * 100) / 100);
    };
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(measure);
    ro.observe(stageEl);
    ro.observe(line);
    return () => ro.disconnect();
  }, [stageRef]);

  /* every concept starts its story at the brief; without 3D the legend shows the finished line */
  useLayoutEffect(() => {
    lastIndex.current = -1;
    if (has3d) onProgress(0, 0);
    else onProgress(LEGEND.length - 1, 1);
  }, [concept, has3d, onProgress]);

  /* scrolling away: the headline lifts and fades a little, like a camera pulling up. The words also fade out through
     a soft clear band at the top of the window, so they never slide in behind the bar's logo and links */
  useEffect(() => {
    if (reduced) return;
    let raf = 0;
    const on = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        const el = contentRef.current;
        const stage = stageRef.current;
        if (!el || !stage) return;
        const p = Math.min(1, Math.max(0, window.scrollY / (window.innerHeight * 0.9)));
        const lift = p * 70;
        el.style.transform = p > 0 ? `translate3d(0, ${(-lift).toFixed(1)}px, 0)` : "";
        el.style.opacity = p > 0 ? String(Math.max(0, 1 - p * 1.25)) : "";
        /* fully faded out: also out of the tab order */
        el.style.visibility = p > 0 && 1 - p * 1.25 <= 0 ? "hidden" : "";
        /* the band, in the words' own coordinates: clear above 60px from the top of the window, solid below 140px */
        const top = lift - stage.getBoundingClientRect().top;
        const mask = p > 0 ? `linear-gradient(180deg, transparent ${(top + 60).toFixed(0)}px, #000 ${(top + 140).toFixed(0)}px)` : "";
        el.style.setProperty("-webkit-mask-image", mask);
        el.style.setProperty("mask-image", mask);
      });
    };
    window.addEventListener("scroll", on, { passive: true });
    return () => {
      window.removeEventListener("scroll", on);
      cancelAnimationFrame(raf);
      const el = contentRef.current;
      if (el) {
        el.style.transform = "";
        el.style.opacity = "";
        el.style.visibility = "";
        el.style.removeProperty("-webkit-mask-image");
        el.style.removeProperty("mask-image");
      }
    };
  }, [reduced, stageRef]);

  return (
    <section ref={stageRef} aria-labelledby="lp-hero-title" data-theme="dark"
      className="relative h-[100svh] min-h-[620px] overflow-hidden bg-canvas text-ink">
      {/* the stage: poster first, the 3D line fades in over it */}
      <div aria-hidden className="lp-hero-poster absolute inset-0" />
      {has3d ? (
        <div key={concept} aria-hidden className="lp-canvas absolute inset-0" data-ready={ready}>
          <SceneBoundary fallback={<FlatLine />}>
            <Suspense fallback={null}>
              <ConceptScene concept={concept} active={inView && visible} still={reduced} canvas={canvas} light={light}
                textEdge={textEdge} onReady={onReady} onProgress={onProgress} />
            </Suspense>
          </SceneBoundary>
        </div>
      ) : <FlatLine />}
      <div aria-hidden className="lp-hero-shade pointer-events-none absolute inset-0"
        style={grainBg && !light ? { ["--lp-grain" as string]: `url(${grainBg})` } : undefined} />

      {/* the words */}
      <div ref={contentRef} className="relative z-10 mx-auto flex h-full w-full max-w-[1480px] flex-col justify-center px-6 pb-28 pt-24 md:px-10 xl:px-14">
        <div className="max-w-full">
          <div className="lp-in flex flex-wrap items-center gap-3 text-[13px] text-ink/60" style={{ ["--lp-d" as string]: "150ms" }}>
            <span className="lp-frost inline-flex items-center gap-2 rounded-full bg-ink/[0.06] px-3 py-1.5 font-medium text-ink/80 ring-1 ring-ink/10 backdrop-blur-sm">
              <span className="relative grid h-2 w-2 place-items-center">
                <span className="lp-ping absolute h-2 w-2 rounded-full bg-accent" />
                <span className="relative h-1.5 w-1.5 rounded-full bg-accent" />
              </span>
              {t("landing.common.tagline", "Autonomous software factory")}
            </span>
            <span>{t("landing.hero.where", "Cloud and hybrid, on SELISE Blocks")}</span>
          </div>
          <h1 id="lp-hero-title" className="lp-in lp-headline mt-7 text-[clamp(2.5rem,4.3vw,6rem)] font-medium leading-[0.98] tracking-[-0.045em]"
            style={{ ["--lp-d" as string]: "300ms" }}>
            <span ref={lineRef} className="block w-fit max-w-full">
              {rich(t("landing.hero.line1", "From idea to {word}."), { word: <span className="lp-word-grad">{t("landing.hero.line1Word", "production")}</span> })}
            </span>
            <span className="block w-fit max-w-full">
              {rich(t("landing.hero.line2", "The complete {word}."), {
                word: <abbr title={t("landing.hero.sdlcTitle", "software development lifecycle")} className="no-underline"><span className="lp-word-grad">SDLC</span></abbr>,
              })}
            </span>
            <span className="block w-fit max-w-full">
              {rich(t("landing.hero.line3", "Every stage {word}."), { word: <span className="lp-word-grad">{t("landing.hero.line3Word", "verified")}</span> })}
            </span>
          </h1>
          <p className="lp-in mt-5 max-w-[600px] text-[clamp(1.05rem,1.15vw,1.25rem)] leading-relaxed text-ink/65" style={{ ["--lp-d" as string]: "520ms" }}>
            <span className="text-ink/90">{t("landing.hero.ledeLead", "Run by autonomous MADP agents.")}</span>{" "}
            {t("landing.hero.lede", "Every app is planned, built, reviewed, tested, secured and released on SELISE Blocks, with quality gates at every step and industry-grade results.")}
          </p>
          <div className="lp-in mt-10 flex flex-wrap items-center gap-3" style={{ ["--lp-d" as string]: "700ms" }}>
            <Link to="/sign-in"
              className="group inline-flex h-12 items-center gap-2 rounded-full bg-accent pl-6 pr-5 text-[15px] font-medium text-white shadow-[0_10px_40px_-10px_rgb(var(--c-accent)/0.8)] transition hover:bg-accent-hover">
              {t("landing.cta.startBuilding", "Start building")}
              <ArrowRight size={18} strokeWidth={1.75} className="transition-transform group-hover:translate-x-0.5" />
            </Link>
            <button type="button" onClick={() => scrollToId("how")}
              className="lp-frost inline-flex h-12 items-center gap-2 rounded-full bg-ink/[0.06] pl-6 pr-5 text-[15px] font-medium text-ink ring-1 ring-ink/15 backdrop-blur-sm transition hover:bg-ink/[0.12]">
              {t("landing.hero.seeItShip", "See it ship")}
              <ArrowDown size={17} strokeWidth={1.75} />
            </button>
          </div>
        </div>
      </div>

      {/* bottom: scroll cue and the legend of the line */}
      <div className="lp-in absolute inset-x-0 bottom-0 z-10 mx-auto flex w-full max-w-[1480px] items-end justify-between gap-10 px-6 pb-8 md:px-10 xl:px-14"
        style={{ ["--lp-d" as string]: "1000ms" }}>
        <button type="button" onClick={() => scrollToId("problem")} aria-label={t("landing.hero.scrollAria", "Scroll to the next section")}
          className="group hidden shrink-0 items-center gap-3 text-[12px] font-medium uppercase tracking-[0.18em] text-ink/60 transition hover:text-ink/80 lg:flex">
          <span className="relative block h-10 w-px overflow-hidden bg-ink/15">
            <span className="lp-cue-line absolute inset-0 bg-ink/80" />
          </span>
          {t("landing.hero.scroll", "Scroll")}
        </button>
        <div className="hidden min-w-0 flex-1 justify-end md:flex">
          <Legend listRef={listRef} fillRef={fillRef} />
        </div>
      </div>
    </section>
  );
}
