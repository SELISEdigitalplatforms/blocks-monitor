/** Role names, icons, colours and stations (ported from MADP Studio's components/run/roles.tsx), with the
 *  Factory's names for the pipeline agents and the two extra roles: SecOps (Security lab) and Docs (Docs desk). */

import { Bot, Bug, ClipboardCheck, Code2, DoorOpen, Eye, FileText, PenTool, Rocket, ShieldCheck } from "lucide-react";
import type { ReactNode } from "react";
import type { StageStatus } from "@/madp/data/pipeline";
import { t } from "@/madp/i18n";
import type { ChatRole } from "./chat/types";
import { STATION_OF, type AgentStatus, type AgentView, type Role, type Station } from "./model";

export const ROLE_META: Record<Role, { icon: ReactNode; color: string }> = {
  planner: { icon: <PenTool />, color: "--role-planner" },
  dev: { icon: <Code2 />, color: "--role-dev" },
  fixup: { icon: <Bug />, color: "--role-fixup" },
  reviewer: { icon: <Eye />, color: "--role-reviewer" },
  qa: { icon: <ClipboardCheck />, color: "--role-qa" },
  secops: { icon: <ShieldCheck />, color: "--role-secops" },
  docs: { icon: <FileText />, color: "--role-docs" },
  integrator: { icon: <DoorOpen />, color: "--role-integrator" },
  shipper: { icon: <Rocket />, color: "--role-shipper" },
  autopilot: { icon: <Bot />, color: "--role-autopilot" },
};

/** The role's name in the current language (read at render time). */
const ROLE_LABEL: Record<Role, () => string> = {
  planner: () => t("studio.office.roles.planner", "Business analyst"),
  dev: () => t("studio.office.roles.dev", "Tech lead"),
  fixup: () => t("studio.office.roles.fixup", "Fix-up"),
  reviewer: () => t("studio.office.roles.reviewer", "Reviewer"),
  qa: () => t("studio.office.roles.qa", "Tester"),
  secops: () => t("studio.office.roles.secops", "SecOps"),
  docs: () => t("studio.office.roles.docs", "Docs"),
  integrator: () => t("studio.office.roles.integrator", "Integrator"),
  shipper: () => t("studio.office.roles.shipper", "Release gate"),
  autopilot: () => t("studio.office.roles.autopilot", "Autopilot"),
};
export const roleLabel = (role: Role): string => ROLE_LABEL[role]();

const STATION_LABEL: Record<Station, () => string> = {
  whiteboard: () => t("studio.office.stations.whiteboard", "Whiteboard"),
  desks: () => t("studio.office.stations.desks", "Desk cluster"),
  debug: () => t("studio.office.stations.debug", "Debug booth"),
  review: () => t("studio.office.stations.review", "Review desk"),
  bench: () => t("studio.office.stations.bench", "Test bench"),
  security: () => t("studio.office.stations.security", "Security lab"),
  docs: () => t("studio.office.stations.docs", "Docs desk"),
  door: () => t("studio.office.stations.door", "Repo-lock door"),
  ship: () => t("studio.office.stations.ship", "Release gate"),
  supervisor: () => t("studio.office.stations.supervisor", "Supervisor corner"),
  lobby: () => t("studio.office.stations.lobby", "Lobby"),
};
/** A station's name in the current language. */
export const stationLabel = (station: Station): string => STATION_LABEL[station]();
/** The station a role works at, by name. */
export const roleStation = (role: Role): string => stationLabel(STATION_OF[role]);

const STATUS_TEXT: Record<AgentStatus, () => string> = {
  idle: () => t("studio.office.status.idle", "planned"),
  queued: () => t("studio.office.status.queued", "queued"),
  working: () => t("studio.office.status.working", "working"),
  waiting: () => t("studio.office.status.waiting", "waiting"),
  pass: () => t("studio.office.status.pass", "done"),
  fail: () => t("studio.office.status.fail", "failed"),
  done: () => t("studio.office.status.done", "done"),
  returning: () => t("studio.office.status.returning", "sent back"),
};

/** the pipeline's own words for a stage status (inspector, hover label) */
const STAGE_STATUS_TEXT: Record<StageStatus, () => string> = {
  planned: () => t("studio.office.stageStatus.planned", "planned"),
  active: () => t("studio.office.stageStatus.active", "working"),
  done: () => t("studio.office.stageStatus.done", "verified"),
  "sent-back": () => t("studio.office.stageStatus.sentBack", "sent back"),
  blocked: () => t("studio.office.stageStatus.blocked", "on hold"),
};
export const stageStatusText = (s: StageStatus): string => STAGE_STATUS_TEXT[s]();

/** An agent's status in words: its pipeline stage's status when it has one, else its own. */
export const agentStatusText = (a: Pick<AgentView, "status" | "stageStatus">): string =>
  a.stageStatus ? STAGE_STATUS_TEXT[a.stageStatus]() : STATUS_TEXT[a.status]();

/** the roles whose human role is the same as their name (the business analyst, the tech lead) */
export const NAME_IS_ROLE: ReadonlySet<Role> = new Set<Role>(["planner", "dev"]);

/** "Who is who" in the stage controls: the Factory's pipeline agents, in pipeline order (read at render time). */
export function legend(): readonly { role: ChatRole; name: string; look: string; station: string }[] {
  return [
    { role: "planner", name: roleLabel("planner"), look: t("studio.office.legend.lookSuitAndTie", "Suit and tie"), station: stationLabel("whiteboard") },
    { role: "dev", name: roleLabel("dev"), look: t("studio.office.legend.lookHoodie", "Hoodie"), station: t("studio.office.legend.desks", "Desks") },
    { role: "reviewer", name: roleLabel("reviewer"), look: t("studio.office.legend.lookCasualJacket", "Casual jacket"), station: stationLabel("review") },
    { role: "qa", name: roleLabel("qa"), look: t("studio.office.legend.lookCasual", "Casual"), station: stationLabel("bench") },
    { role: "secops", name: roleLabel("secops"), look: t("studio.office.legend.lookStreetStyle", "Street style"), station: stationLabel("security") },
    { role: "docs", name: roleLabel("docs"), look: t("studio.office.legend.lookFormal", "Formal"), station: stationLabel("docs") },
    { role: "shipper", name: roleLabel("shipper"), look: t("studio.office.legend.lookSuit", "Suit"), station: stationLabel("ship") },
  ];
}
