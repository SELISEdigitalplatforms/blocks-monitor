/** The factory's stages, in order: plan, build, review, test, security, docs, release gate, then the release to the test
 *  environment on SELISE Blocks (staging and production follow the approvals). (Publishing a knowledge pack happens after
 *  delivery; it is not the release.) Every screen uses these names; the ids stay as they are ("deploy"). */
import type { StageId } from "./types";
import { t } from "@/madp/i18n";

export type StageStatus = "planned" | "active" | "done" | "sent-back" | "blocked";

export interface StageDef {
  id: StageId;
  name: string;
  artifact: string;
  /** what happens here, in plain words for a business user */
  plain: string;
}

export const STAGES: StageDef[] = [
  { id: "01", get name() { return t("build.pipeline.plan.name", "Plan"); }, artifact: "REQ", get plain() { return t("build.pipeline.plan.plain", "Turns the confirmed scope into a step-by-step delivery plan."); } },
  { id: "02", get name() { return t("build.pipeline.build.name", "Build"); }, artifact: "CODE", get plain() { return t("build.pipeline.build.plain", "Writes the app, test-first, screen by screen."); } },
  { id: "03", get name() { return t("build.pipeline.review.name", "Review"); }, artifact: "REVIEW", get plain() { return t("build.pipeline.review.plain", "Checks code quality and that everything in the scope is there."); } },
  { id: "04", get name() { return t("build.pipeline.test.name", "Test"); }, artifact: "TEST", get plain() { return t("build.pipeline.test.plain", "Runs every user story as an automated test."); } },
  { id: "05", get name() { return t("build.pipeline.security.name", "Security"); }, artifact: "SEC · PT", get plain() { return t("build.pipeline.security.plain", "Scans for security issues and runs a penetration test."); } },
  { id: "06", get name() { return t("build.pipeline.docs.name", "Docs"); }, artifact: "DOCS", get plain() { return t("build.pipeline.docs.plain", "Writes the user guide and the technical documentation."); } },
  { id: "07", get name() { return t("build.pipeline.gate.name", "Release gate"); }, artifact: "RELEASE", get plain() { return t("build.pipeline.gate.plain", "Checks every gate before the release and says OPEN or HOLD."); } },
  { id: "deploy", get name() { return t("build.pipeline.deploy.name", "Release to development"); }, artifact: "PREVIEW", get plain() { return t("build.pipeline.deploy.plain", "Each finished build goes online on the development environment as a preview to try; staging and production follow the project's approvals."); } },
];

export interface StageState { id: StageId; status: StageStatus; caption?: string; progress?: number }

export const stageDef = (id: StageId) => STAGES.find((s) => s.id === id)!;
