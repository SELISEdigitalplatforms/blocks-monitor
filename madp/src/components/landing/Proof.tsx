/** 04 · Every stage leaves proof: the proof documents (the audit trail) and PrimaBook as the reference build. No
 *  measured figures are shown until they come from real records. On the page canvas in the theme's colours. */
import { FileCheck2, Link2 } from "lucide-react";
import { STAGES } from "@/data/pipeline";
import { useT } from "@/i18n";
import { cn } from "@/lib/cn";
import { Container, Section, SectionHeader, rich, stageCode } from "./parts";
import { Reveal } from "./motion";

/** the proof documents fanned out behind the smoke test, which stands upright in front. The fan turns about a
 *  point far below, so each document behind shows its corner with its code, and no title is ever cut */
function ProofFan() {
  const t = useT();
  const last = STAGES.length - 1;
  return (
    <div aria-hidden className="relative mx-auto h-[272px] w-[min(460px,90vw)]">
      {STAGES.map((s, i) => {
        const front = i === last;
        return (
          <div key={s.id} className="lp-fan absolute bottom-[78px] left-[calc(50%+92px)] -ml-[70px] h-[190px] w-[140px] origin-[50%_160%]"
            style={{ ["--lp-r" as string]: `${(i - last) * 6}deg`, ["--lp-i" as string]: i, zIndex: i }}>
            <div className={cn("flex h-full flex-col rounded-block p-3.5 shadow-float ring-1",
              front ? "bg-accent text-white ring-accent" : "bg-surface text-ink ring-line")}>
              <div className="flex items-center justify-between">
                <span className={cn("font-mono text-[10px] uppercase tracking-wider", front ? "text-white" : "text-ink3")}>{stageCode(s)}</span>
                <FileCheck2 size={15} strokeWidth={1.75} className={front ? "text-white" : "text-accent"} />
              </div>
              {front && <div className="mt-3 text-[14px] font-medium tracking-tight">{s.artifact}</div>}
              <div className="mt-3 space-y-1.5">
                <div className={cn("h-1 rounded-full", front ? "bg-white/50" : "bg-ink3/25")} style={{ width: "92%" }} />
                <div className={cn("h-1 rounded-full", front ? "bg-white/35" : "bg-ink3/20")} style={{ width: "74%" }} />
                <div className={cn("h-1 rounded-full", front ? "bg-white/35" : "bg-ink3/20")} style={{ width: "84%" }} />
              </div>
              {front && (
                <div className="mt-auto flex items-center gap-1 text-[10px] font-medium text-white">
                  <Link2 size={10} strokeWidth={2} /> {t("landing.proof.linkedToSource", "Linked to source")}
                </div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

export function Proof() {
  const t = useT();
  return (
    <Section id="proof">
      <Container>
        <div className="grid items-center gap-12 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
          <SectionHeader id="proof" n="04" eyebrow={t("landing.nav.proof", "Proof")}
            title={rich(t("landing.proof.title", "Every stage {dim}"), { dim: <span className="lp-dim text-ink3">{t("landing.proof.titleDim", "earns its proof.")}</span> })}
            lede={t("landing.proof.lede", "Every stage writes its proof document, every requirement cites its source, and every gate result is kept. See what was built, why, and how it was verified.")} />
          <Reveal delay={180}><ProofFan /></Reveal>
        </div>

        {/* the reference build: words and the app side by side on the canvas */}
        <Reveal delay={100} className="mt-20 border-t border-line pt-16">
          <article aria-labelledby="proof-primabook" className="grid items-center gap-12 lg:grid-cols-[1fr_1.1fr] xl:gap-20">
            <div>
              <div className="font-mono text-[12px] font-medium uppercase tracking-[0.16em] text-ink3">{t("landing.proof.referenceBuild", "Reference build")}</div>
              <h3 id="proof-primabook" className="mt-5 text-[clamp(1.5rem,2vw,2rem)] font-medium leading-tight tracking-tight">PrimaBook</h3>
              <p className="mt-4 max-w-md text-[17px] leading-relaxed text-ink2">
                {t("landing.proof.primaBookText", "A Swiss accounting app, built through MADP and live on SELISE Blocks.")}
              </p>
              <div className="mt-8 flex flex-wrap gap-2 text-[12px] font-medium text-ink2">
                {[
                  t("landing.proof.chipBuilt", "Built through MADP"),
                  t("landing.proof.chipRuns", "Runs on SELISE Blocks"),
                  t("landing.proof.chipSwiss", "Swiss accounting"),
                ].map((chip) => (
                  <span key={chip} className="lp-card rounded-full bg-surface px-3 py-1.5 ring-1 ring-line">{chip}</span>
                ))}
              </div>
            </div>
            <PrimaBookScreen />
          </article>
        </Reveal>
      </Container>
    </Section>
  );
}

/* the app's parts, as bar widths in % (bars stand in for every label and figure: the reference build carries no extra
   numbers) */
const PB_ACCOUNTS = [64, 78, 52, 70, 58, 46]; // the sidebar; the second account is open
const PB_FIGURES = [{ label: 58, value: 74 }, { label: 44, value: 62 }, { label: 66, value: 56 }];
const PB_CHART = [38, 52, 44, 66, 58, 74, 62, 86];
const PB_BOOKINGS = [{ text: 62, booked: true }, { text: 48, booked: false }, { text: 56, booked: true }, { text: 44, booked: false }];

/** an accounting app, drawn in code: its accounts, three key figures, the month's chart and the latest bookings */
function PrimaBookScreen() {
  const t = useT();
  return (
    <div aria-hidden className="relative isolate">
      <div className="lp-glow lp-glow-halo pointer-events-none absolute -inset-10 -z-10 rounded-full bg-[radial-gradient(closest-side,rgb(var(--c-accent)/0.12),transparent)] dark:bg-[radial-gradient(closest-side,rgb(var(--c-accent)/0.22),transparent)]" />
      <div className="lp-panel lp-float overflow-hidden rounded-card bg-surface shadow-float ring-1 ring-line">
        <div className="flex items-center gap-2 border-b border-line px-4 py-3">
          <span className="flex gap-1"><span className="h-2 w-2 rounded-full bg-ink/15" /><span className="h-2 w-2 rounded-full bg-ink/15" /><span className="h-2 w-2 rounded-full bg-ink/15" /></span>
          <span className="ml-2 text-[11px] font-medium text-ink3">{t("landing.proof.screenTitle", "PrimaBook · General ledger")}</span>
        </div>
        <div className="grid grid-cols-[28%_1fr] gap-4 p-4">
          {/* the accounts (the open one on a soft accent pill), and the VAT period at the foot */}
          <div className="flex flex-col gap-1">
            {PB_ACCOUNTS.map((w, i) => (
              <div key={i} className={cn("flex items-center gap-2 rounded-lg px-2 py-[7px]", i === 1 && "bg-accent-soft")}>
                <span className={cn("h-1.5 w-1.5 shrink-0 rounded-full", i === 1 ? "bg-accent" : "bg-ink/30 dark:bg-ink/20")} />
                <span className={cn("h-1.5 rounded-full", i === 1 ? "bg-accent" : "bg-ink/[0.16] dark:bg-ink/10")} style={{ width: `${w}%` }} />
              </div>
            ))}
            <div className="mt-auto rounded-lg p-2.5 ring-1 ring-inset ring-line">
              <div className="h-1 w-[62%] rounded-full bg-ink/20 dark:bg-ink/15" />
              <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-ink/[0.08]"><div className="h-full w-[68%] rounded-full bg-accent" /></div>
            </div>
          </div>
          <div className="flex min-w-0 flex-col gap-3">
            {/* three key figures */}
            <div className="grid grid-cols-3 gap-2">
              {PB_FIGURES.map((f, i) => (
                <div key={i} className="rounded-lg bg-surface2 px-2.5 py-2 ring-1 ring-inset ring-line">
                  <div className="h-1 rounded-full bg-ink/20 dark:bg-ink/15" style={{ width: `${f.label}%` }} />
                  <div className={cn("mt-2 h-2 rounded-full", i === 0 ? "bg-accent" : "bg-bar/50")} style={{ width: `${f.value}%` }} />
                </div>
              ))}
            </div>
            {/* the month's chart */}
            <div className="flex h-20 items-end gap-1.5 rounded-xl bg-surface2 p-3">
              {PB_CHART.map((h, i) => (
                <span key={i} className={cn("flex-1 rounded-sm", i === 7 ? "bg-accent" : "bg-bar/70")} style={{ height: `${h}%` }} />
              ))}
            </div>
            {/* the latest bookings: date, text, status (two already booked), amount */}
            <div>
              {PB_BOOKINGS.map((b, i) => (
                <div key={i} className="flex h-7 items-center gap-2.5 border-b border-line last:border-0">
                  <span className="h-1.5 w-[16%] shrink-0 rounded-full bg-ink/20 dark:bg-ink/15" />
                  <span className="flex min-w-0 flex-1"><span className="h-1.5 rounded-full bg-ink/[0.16] dark:bg-ink/10" style={{ width: `${b.text}%` }} /></span>
                  <span className="flex w-12 shrink-0 justify-end">
                    {b.booked && <span className="rounded-full bg-success-soft px-1.5 py-px text-[10px] font-medium leading-[14px] text-success">{t("landing.proof.booked", "Booked")}</span>}
                  </span>
                  <span className="h-1.5 w-[14%] shrink-0 rounded-full bg-ink/35 dark:bg-ink/25" />
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
