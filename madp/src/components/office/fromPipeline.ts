/** Factory pipeline → office. Stages map to agents: 01 business analyst (planner), 02 tech lead (dev), 03 reviewer, 04 tester,
 *  05 SecOps, 06 docs, 07 + deploy the release gate. A stage's status sets its agent's behaviour:
 *  planned → idle at its station, active → working there with the caption bubble, done → finished
 *  (cheers, then relaxes at the coffee corner or the bench), blocked → waiting (foot-tapping) at its
 *  station, sent back → walking back: a send-back from any later stage sends the tech lead back to the
 *  desks, while the stage that sent it waits for the fix. Pure, no React and no three; the texts are read in the current
 *  language when the team is built. */

import type { StageState, StageStatus } from "@/data/pipeline";
import type { StageId } from "@/data/types";
import { t } from "@/i18n";
import { roleLabel } from "./roles";
import { STATION_OF, type AgentStatus, type AgentView, type GateState, type Role, type RunStatus } from "./model";

interface Member { id: string; role: Role; stages: readonly StageId[] }

/** the Factory's pipeline agents, in pipeline order (07 and the deploy share the release gate) */
export const FACTORY_TEAM: readonly Member[] = [
  { id: "planner", role: "planner", stages: ["01"] },
  { id: "dev", role: "dev", stages: ["02"] },
  { id: "reviewer", role: "reviewer", stages: ["03"] },
  { id: "qa", role: "qa", stages: ["04"] },
  { id: "secops", role: "secops", stages: ["05"] },
  { id: "docs", role: "docs", stages: ["06"] },
  { id: "shipper", role: "shipper", stages: ["07", "deploy"] },
];

const ALL: readonly StageId[] = ["01", "02", "03", "04", "05", "06", "07", "deploy"];

/** short bubbles when a stage gives no caption of its own */
const DOING: Record<StageId, () => string> = {
  "01": () => t("studio.office.doing.plan", "Writing the delivery plan"),
  "02": () => t("studio.office.doing.code", "Writing code, test-first"),
  "03": () => t("studio.office.doing.review", "Reviewing the code"),
  "04": () => t("studio.office.doing.test", "Running every user story"),
  "05": () => t("studio.office.doing.security", "Scanning for security issues"),
  "06": () => t("studio.office.doing.docs", "Writing the user guide"),
  "07": () => t("studio.office.doing.gate", "Checking every quality gate"),
  deploy: () => t("studio.office.doing.deploy", "Releasing to dev"),
};

/** why the developer walks back to the desks, by the stage that sent the work back */
const BACK_TO_DESK: Record<StageId, () => string> = {
  "01": () => t("studio.office.backToDesk.plan", "Back to the desk: plan changed"),
  "02": () => t("studio.office.backToDesk.code", "Back to the desk"),
  "03": () => t("studio.office.backToDesk.review", "Back to the desk: review notes"),
  "04": () => t("studio.office.backToDesk.test", "Back to the desk: failing tests"),
  "05": () => t("studio.office.backToDesk.security", "Fixing the security finding"),
  "06": () => t("studio.office.backToDesk.docs", "Back to the desk: docs questions"),
  "07": () => t("studio.office.backToDesk.gate", "Back to the desk: release on hold"),
  deploy: () => t("studio.office.backToDesk.deploy", "Back to the desk: smoke test failed"),
};

const blockedText = () => t("studio.office.detail.blocked", "On hold: waiting for the previous stage");
const sentBackText = () => t("studio.office.detail.sentBack", "Gate failed: sent to the Tech lead");

export interface Team { agents: AgentView[]; gate: GateState; status: RunStatus }

type Mapped = { status: AgentStatus; detail?: string; stage: StageId; stageStatus: StageStatus };

function single(id: StageId, st: StageState | undefined): Mapped {
  const s = st?.status ?? "planned";
  const base = { stage: id, stageStatus: s };
  switch (s) {
    case "active": return { ...base, status: "working", detail: st?.caption ?? DOING[id]() };
    case "done": return { ...base, status: "pass" };
    case "blocked": return { ...base, status: "waiting", detail: st?.caption ?? blockedText() };
    case "sent-back": return { ...base, status: "waiting", detail: st?.caption ?? sentBackText() };
    default: return { ...base, status: "idle" };
  }
}

/** The developer: work sent back from a later stage comes first (it walks back and fixes it, even while its own
 *  stage is active), then its own stage. */
function developer(byId: Map<StageId, StageState>): Mapped {
  const own = byId.get("02");
  const s = own?.status ?? "planned";
  const sender = ALL.slice(2).find((id) => byId.get(id)?.status === "sent-back");
  if (sender) return { stage: "02", stageStatus: "sent-back", status: "returning", detail: BACK_TO_DESK[sender]() };
  if (s === "sent-back") return { stage: "02", stageStatus: s, status: "returning", detail: own?.caption ?? BACK_TO_DESK["02"]() };
  return single("02", own);
}

function releaseGate(byId: Map<StageId, StageState>): Mapped & { gate: GateState } {
  const g = byId.get("07"), d = byId.get("deploy");
  const gs = g?.status ?? "planned", ds = d?.status ?? "planned";
  if (gs === "blocked" || ds === "blocked") {
    const id: StageId = gs === "blocked" ? "07" : "deploy";
    return { ...single(id, byId.get(id)), detail: byId.get(id)?.caption ?? t("studio.office.detail.releaseOnHold", "Release on hold: a quality gate has not passed"), gate: "hold" };
  }
  if (gs === "sent-back" || ds === "sent-back") {
    const id: StageId = gs === "sent-back" ? "07" : "deploy";
    return { ...single(id, byId.get(id)), gate: "hold" };
  }
  if (ds === "active") return { ...single("deploy", d), gate: "deploying" };
  if (gs === "active") return { ...single("07", g), gate: "checking" };
  if (ds === "done") return { ...single("deploy", d), gate: "live" };
  if (gs === "done") return { ...single("07", g), gate: "open" };
  return { ...single("07", g), gate: "idle" };
}

/** The office team for a pipeline state (missing stages count as planned). `since` is left to the caller. */
export function teamFromStages(stages: readonly StageState[]): Team {
  const byId = new Map<StageId, StageState>(stages.map((s) => [s.id, s]));
  const gate = releaseGate(byId);
  const agents: AgentView[] = FACTORY_TEAM.map((m) => {
    const mapped = m.role === "dev" ? developer(byId) : m.role === "shipper" ? gate : single(m.stages[0], byId.get(m.stages[0]));
    return {
      id: m.id, role: m.role, label: roleLabel(m.role), station: STATION_OF[m.role],
      status: mapped.status, detail: mapped.detail, stage: mapped.stage, stageStatus: mapped.stageStatus,
    };
  });
  const statuses = ALL.map((id) => byId.get(id)?.status ?? "planned");
  const status: RunStatus = statuses.every((s) => s === "done") ? "passed"
    : statuses.every((s) => s === "planned") ? "unknown"
    : statuses.some((s) => s === "blocked") ? "waiting" : "running";
  return { agents, gate: gate.gate, status };
}
