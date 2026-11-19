/**
 * Blocks project context: provides the current Blocks project ID to MADP components.
 * Used to filter MADP data (projects, dashboard, etc.) to only show data
 * belonging to the current Blocks project.
 */
import { createContext, useContext, type ReactNode } from "react";

interface BlocksProjectContext {
  /** The current Blocks project's ItemId (from /app/:itemId/) */
  blocksProjectId: string;
}

const Ctx = createContext<BlocksProjectContext>({ blocksProjectId: "" });

export function BlocksProjectProvider({ blocksProjectId, children }: { blocksProjectId: string; children: ReactNode }) {
  return <Ctx.Provider value={{ blocksProjectId }}>{children}</Ctx.Provider>;
}

/** The current Blocks project ID. Empty string when outside the Blocks shell. */
export function useBlocksProjectId(): string {
  return useContext(Ctx).blocksProjectId;
}
