/** 05 · Built on SELISE Blocks: one workstation for the whole lifecycle, Blocks IAM sign-in by invitation,
 *  security gates, data and functions, nothing to install. The stack in the theme's colours: the factory (a stage surface,
 *  dark in both themes, with its accent mark), its AI agents (a card), the platform (the outlined base). */
import { Database, Globe, KeyRound, ShieldCheck } from "lucide-react";
import { STAGES } from "@/data/pipeline";
import { t, useT } from "@/i18n";
import { Logo } from "@/ui/Shell";
import { Container, Feature, Section, SectionHeader, rich, stageLabel } from "./parts";
import { Reveal } from "./motion";

const features = () => [
  { icon: Globe, title: t("landing.platform.f1Title", "Nothing to install"), text: t("landing.platform.f1Text", "Open a browser and start. The whole lifecycle lives in one workstation.") },
  { icon: KeyRound, title: t("landing.platform.f2Title", "Sign in by invitation"), text: t("landing.platform.f2Text", "Accept your invitation and sign in through Blocks IAM. Roles decide what each person can do.") },
  { icon: ShieldCheck, title: t("landing.platform.f3Title", "Security gates"), text: t("landing.platform.f3Text", "A security scan and a penetration test stand between every build and its release.") },
  { icon: Database, title: t("landing.platform.f4Title", "Data and functions"), text: t("landing.platform.f4Text", "Your records live in SELISE Blocks, and every change goes through its logic functions.") },
];

function Flow() {
  return (
    <div aria-hidden className="relative mx-auto h-10 w-px bg-line">
      <span className="lp-flow lp-dot absolute -left-[3px] top-0 h-[7px] w-[7px] rounded-full bg-accent shadow-[0_0_10px_rgb(var(--c-accent))]" />
    </div>
  );
}

function Stack() {
  const t = useT();
  const stages = STAGES.filter((s) => s.id !== "deploy");
  return (
    <div className="relative isolate mx-auto w-full max-w-[580px]">
      <div aria-hidden className="lp-glow lp-glow-halo absolute inset-x-10 -inset-y-6 -z-10 rounded-[48px] bg-[radial-gradient(60%_50%_at_50%_45%,rgb(var(--c-accent)/0.14),transparent_70%)]" />
      {/* the factory */}
      <Reveal className="rounded-card bg-stage p-6 text-white shadow-float ring-1 ring-white/10">
        <div className="flex items-center gap-4">
          <span className="shrink-0 rounded-[14px] shadow-[0_8px_28px_-8px_rgb(var(--c-accent)/0.9)]"><Logo size={44} /></span>
          <div>
            <div className="text-[18px] font-medium tracking-tight">MADP Factory</div>
            <div className="text-[13px] text-white/70">{t("landing.platform.factoryText", "Briefs, specifications, live builds, showcase reports")}</div>
          </div>
        </div>
      </Reveal>
      <Flow />
      {/* the MADP agents, stage by stage */}
      <Reveal delay={120} className="lp-card rounded-card bg-surface p-6 shadow-card dark:border dark:border-line">
        <div className="flex items-center justify-between">
          <div className="text-[18px] font-medium tracking-tight">{t("landing.platform.agents", "Autonomous MADP agents")}</div>
          <span className="font-mono text-[11px] uppercase tracking-[0.14em] text-ink3">{t("landing.platform.stageByStage", "Stage by stage")}</span>
        </div>
        <ol className="mt-4 grid grid-cols-7 gap-1.5" aria-label={t("landing.stages.listAria", "The factory's stages, from plan to release")}>
          {stages.map((s) => (
            <li key={s.id} title={t("landing.platform.stageAria", "Stage {code}: {name}", { code: s.id, name: stageLabel(s) })}
              aria-label={t("landing.platform.stageAria", "Stage {code}: {name}", { code: s.id, name: stageLabel(s) })}
              className="grid h-9 place-items-center rounded-xl bg-surface2 font-mono text-[11px] font-medium text-ink2">{s.id}</li>
          ))}
        </ol>
      </Reveal>
      <Flow />
      {/* the platform */}
      <Reveal delay={240} className="lp-base rounded-card p-6 text-ink ring-1 ring-ink/15">
        <div className="flex items-center justify-between">
          <div className="text-[18px] font-medium tracking-tight">SELISE Blocks</div>
          <span className="flex items-center gap-1.5 text-[12px] text-ink3"><span className="h-1.5 w-1.5 rounded-full bg-landing-pass" /> Blocks OS</span>
        </div>
        <div className="mt-4 grid grid-cols-3 gap-2 text-[12px] font-medium">
          {["Blocks IAM", t("landing.platform.data", "Data"), t("landing.platform.functions", "Functions")].map((part) => (
            <span key={part} className="lp-card rounded-xl bg-surface px-3 py-2.5 text-center text-ink2 shadow-card ring-1 ring-line">{part}</span>
          ))}
        </div>
      </Reveal>
    </div>
  );
}

export function Platform() {
  const t = useT();
  return (
    <Section id="platform">
      <Container className="grid items-center gap-16 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] xl:gap-24">
        <div>
          <SectionHeader id="platform" n="05" eyebrow={t("landing.nav.platform", "Platform")}
            title={rich(t("landing.platform.title", "Built on SELISE Blocks, {dim}"), { dim: <span className="lp-dim text-ink3">{t("landing.platform.titleDim", "end to end.")}</span> })}
            lede={t("landing.platform.lede", "One workstation for the whole software lifecycle. No setup, nothing to install: accept your invitation and build on SELISE Blocks.")} />
          <ul className="mt-12 grid gap-x-8 gap-y-9 sm:grid-cols-2">
            {features().map((f, i) => (
              <Reveal as="li" key={f.title} delay={160 + i * 80}><Feature {...f} /></Reveal>
            ))}
          </ul>
        </div>
        <Stack />
      </Container>
    </Section>
  );
}
