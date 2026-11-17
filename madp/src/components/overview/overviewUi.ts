/** Overview page state shared with the MADP assistant: the selected environment per project and the promotion run. */
import { create } from "zustand";
import type { Environment as EnvId } from "@/domain/promotion";

export const useOverviewUi = create<{
  envFor: Record<string, EnvId>;
  promoting: boolean;
  promoteError: string | null;
  setEnv: (projectId: string, env: EnvId) => void;
  requestPromote: () => void;
  endPromote: (error: string | null) => void;
}>((set, get) => ({
  envFor: {},
  promoting: false,
  promoteError: null,
  setEnv: (projectId, env) => set((s) => ({ envFor: { ...s.envFor, [projectId]: env } })),
  requestPromote: () => { if (!get().promoting) set({ promoting: true, promoteError: null }); },
  endPromote: (error) => set({ promoting: false, promoteError: error }),
}));
