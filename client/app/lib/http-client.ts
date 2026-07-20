import { HttpClient, getRuntimeEnv } from "@seliseblocks/blocks-kit/lib";

const monitorService = new HttpClient({
  baseURL: getRuntimeEnv("BLOCKS_MONITOR_BASE_URL") || "",
  blocksKey: getRuntimeEnv("BLOCKS_X_BLOCKS_KEY") || "",
});

export const serviceInstances = {
  monitorService,
  /** @deprecated use monitorService */
  observabilityService: monitorService,
  logicService: new HttpClient({
    baseURL: getRuntimeEnv("BLOCKS_LOGIC_BASE_URL") || "",
    blocksKey: getRuntimeEnv("BLOCKS_X_BLOCKS_KEY") || "",
  }),
  idpService: new HttpClient({
    baseURL: getRuntimeEnv("BLOCKS_IAM_BASE_URL") || "",
    blocksKey: getRuntimeEnv("BLOCKS_X_BLOCKS_KEY") || "",
  }),
};

export { HttpClient };
