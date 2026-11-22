import type { DragEvent, ReactNode } from "react";
import { FEATURE_DRAG_PREFIX } from "./MilestoneFeatureRow";
import { useT } from "@/i18n";

/** "Not in a milestone": the included features without a milestone. Dropping a feature here unassigns it. */
export function FeatureTray({ children, empty, editable, onDropFeature }: {
  children: ReactNode;
  empty: boolean;
  editable: boolean;
  onDropFeature: (data: string) => void;
}) {
  const t = useT();
  const over = (e: DragEvent<HTMLElement>) => {
    if (editable && e.dataTransfer.types.includes("text/plain")) e.preventDefault();
  };
  const drop = (e: DragEvent<HTMLElement>) => {
    const data = e.dataTransfer.getData("text/plain");
    if (!editable || !data.startsWith(FEATURE_DRAG_PREFIX)) return;
    e.preventDefault();
    onDropFeature(data);
  };
  return (
    <section aria-labelledby="ms-tray-title" onDragOver={over} onDrop={drop} className="rounded-card border border-dashed border-line bg-surface p-4">
      <h3 id="ms-tray-title" className="text-[14px] font-semibold text-ink">{t("build.milestones.tray", "Not in a milestone")}</h3>
      {empty ? (
        <p className="mt-2 text-[13px] text-ink2">{t("build.milestones.trayEmpty", "Every included feature is in a milestone.")}</p>
      ) : (
        <ul className="mt-3 grid gap-2 sm:grid-cols-2 2xl:grid-cols-3">{children}</ul>
      )}
    </section>
  );
}
