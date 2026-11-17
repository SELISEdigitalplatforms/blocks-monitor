import { projectAssign } from "./assign";
import { projectLandingConfirm, projectLandingSave } from "./addOn";
import { projectCreate } from "./create";
import { projectDelete } from "./delete";
import { projectRename, projectUpdate } from "./edit";
import { businessHandOver } from "./handOver";
import { projectSetup } from "./setup";
import { shareCreate, shareDelete } from "./share";
import { projectSetupSave } from "./setupSave";
import { projectSetupAgentWake, projectSetupSuggestionDecide } from "./setupAgent";
import { projectBriefDecide } from "./briefDecide";
import type { OpDef } from "./op";

// PROJECT_OPS is added by the coordinator via bind.ts once functions/_lib lands.
export const PROJECT_HANDLERS: readonly OpDef<any, any>[] = [
  projectCreate,
  projectRename,
  projectUpdate,
  projectDelete,
  projectAssign,
  shareCreate,
  shareDelete,
  businessHandOver,
  projectSetup,
  projectSetupSave,
  projectSetupAgentWake,
  projectSetupSuggestionDecide,
  projectBriefDecide,
  projectLandingSave,
  projectLandingConfirm,
];
