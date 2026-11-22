// What the doorbell is doing right now. "off" means no hub connection is configured, so the bell only polls.
import { create } from "zustand";

export type DoorbellState = "off" | "connecting" | "live" | "polling";

const useStore = create<{ state: DoorbellState }>(() => ({ state: "off" }));

export function setDoorbellState(s: DoorbellState): void {
  if (useStore.getState().state !== s) useStore.setState({ state: s });
}

export function getDoorbellState(): DoorbellState {
  return useStore.getState().state;
}

export function useDoorbellState(): DoorbellState {
  return useStore((s) => s.state);
}
