/** The stations as hover and click targets (pure): where each one sits on the floor, its footprint, and the agent who
 *  works there (from the real pipeline state; a desk without a developer is a free desk). */

import { t } from "@/madp/i18n";
import { STATION, deskAt } from "./layout";
import type { AgentStatus, AgentView, Role } from "./model";
import { stationLabel } from "./roles";

export interface Hotspot {
  key: string;
  name: string;
  x: number;
  z: number;
  /** footprint (world units) */
  w: number;
  d: number;
  agent?: AgentView;
}

const FIXED: ReadonlyArray<{ key: "whiteboard" | "review" | "bench" | "security" | "docs" | "ship"; role: Role; x: number; z: number; w: number; d: number }> = [
  { key: "whiteboard", role: "planner", x: STATION.whiteboard.x, z: STATION.whiteboard.z + 0.35, w: 3.4, d: 0.9 },
  { key: "review", role: "reviewer", x: STATION.review.x, z: STATION.review.z, w: 1.8, d: 1.0 },
  { key: "bench", role: "qa", x: STATION.bench.x, z: STATION.bench.z, w: 4.4, d: 1.2 },
  { key: "security", role: "secops", x: STATION.security.x, z: STATION.security.z, w: 2.6, d: 1.0 },
  { key: "docs", role: "docs", x: STATION.docs.x, z: STATION.docs.z, w: 1.9, d: 1.0 },
  { key: "ship", role: "shipper", x: STATION.ship.x, z: STATION.ship.z, w: 2.8, d: 0.8 },
];

export function hotspotsFor(agents: readonly AgentView[], deskCount: number): Hotspot[] {
  const devs = agents.filter((a) => a.role === "dev");
  const out: Hotspot[] = FIXED.map(({ role, ...h }) => ({ ...h, name: stationLabel(h.key), agent: agents.find((a) => a.role === role) }));
  for (let i = 0; i < deskCount; i++) {
    const p = deskAt(i);
    out.push({ key: `desk-${i}`, name: t("studio.office.stations.deskNumber", "Desk {n}", { n: i + 1 }), x: p.x, z: p.z + 0.2, w: 1.9, d: 1.4, agent: devs[i] });
  }
  return out;
}

export type GlowTone = "brand" | "warning" | "danger";

/** the soft floor glow under a station: while its agent works, waits or failed; none when idle or done */
export function glowTone(status: AgentStatus | undefined): GlowTone | null {
  if (status === "working") return "brand";
  if (status === "waiting" || status === "returning") return "warning";
  if (status === "fail") return "danger";
  return null;
}
