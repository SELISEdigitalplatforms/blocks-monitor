/**
 * The two guides of the setup journey, MADP Assistant and the business analyst: general Rocketbox avatars (Microsoft, MIT)
 * with facial blend shapes and natural hair, Adults/Male_Adult_01 and Professions/Business_Male_06, converted like the
 * cast (public/madp/models/agents/CREDITS.md) and dressed in the white SELISE polo (outfit.ts). They share the cast's
 * skeleton and clips (anims-m.glb), not its people: no guide wears a cast member's face.
 */
import { PEOPLE_BASE, type Build } from "../registry";

export type AgentRole = "assistant" | "pm";

export interface AgentDef {
  role: AgentRole;
  name: string;
  /** the guide's own model file (public/madp/models/agents) */
  model: string;
  /** whose clips: the cast's shared Rocketbox clip set of that build (anims-m / anims-f) */
  build: Build;
  /** per-person timing variation */
  seed: number;
  /** this base's shirt has a standing collar: lay it down into a polo collar (outfit.ts foldCollar) */
  foldCollar?: boolean;
  /** this base already has short sleeves and bare forearms: keep its arms (no long sleeves to slim away) */
  bareArms?: boolean;
  /** this base wears shorts: its bare lower legs become trouser legs (outfit.ts trouserLegs) */
  shorts?: boolean;
  /** the face at rest (e.g. heavier eyelids) */
  face?: { blink?: number };
}

export const AGENTS: Readonly<Record<AgentRole, AgentDef>> = {
  // a short-sleeved polo base (its own polo collar and placket, no lapels or hood), shorts lengthened into trousers
  assistant: { role: "assistant", name: "MADP Assistant", model: "guide-m01.close.glb", build: "m", bareArms: true, shorts: true, seed: 1.37 },
  // a white business shirt base (its own lying shirt collar, no tie or jacket)
  pm: { role: "pm", name: "Business analyst", model: "guide-b06.close.glb", build: "m", seed: 4.81 },
};

/** dev bench only: try another base model (lab.html ?a= / ?p=) */
const override: Partial<Record<AgentRole, string>> = {};
export function overrideAgentModel(role: AgentRole, file: string | null): void {
  if (file) override[role] = file; else delete override[role];
}

export const agentModelUrl = (role: AgentRole) => `/madp/models/agents/${override[role] ?? AGENTS[role].model}`;

/** the clips a guide plays: the cast's shared set for the guide's build (one skeleton for every Rocketbox person) */
export const agentClipsUrl = (role: AgentRole) => `${PEOPLE_BASE}anims-${AGENTS[role].build}.glb`;

/** the SELISE chest logo (globe + wordmark, from the SELISE brand SVG) */
export const LOGO_URL = "/madp/models/agents/selise-logo.png";
