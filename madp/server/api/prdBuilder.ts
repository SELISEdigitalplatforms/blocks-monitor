/**
 * PRD Builder — assembles a PRD.md from frontend-collected project data.
 *
 * The MADP engine's Agent 01 (Product Manager) reads this as input to produce
 * module specs and the REQ artifact.
 */
import { writeFileSync, mkdirSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { paths } from "./engineBridge.ts";

export interface PrdInput {
  projectId: string;
  name: string;
  description: string;
  goal: string;
  goalTags: string[];
  users: string;
  userTags: string[];
  kind: "new" | "existing";
  repoUrl?: string;
  clarifications?: { question: string; answer: string }[];
  requirements?: { title: string; priority: string; acceptanceCriteria: string[] }[];
  notes?: string[];
  uploadedDocs?: string[];
}

/** Build and write a PRD.md for the engine. Returns the file path. */
export function buildPrd(input: PrdInput): string {
  const prdDir = join(paths.engineRoot, "prd", input.projectId);
  mkdirSync(prdDir, { recursive: true });
  const prdPath = join(prdDir, "PRD.md");

  const sections: string[] = [];

  // Header
  sections.push(`# ${input.name}\n`);
  sections.push(`> Auto-generated PRD from MADP Factory project setup.\n`);

  // Overview
  sections.push(`## Overview\n`);
  sections.push(`${input.description}\n`);

  // Goal
  sections.push(`## Goal\n`);
  sections.push(`${input.goal}\n`);
  if (input.goalTags.length) {
    sections.push(`**Tags:** ${input.goalTags.join(", ")}\n`);
  }

  // Target Users
  sections.push(`## Target Users\n`);
  sections.push(`${input.users}\n`);
  if (input.userTags.length) {
    sections.push(`**User types:** ${input.userTags.join(", ")}\n`);
  }

  // Project Type
  sections.push(`## Project Type\n`);
  if (input.kind === "new") {
    sections.push(`New project (greenfield).\n`);
  } else {
    sections.push(`Existing product (brownfield). Repository: ${input.repoUrl || "TBD"}\n`);
  }

  // Clarifications (from sanitization step)
  if (input.clarifications?.length) {
    sections.push(`## Clarifications\n`);
    for (const c of input.clarifications) {
      sections.push(`### Q: ${c.question}\n`);
      sections.push(`**A:** ${c.answer}\n`);
    }
  }

  // Requirements (from requirements step)
  if (input.requirements?.length) {
    sections.push(`## Requirements\n`);
    for (const r of input.requirements) {
      sections.push(`### ${r.title} [${r.priority}]\n`);
      if (r.acceptanceCriteria.length) {
        sections.push(`**Acceptance Criteria:**\n`);
        for (const ac of r.acceptanceCriteria) {
          sections.push(`- ${ac}\n`);
        }
      }
    }
  }

  // Notes (from project setup)
  if (input.notes?.length) {
    sections.push(`## Additional Notes\n`);
    for (const note of input.notes) {
      sections.push(`${note}\n`);
    }
  }

  // Uploaded documents reference
  if (input.uploadedDocs?.length) {
    sections.push(`## Attached Documents\n`);
    sections.push(`The following documents were uploaded and should be read for full context:\n`);
    for (const doc of input.uploadedDocs) {
      sections.push(`- ${doc}\n`);
    }
  }

  // Also copy uploaded docs to engine artifacts
  const docsDir = join(paths.artifactsDir, input.projectId, "docs");
  mkdirSync(docsDir, { recursive: true });

  writeFileSync(prdPath, sections.join("\n"), "utf-8");
  return prdPath;
}

/** Build a delta PRD for change requests / feedback. */
export function buildDeltaPrd(projectId: string, description: string, changes: string): string {
  const prdDir = join(paths.engineRoot, "prd", projectId);
  mkdirSync(prdDir, { recursive: true });
  const deltaPath = join(prdDir, `delta-${Date.now()}.md`);

  const content = `# Change Request\n\n## Description\n\n${description}\n\n## Changes\n\n${changes}\n`;
  writeFileSync(deltaPath, content, "utf-8");
  return deltaPath;
}

/** Read the current PRD if it exists. */
export function readPrd(projectId: string): string | null {
  const prdPath = join(paths.engineRoot, "prd", projectId, "PRD.md");
  if (!existsSync(prdPath)) return null;
  return readFileSync(prdPath, "utf-8");
}
