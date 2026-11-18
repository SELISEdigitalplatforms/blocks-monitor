/** 01 · The problem: software moves at the speed of handovers. Backlogs outgrow teams, every handover adds a queue and
 *  quality is checked too late. One contrast, drawn without figures: the usual relay of teams against one flow through
 *  the factory. */
import { Fragment } from "react";
import { ArrowLeftRight, Clock3, UsersRound } from "lucide-react";
import { t, useT } from "@/madp/i18n";
import { Container, Eyebrow, Section, rich } from "./parts";
import { Reveal } from "./motion";

const pains = () => [
  { icon: UsersRound, title: t("landing.problem.pain1Title", "Backlogs outgrow teams"), text: t("landing.problem.pain1Text", "Ideas arrive faster than any team can build them. Stop choosing what to drop.") },
  { icon: ArrowLeftRight, title: t("landing.problem.pain2Title", "Every handover adds a queue"), text: t("landing.problem.pain2Text", "Analysis, development, testing, operations: each waits for the last. Remove the waiting.") },
  { icon: Clock3, title: t("landing.problem.pain3Title", "Quality is checked too late"), text: t("landing.problem.pain3Text", "Late checks make fixes costly. Verify at every stage instead.") },
];

/** the usual relay, team by team */
const usualTeams = () => [
  t("landing.problem.teamProduct", "Product"),
  t("landing.problem.teamAnalyst", "Analyst"),
  t("landing.problem.teamDeveloper", "Developer"),
  t("landing.problem.teamTester", "Tester"),
  t("landing.problem.teamOperations", "Operations"),
];

export function Problem() {
  const t = useT();
  const usual = usualTeams();
  return (
    <Section id="problem">
      <Container className="grid items-center gap-16 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.04fr)] xl:gap-24">
        <div>
          <Reveal><Eyebrow n="01">{t("landing.problem.eyebrow", "The problem")}</Eyebrow></Reveal>
          <Reveal delay={80}>
            <h2 id="problem-title" className="mt-6 text-[clamp(2.4rem,4.2vw,4.6rem)] font-medium leading-[1.0] tracking-[-0.04em] [text-wrap:balance]">
              {rich(t("landing.problem.title", "Ideas stall {dim}"), { dim: <span className="lp-dim text-ink3">{t("landing.problem.titleDim", "in a queue.")}</span> })}
            </h2>
          </Reveal>
          <Reveal delay={160}>
            <p className="mt-6 max-w-[560px] text-[clamp(1.05rem,1.15vw,1.25rem)] leading-relaxed text-ink2 [text-wrap:pretty]">
              {t("landing.problem.lede", "Handovers set the pace, and ideas wait their turn. Skip the queue and reach production in days, not months.")}
            </p>
          </Reveal>
          <ul className="mt-12 space-y-3">
            {pains().map(({ icon: Icon, title, text }, i) => (
              <Reveal as="li" key={title} delay={220 + i * 90}
                className="lp-card flex items-start gap-4 rounded-block bg-surface px-5 py-4 shadow-card dark:border dark:border-line">
                <span className="lp-card grid h-11 w-11 shrink-0 place-items-center rounded-full bg-surface text-ink shadow-card dark:border dark:border-line"><Icon size={18} strokeWidth={1.75} /></span>
                <span>
                  <span className="block text-[18px] font-medium tracking-tight">{title}</span>
                  <span className="mt-1 block text-[15px] leading-relaxed text-ink2">{text}</span>
                </span>
              </Reveal>
            ))}
          </ul>
        </div>

        <Reveal delay={200} className="relative isolate">
          <div aria-hidden className="lp-glow lp-glow-halo absolute -inset-6 -z-10 rounded-[40px] bg-[radial-gradient(60%_60%_at_70%_40%,rgb(var(--c-accent)/0.12),transparent_70%)]" />
          <article aria-labelledby="problem-contrast" className="lp-panel rounded-card bg-surface p-8 shadow-float dark:border dark:border-line md:p-10">
            <h3 id="problem-contrast" className="text-[18px] font-medium tracking-tight">{t("landing.problem.contrastTitle", "From idea to production")}</h3>

            <div className="mt-10">
              <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                <span className="text-[15px] text-ink2">{t("landing.problem.usualWay", "The usual way")}</span>
                <span className="text-[14px] text-ink3">{t("landing.problem.usualCount", "{teams} teams, {handovers} handovers", { teams: usual.length, handovers: usual.length - 1 })}</span>
              </div>
              <div aria-hidden className="lp-relay-wrap mt-4">
                <div className="lp-relay">
                  {usual.map((team, i) => (
                    <Fragment key={team}>
                      {i > 0 && <span className="lp-queue" />}
                      <span className="shrink-0 rounded-full bg-surface2 px-3 py-1.5 text-[12px] font-medium text-ink2 ring-1 ring-inset ring-line">{team}</span>
                    </Fragment>
                  ))}
                </div>
              </div>
              <p className="sr-only">{usual.join(t("landing.problem.thenSeparator", ", then "))}.</p>
            </div>

            <div className="mt-10">
              <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                <span className="text-[15px] font-medium text-ink">{t("landing.problem.withFactory", "With MADP Factory")}</span>
                <span className="text-[14px] font-medium text-accent">{t("landing.problem.oneFlow", "One flow, no queues")}</span>
              </div>
              <div aria-hidden className="mt-4 flex items-center gap-1.5">
                <span className="shrink-0 rounded-full bg-ink px-3 py-1.5 text-[12px] font-medium text-canvas">{t("landing.problem.you", "You")}</span>
                <span className="relative h-1.5 min-w-8 flex-1 overflow-hidden rounded-full bg-surface2">
                  <span className="lp-grow absolute inset-0 rounded-full bg-accent shadow-[0_0_24px_rgb(var(--c-accent)/0.6)]" style={{ ["--lp-i" as string]: 1 }} />
                  <span className="lp-sweep absolute inset-y-0 left-0 w-1/4 bg-white/60 blur-[2px] motion-reduce:hidden" />
                </span>
                <span className="shrink-0 rounded-full bg-accent px-3 py-1.5 text-[12px] font-medium text-white">{t("landing.problem.liveApp", "Live app")}</span>
              </div>
              <p className="sr-only">{t("landing.problem.flowRead", "You, then the factory, then the live app.")}</p>
            </div>

            <p className="mt-10 border-t border-line pt-5 text-[13px] leading-relaxed text-ink3 [text-wrap:pretty]">
              {t("landing.problem.inBetween", "In between, MADP agents plan, code, review, test, secure, document and release it, on their own. Every stage is verified.")}
            </p>
          </article>
        </Reveal>
      </Container>
    </Section>
  );
}
