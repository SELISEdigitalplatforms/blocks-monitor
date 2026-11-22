/** Camera presets for the stage (pure): each names the floor spots it frames; Office3D turns them into a camera view
 *  with fit.ts's frameSpots, so a preset fits any stage size. Keys 1-5 pick them. */

import { t } from "@/i18n";
import { STATION, deskAt, type Vec2 } from "./layout";

export type ViewId = "overview" | "desks" | "planning" | "quality" | "release";

export interface ViewPreset {
  id: ViewId;
  /** the key that picks it */
  key: string;
}

export const VIEWS: readonly ViewPreset[] = [
  { id: "overview", key: "1" },
  { id: "desks", key: "2" },
  { id: "planning", key: "3" },
  { id: "quality", key: "4" },
  { id: "release", key: "5" },
];

const VIEW_LABEL: Record<ViewId, () => string> = {
  overview: () => t("studio.office.views.overview", "Overview"),
  desks: () => t("studio.office.views.desks", "Desks"),
  planning: () => t("studio.office.views.planning", "Plan & review"),
  quality: () => t("studio.office.views.quality", "Test & security"),
  release: () => t("studio.office.views.release", "Docs & release"),
};
/** a camera preset's name in the current language */
export const viewLabel = (id: ViewId): string => VIEW_LABEL[id]();

export function viewForKey(key: string): ViewId | null {
  return VIEWS.find((v) => v.key === key)?.id ?? null;
}

/** the floor spots a preset frames ("overview" is the stage's home view: none) */
export function viewSpots(id: ViewId, deskCount: number): Vec2[] {
  switch (id) {
    case "overview":
      return [];
    case "desks": {
      const n = Math.max(1, deskCount);
      const out: Vec2[] = [];
      for (let i = 0; i < n; i++) {
        const d = deskAt(i);
        out.push({ x: d.x, z: d.z - 0.3 }, { x: d.x, z: d.z + 0.95 });
      }
      return out;
    }
    case "planning":
      return [
        { x: STATION.whiteboard.x - 1.6, z: STATION.whiteboard.z + 0.4 }, { x: STATION.whiteboard.x + 1.6, z: STATION.whiteboard.z + 1.3 },
        { x: STATION.review.x, z: STATION.review.z }, { x: STATION.review.x, z: STATION.review.z + 0.9 },
      ];
    case "quality":
      return [
        { x: STATION.bench.x - 2.1, z: STATION.bench.z }, { x: STATION.bench.x + 2.1, z: STATION.bench.z + 1.2 },
        { x: STATION.security.x - 1.2, z: STATION.security.z }, { x: STATION.security.x + 1.2, z: STATION.security.z + 1.1 },
      ];
    case "release":
      return [
        { x: STATION.docs.x - 0.9, z: STATION.docs.z }, { x: STATION.docs.x + 0.9, z: STATION.docs.z + 0.9 },
        { x: STATION.ship.x - 1.5, z: STATION.ship.z - 0.6 }, { x: STATION.ship.x + 1.3, z: STATION.ship.z + 0.4 },
      ];
  }
}
