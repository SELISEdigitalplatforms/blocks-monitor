// The hub connection seen from the doorbell. The hub client package is not installed yet, so no transport exists.
export type HubState = "connecting" | "connected" | "reconnecting" | "disconnected";

export interface HubTransport {
  start(): Promise<void>;
  stop(): Promise<void>;
  on(method: string, handler: () => void): () => void;
  onState(cb: (s: HubState) => void): () => void;
}

export type HubTransportFactory = (url: string) => HubTransport | null;

// Pending: signalrTransport.ts replaces this once the hub client package is installed. Until then the bell polls.
export const createHubTransport: HubTransportFactory = () => null;
