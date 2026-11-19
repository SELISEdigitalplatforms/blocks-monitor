/** The milestone previews (shared by board, build and release): one row per milestone with its real preview, or the
 *  state of its preview.deploy job. Only an https address becomes a link (to the version's app page); nothing is invented. */
import type { RefObject } from "react";
import { Check, Copy, ExternalLink } from "lucide-react";
import type { DeliveryMilestone, DeliveryPreview } from "@/madp/blocks/delivery/types";
import { latestJobFor } from "@/madp/blocks/delivery/hooks";
import type { EngineJob } from "@/madp/blocks/engine/types";
import { EngineJobStatus } from "@/madp/components/engine/EngineJobStatus";
import { appLink } from "@/madp/domain/appPreview";
import { compareVersions } from "@/madp/domain/numbering";
import { Button, Card, Chip, Input } from "@/madp/ui/kit";
import { formatDateTime } from "@/madp/lib/dates";
import { notDeployedText } from "./releaseUi";
import { manualCopy, useCopy } from "./shared";
import { useT } from "@/madp/i18n";

/** The newest preview of a milestone (by creation time, then by version). */
export function latestPreviewFor(previews: readonly DeliveryPreview[], milestoneId: string): DeliveryPreview | null {
  let best: DeliveryPreview | null = null;
  for (const p of previews) {
    if (p.milestoneId !== milestoneId) continue;
    if (!best) { best = p; continue; }
    const d = (Date.parse(p.createdAt ?? "") || 0) - (Date.parse(best.createdAt ?? "") || 0);
    if (d > 0 || (d === 0 && compareVersions(p.version, best.version) > 0)) best = p;
  }
  return best;
}

const time = (iso: string | null | undefined): string => {
  const t = Date.parse(iso ?? "");
  return Number.isFinite(t) ? formatDateTime(t) : "";
};

function PreviewLink({ milestone, url }: { milestone: DeliveryMilestone; url: string }) {
  const t = useT();
  const { state, copy, target } = useCopy(url);
  const of = { number: milestone.number, name: milestone.name };
  return (
    <div className="mt-3 flex min-w-0 flex-wrap items-center gap-2">
      <a href={url} target="_blank" rel="noopener noreferrer" aria-label={t("build.release.previews.openOf", "Open preview of milestone {number}: {name}", of)}
        className="inline-flex h-9 items-center gap-1.5 rounded-full bg-surface px-4 text-[13px] font-medium text-ink ring-1 ring-inset ring-line outline-none hover:bg-surface2 focus-visible:ring-2 focus-visible:ring-accent/50">
        <ExternalLink size={14} strokeWidth={1.75} aria-hidden="true" />{t("build.release.previews.open", "Open preview")}
      </a>
      <Button size="sm" variant="secondary" aria-label={t("build.release.previews.copyOf", "Copy link of milestone {number}: {name}", of)} onClick={copy}
        icon={state === "copied" ? <Check size={14} strokeWidth={1.75} aria-hidden="true" /> : <Copy size={14} strokeWidth={1.75} aria-hidden="true" />}>
        {state === "copied" ? t("build.release.copy.copied", "Copied") : t("build.release.previews.copyLink", "Copy link")}
      </Button>
      {state === "manual" && (
        <div className="w-full min-w-0" ref={target as RefObject<HTMLDivElement | null>}>
          <Input readOnly value={url} aria-label={t("build.release.previews.link", "Preview link")} onFocus={(e) => e.currentTarget.select()} />
          <p role="status" className="mt-1 text-[12px] text-ink2">{manualCopy(t("build.release.copy.link", "Link"))}</p>
        </div>
      )}
      {state === "copied" && <span role="status" className="sr-only">{t("build.release.previews.copied", "Link copied")}</span>}
    </div>
  );
}

export function MilestonePreviewItem({ milestone, preview, job, compact }: {
  milestone: DeliveryMilestone; preview: DeliveryPreview | null; job: EngineJob | null; compact?: boolean;
}) {
  const t = useT();
  const url = preview ? appLink(preview)?.href ?? null : null;
  return (
    <li className={compact ? "min-w-0 py-2" : "min-w-0 rounded-block bg-surface2 p-4"}>
      <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
        <span className="min-w-0 break-words text-[14px] font-medium">{t("build.release.previews.milestone", "Milestone {number}: {name}", { number: milestone.number, name: milestone.name })}</span>
        {preview && <Chip tone={url ? "success" : "neutral"}>
          {url ? t("build.release.previews.online", "Online") : preview.status === "failed" ? t("build.release.previews.notOnline", "Not online") : t("build.release.previews.goingOnline", "Going online")}
        </Chip>}
        {preview && <span className="num font-mono text-[12px] text-ink2">{`v${preview.version}`}</span>}
        {preview && time(preview.createdAt) && <span className="num text-[12px] text-ink3">{time(preview.createdAt)}</span>}
      </div>
      {preview ? (
        url ? <PreviewLink milestone={milestone} url={url} /> : <p className="mt-2 text-[13px] text-ink2">{notDeployedText()}</p>
      ) : job ? (
        <div className="mt-2"><EngineJobStatus variant="compact" job={job} /></div>
      ) : (
        <p className="mt-2 text-[13px] text-ink2">{t("build.release.previews.afterBuild", "Preview after this milestone is built")}</p>
      )}
    </li>
  );
}

export function MilestonePreviews({ milestones, previews, jobs, title }: {
  milestones: readonly DeliveryMilestone[]; previews: readonly DeliveryPreview[]; jobs: readonly EngineJob[]; title?: string;
}) {
  const t = useT();
  return (
    <Card title={title ?? t("build.release.previews.title", "Milestone previews")}>
      {milestones.length === 0 ? (
        <p className="text-[13px] text-ink2">{t("build.release.previews.none", "No milestones yet. They come with the locked scope.")}</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {milestones.map((m) => (
            <MilestonePreviewItem key={m.id} milestone={m} preview={latestPreviewFor(previews, m.id)}
              job={latestJobFor(jobs, "preview.deploy", { milestoneId: m.id })} />
          ))}
        </ul>
      )}
    </Card>
  );
}
