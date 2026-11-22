// The official Blocks SDK factory. Handlers and tests inject a SdkFactory so no test touches the network.
import { createBlocksClient } from "@seliseblocks/client";

export type SdkClient = ReturnType<typeof createBlocksClient>;

export interface SdkOptions {
  apiUrl: string;
  xBlocksKey: string;
  accessToken?: string;
  fetch?: typeof fetch;
}

export type SdkFactory = (o: SdkOptions) => SdkClient;

export const defaultSdk: SdkFactory = (o) => createBlocksClient(o);
