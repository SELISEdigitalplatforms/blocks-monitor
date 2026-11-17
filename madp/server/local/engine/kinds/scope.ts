// Writers of the scope step: the first draft of the Scope & delivery plan, the screen designs of the confirmed brief, the milestone suggestion, the second opinion
// on a scope version and the board plan of a locked scope.
import type { EngineJobKind } from "../../../../src/domain/engineJob";
import type { KindWriter } from "../run.ts";
import { boardPlan } from "./scope/board.ts";
import { designGenerate } from "./scope/design.ts";
import { scopeDraft } from "./scope/draft.ts";
import { scopeGrill } from "./scope/grill.ts";
import { scopeSuccess } from "./scope/success.ts";
import { milestonesSuggest } from "./scope/milestones.ts";

export const WRITERS: Partial<Record<EngineJobKind, KindWriter>> = {
  "design.generate": designGenerate,
  "milestones.suggest": milestonesSuggest,
  "scope.draft": scopeDraft,
  "scope.grill": scopeGrill,
  "scope.success": scopeSuccess,
  "board.plan": boardPlan,
};
