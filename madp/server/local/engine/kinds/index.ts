// Which module writes the work of each job kind. Loaded per job (see driver.ts), so an edited writer is live for the
// next job without a restart.
import type { EngineJobKind } from "../../../../src/domain/engineJob";
import type { KindWriter } from "../run.ts";

type Group = Partial<Record<EngineJobKind, KindWriter>>;

const GROUP: Record<EngineJobKind, () => Promise<Group>> = {
  "sanitization.assist": () => import("./analysis.ts").then((m) => m.WRITERS),
  "requirements.draft": () => import("./analysis.ts").then((m) => m.WRITERS),
  "design.generate": () => import("./scope.ts").then((m) => m.WRITERS),
  "milestones.suggest": () => import("./scope.ts").then((m) => m.WRITERS),
  "scope.draft": () => import("./scope.ts").then((m) => m.WRITERS),
  "scope.grill": () => import("./scope.ts").then((m) => m.WRITERS),
  "scope.success": () => import("./scope.ts").then((m) => m.WRITERS),
  "board.plan": () => import("./scope.ts").then((m) => m.WRITERS),
  "build.run": () => import("./delivery.ts").then((m) => m.WRITERS),
  "preview.deploy": () => import("./delivery.ts").then((m) => m.WRITERS),
  "change.build": () => import("./delivery.ts").then((m) => m.WRITERS),
  "change.analyse": () => import("./changes.ts").then((m) => m.WRITERS),
  "chat.reply": () => import("./collab.ts").then((m) => m.WRITERS),
  "fix.analyse": () => import("./collab.ts").then((m) => m.WRITERS),
  "wiki.generate": () => import("./collab.ts").then((m) => m.WRITERS),
  "docs.generate": () => import("./collab.ts").then((m) => m.WRITERS),
  "setup.assist": () => import("./setup.ts").then((m) => m.WRITERS),
  "feedback.apply": () => import("./feedback.ts").then((m) => m.WRITERS),
  "file.extract": () => import("./extract.ts").then((m) => m.WRITERS),
  "engine.skills-sync": () => import("./maintenance.ts").then((m) => m.WRITERS),
  "product.document": () => import("./document.ts").then((m) => m.WRITERS),
};

export async function writerOf(kind: EngineJobKind): Promise<KindWriter> {
  const group = await GROUP[kind]();
  const w = group[kind];
  if (!w) throw new Error(`no writer for ${kind}`);
  return w;
}
