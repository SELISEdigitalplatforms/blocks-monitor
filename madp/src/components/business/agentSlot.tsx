/** The slot for the business agent's line on Project setup ("Your business agent filed 8 documents and found 4
 *  must-haves — Review"). It is built in src/components/setup/agent (export `SetupAgentLine`, props below); until that
 *  module exists the slot renders nothing. */
import type { ComponentType } from "react";

export interface SetupAgentLineProps { projectId: string }

const found = import.meta.glob<{ SetupAgentLine?: ComponentType<SetupAgentLineProps> }>("../setup/agent/index.{ts,tsx}", { eager: true });

/** The agent line component when it exists, else null. */
export const SetupAgentLine: ComponentType<SetupAgentLineProps> | null = Object.values(found)[0]?.SetupAgentLine ?? null;
