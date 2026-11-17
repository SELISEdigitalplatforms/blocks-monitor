import { STAGES } from "@/data/pipeline";
import { useReducedMotion } from "@/components/landing/motion";
import { stageLabel } from "@/components/landing/parts";
import { cn } from "@/lib/cn";
import { useT } from "@/i18n";

const COUNT = STAGES.length; // stations; the Live badge is the last point of the rail

/** The per-station keyframes (si-lc-N, si-lc-s-N) live in cinema.css, so each station lights as the pulse passes it. */
export function Lifecycle({ className }: { className?: string }) {
  const t = useT();
  const still = useReducedMotion();
  const stations = [...STAGES.map(stageLabel), t("auth.lifecycle.live", "Live")];

  return (
    <div aria-hidden="true" className={cn("si-lc relative", still && "si-lc-still", className)}>
      <div className="relative h-[104px] pr-[64px]">
        <div className="relative h-full">
          <svg className="absolute inset-x-0 top-1/2 h-10 w-full -translate-y-1/2 overflow-visible" viewBox="0 0 1000 40" preserveAspectRatio="none">
            <path d="M0 20H1000" pathLength={100} vectorEffect="non-scaling-stroke" fill="none" strokeWidth={2} strokeLinecap="round" stroke="rgb(var(--c-accent) / .25)" />
            <path className="si-lc-trail" d="M0 20H1000" pathLength={100} vectorEffect="non-scaling-stroke" fill="none" strokeWidth={2} strokeLinecap="round" stroke="rgb(var(--c-accent) / .6)" strokeDasharray="100 100" strokeDashoffset={still ? 0 : 100} />
            <path className="si-lc-pulse" d="M0 20H1000" pathLength={100} vectorEffect="non-scaling-stroke" fill="none" strokeWidth={7} strokeLinecap="round" stroke="rgb(var(--c-accent) / .3)" strokeDasharray="6 100" strokeDashoffset={6} style={still ? { display: "none" } : undefined} />
            <path className="si-lc-pulse" d="M0 20H1000" pathLength={100} vectorEffect="non-scaling-stroke" fill="none" strokeWidth={2} strokeLinecap="round" stroke="rgb(var(--c-accent))" strokeDasharray="6 100" strokeDashoffset={6} style={still ? { display: "none" } : undefined} />
          </svg>
          {stations.map((name, i) => {
            const live = i === COUNT;
            const above = i % 2 === 0;
            const anim = still ? undefined : { animation: `si-lc-${i} var(--si-lc-dur, 6s) linear infinite` };
            const dotAnim = still ? undefined : { animation: `si-lc-s-${i} var(--si-lc-dur, 6s) linear infinite` };
            return (
              <div key={i} className="absolute top-1/2" style={{ left: `${(i / COUNT) * 100}%` }}>
                {live ? (
                  <div className="si-lc-live absolute left-0 top-0 flex -translate-y-1/2 items-center gap-1.5 rounded-full px-2.5 py-1 ring-1 ring-success/40 bg-success/10" style={anim}>
                    <span className="si-lc-live-halo absolute inset-0 rounded-full" style={{ boxShadow: "0 0 18px rgb(var(--c-success) / .7)", opacity: still ? 0.5 : 0 }} />
                    <span className="relative h-1.5 w-1.5 rounded-full bg-success" />
                    <span className="relative font-mono text-[11px] uppercase tracking-[0.1em] text-ink">{name}</span>
                  </div>
                ) : (
                  <div className="absolute left-0 top-0" style={anim}>
                    <span className="absolute -left-2 -top-2 h-4 w-4 rounded-full bg-accent/40 blur-[3px]" style={{ ...dotAnim, transform: still ? undefined : "scale(0)" }} />
                    <span className="absolute -left-[5px] -top-[5px] h-2.5 w-2.5 rounded-full bg-accent ring-2 ring-stage" />
                    <span
                      className={cn("absolute whitespace-nowrap text-[11px] text-ink lg:text-[12px]", above ? "bottom-3.5" : "top-3.5", i === 0 ? "left-0" : "-translate-x-1/2")}
                    >
                      {name}
                    </span>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
