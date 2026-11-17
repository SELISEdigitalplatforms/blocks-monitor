/** Shared stage visuals for the build screen: agent icons, status words and the 8-stage stepper.
 *  Same language as the kit Stepper (ink = verified, blue = working, hatched = planned), plus the send-back state. */
import type { ReactNode } from "react";
import { BookOpen, Check, ClipboardList, CodeXml, DoorOpen, FlaskConical, Rocket, ScanEye, ShieldCheck, Undo2 } from "lucide-react";
import { AGENT_NAME } from "@/lib/factoryLabels";
import type { StageState, StageStatus } from "@/data/pipeline";
import { STAGES } from "@/data/pipeline";
import type { ChipTone, StageId } from "@/data/types";
import { cn } from "@/lib/cn";
import { t, useT } from "@/i18n";

/** "Build · Tech lead"; a stage named after its agent reads once ("Release gate"), Release to development names the platform. */
export function stageWithAgent(id: StageId): string {
  const name = STAGES.find((s) => s.id === id)?.name ?? id;
  if (id === "deploy") return `${name} · SELISE Blocks`;
  return AGENT_NAME[id] === name ? name : `${name} · ${AGENT_NAME[id]}`;
}

const ICONS: Record<StageId, typeof Check> = {
  "01": ClipboardList, "02": CodeXml, "03": ScanEye, "04": FlaskConical,
  "05": ShieldCheck, "06": BookOpen, "07": DoorOpen, deploy: Rocket,
};

export function StageIcon({ id, size = 16, className }: { id: StageId; size?: number; className?: string }) {
  const Icon = ICONS[id];
  return <Icon size={size} strokeWidth={1.75} className={className} aria-hidden />;
}

/** A stage's status in one word. A finished stage has passed its automatic checks, so it reads "Verified". */
export const STATUS_WORD: Record<StageStatus, string> = {
  get planned() { return t("build.step.milestone.planned", "Planned"); },
  get active() { return t("build.timeline.legend.working", "Working"); },
  get done() { return t("build.stage.verified", "Verified"); },
  get "sent-back"() { return t("build.stage.sentBack", "Sent back"); },
  get blocked() { return t("build.timeline.onHold", "On hold"); },
};

export const STATUS_TONE: Record<StageStatus, ChipTone> = {
  planned: "neutral", active: "accent", done: "neutral", "sent-back": "warning", blocked: "warning",
};

/** The round marker used by the stepper, the track headers and the inspector. */
export function StageMarker({ status, id, size = 28, children }: { status: StageStatus; id: StageId; size?: number; children?: ReactNode }) {
  return (
    <span style={{ width: size, height: size }}
      className={cn("num relative grid shrink-0 place-items-center rounded-full text-[12px] font-medium transition-colors duration-500",
        status === "done" && "bg-ink text-canvas",
        status === "active" && "bg-accent text-white",
        status === "planned" && "hatched bg-surface2 text-ink3",
        (status === "sent-back" || status === "blocked") && "bg-warning text-stage")}>
      {status === "active" && <span aria-hidden className="absolute inset-0 animate-ping rounded-full bg-accent/30 [animation-duration:2s]" />}
      <span className="relative">
        {children ?? (status === "done" ? <Check size={size * 0.5} strokeWidth={2.25} />
          : status === "sent-back" ? <Undo2 size={size * 0.48} strokeWidth={1.75} />
          : <StageIcon id={id} size={Math.round(size * 0.5)} />)}
      </span>
    </span>
  );
}

/** The 8-stage stepper under the studio. Stages run in parallel, so each shows its own state: the stage name, and under
 *  it always its status word (the agent is in the tooltip and the screen-reader text). */
export function StageStepper({ stages, className }: { stages: StageState[]; className?: string }) {
  const t = useT();
  const byId = new Map(stages.map((s) => [s.id, s]));
  return (
    <ol className={cn("grid grid-cols-4 gap-y-6 sm:grid-cols-8", className)} aria-label={t("build.stage.stepper", "Build stages")}>
      {STAGES.map((d, i) => {
        const st = byId.get(d.id)?.status ?? "planned";
        const next = byId.get(STAGES[i + 1]?.id)?.status;
        return (
          <li key={d.id} title={stageWithAgent(d.id)} className="relative flex flex-col items-center text-center" aria-current={st === "active" || st === "sent-back" ? "step" : undefined}>
            {i < STAGES.length - 1 && (
              <span aria-hidden className={cn("absolute left-[calc(50%+20px)] right-[calc(-50%+20px)] top-[17px] h-0.5 rounded-full transition-colors duration-500",
                i === 3 && "hidden sm:block",
                next && next !== "planned" ? "bg-ink/70" : "hatched bg-surface2")} />
            )}
            <StageMarker status={st} id={d.id} size={36} />
            <span aria-hidden className={cn("mt-2.5 text-[13px] leading-tight", st === "planned" ? "text-ink3" : "font-medium text-ink")}>{d.name}</span>
            <span aria-hidden className={cn("mt-0.5 text-[12px] leading-tight",
              st === "sent-back" ? "font-medium text-ink" : st === "active" ? "text-accent" : "text-ink3")}>
              {STATUS_WORD[st]}
            </span>
            <span className="sr-only">{`${stageWithAgent(d.id)}: ${STATUS_WORD[st]}`}</span>
          </li>
        );
      })}
    </ol>
  );
}
