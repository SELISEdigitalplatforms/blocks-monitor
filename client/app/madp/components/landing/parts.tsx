/** Building blocks shared by the landing sections: page width, section frame, chapter header, the one feature-item
 *  style and the names of the line's steps. */
import { Fragment, type ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import type { StageDef } from "@/madp/data/pipeline";
import { t } from "@/madp/i18n";
import { cn } from "@/madp/lib/cn";
import { Reveal } from "./motion";

/** how every part of the page names a step of the line, like the hero's legend: its code ("01" … "07", "Blocks") and
 *  its stage name ("Plan" … "Release gate", "Release to development"), never a persona name; in the chosen language */
export const stageCode = (s: StageDef) => (s.id === "deploy" ? "Blocks" : s.id);
export function stageLabel(s: StageDef): string {
  switch (s.id) {
    case "01": return t("landing.stages.planName", "Plan");
    case "02": return t("landing.stages.buildName", "Build");
    case "03": return t("landing.stages.reviewName", "Review");
    case "04": return t("landing.stages.testName", "Test");
    case "05": return t("landing.stages.securityName", "Security");
    case "06": return t("landing.stages.docsName", "Docs");
    case "07": return t("landing.stages.gateName", "Release gate");
    case "deploy": return t("landing.stages.deployName", "Release to development");
    default: return s.name;
  }
}

/** what happens at a step, in plain words for a business user, in the chosen language */
export function stagePlain(s: StageDef): string {
  switch (s.id) {
    case "01": return t("landing.stages.planText", "Turns the confirmed scope into a step-by-step delivery plan.");
    case "02": return t("landing.stages.buildText", "Writes the app, test-first, screen by screen.");
    case "03": return t("landing.stages.reviewText", "Checks code quality and that everything in the scope is there.");
    case "04": return t("landing.stages.testText", "Runs every user story as an automated test.");
    case "05": return t("landing.stages.securityText", "Scans for security issues and runs a penetration test.");
    case "06": return t("landing.stages.docsText", "Writes the user guide and the technical documentation.");
    case "07": return t("landing.stages.gateText", "Checks every gate before the release and says OPEN or HOLD.");
    case "deploy": return t("landing.stages.deployText", "Each finished build goes online on the development environment as a preview to try; staging and production follow the project's approvals.");
    default: return s.plain;
  }
}

/** a translated sentence with marked places ("Ideas stall {dim}") filled with elements: the words around them stay in
 *  the order the language puts them */
export function rich(template: string, parts: Record<string, ReactNode>): ReactNode {
  const out: ReactNode[] = [];
  const re = /\{(\w+)\}/g;
  let last = 0;
  for (let m = re.exec(template); m; m = re.exec(template)) {
    if (!Object.prototype.hasOwnProperty.call(parts, m[1])) continue;
    if (m.index > last) out.push(template.slice(last, m.index));
    out.push(<Fragment key={out.length}>{parts[m[1]]}</Fragment>);
    last = m.index + m[0].length;
  }
  if (last < template.length) out.push(template.slice(last));
  return <>{out}</>;
}

/** the page column (the hero and the top bar line up with it) */
export function Container({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <div className={cn("mx-auto w-full max-w-[1480px] px-6 md:px-10 xl:px-14", className)}>
      {children}
    </div>
  );
}

/** a story chapter on the page canvas (never a band, an inset or a rounded panel), an anchor target with room around it,
 *  named by its own heading. lp-sec carries the section tones of both themes (landing.css). */
export function Section({ id, className, children }: { id: string; className?: string; children: ReactNode }) {
  return (
    <section id={id} aria-labelledby={`${id}-title`} tabIndex={-1}
      className={cn("lp-sec relative scroll-mt-24 py-20 outline-none md:py-28 xl:py-32", className)}>
      {children}
    </section>
  );
}

/** "02 · How it works" in the pro-tool mono voice, in the theme's colours */
export function Eyebrow({ n, children }: { n: string; children: ReactNode }) {
  return (
    <div className="flex items-center gap-3 font-mono text-[12px] font-medium uppercase tracking-[0.16em] text-ink3">
      <span className="num text-accent">{n}</span>
      <span className="h-px w-8 bg-line" />
      {children}
    </div>
  );
}

export function SectionHeader({ id, n, eyebrow, title, lede, className, aside }: {
  id: string; n: string; eyebrow: string; title: ReactNode; lede?: ReactNode; className?: string; aside?: ReactNode;
}) {
  return (
    <div className={cn("flex flex-wrap items-end justify-between gap-x-16 gap-y-8", className)}>
      <div className="min-w-0 max-w-[860px]">
        <Reveal><Eyebrow n={n}>{eyebrow}</Eyebrow></Reveal>
        <Reveal delay={80}>
          <h2 id={`${id}-title`} className="mt-6 text-[clamp(2.4rem,4.2vw,4.6rem)] font-medium leading-[1.0] tracking-[-0.04em] text-ink [text-wrap:balance]">
            {title}
          </h2>
        </Reveal>
        {lede && (
          <Reveal delay={160}>
            <p className="mt-6 max-w-[640px] text-[clamp(1.05rem,1.15vw,1.25rem)] leading-relaxed text-ink2 [text-wrap:pretty]">{lede}</p>
          </Reveal>
        )}
      </div>
      {/* beside the header while it fits; on its own line below it otherwise, where it may wrap within the width */}
      {aside && <Reveal delay={200} className="min-w-0">{aside}</Reveal>}
    </div>
  );
}

/** an icon, a title and a line of text: the one feature-item style of the page */
export function Feature({ icon: Icon, title, text }: { icon: LucideIcon; title: string; text: string }) {
  return (
    <>
      <span className="lp-card grid h-11 w-11 place-items-center rounded-full bg-surface text-ink shadow-card dark:border dark:border-line">
        <Icon size={18} strokeWidth={1.75} />
      </span>
      <h3 className="mt-5 text-[18px] font-medium tracking-tight text-ink">{title}</h3>
      <p className="mt-2 max-w-[360px] text-[15px] leading-relaxed text-ink2 [text-wrap:pretty]">{text}</p>
    </>
  );
}
