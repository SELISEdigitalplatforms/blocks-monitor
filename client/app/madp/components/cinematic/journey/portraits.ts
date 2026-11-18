import { create } from "zustand";

/** The guides' captured portraits (data URLs), for the composer and the transcript. */
export const usePortraits = create<{ assistant: string | null; pm: string | null; set: (role: "assistant" | "pm", url: string) => void }>()((set) => ({
  assistant: null,
  pm: null,
  set: (role, url) => set({ [role]: url }),
}));
