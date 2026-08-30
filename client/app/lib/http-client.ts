import { SERVICE_NAME } from "@/constants/service.constant";
import { HttpClient, getRuntimeEnv } from "@seliseblocks/genesis-os/lib";
import { createHttpFailureReporter, getRollbar } from "@seliseblocks/genesis-os/observability";

// Only failures that never reached the server -- API unreachable, DNS, CORS, TLS. Anything with an
// HTTP status is skipped: a 5xx is already reported server-side with a real stack trace, and 4xx is
// a business outcome the UI surfaces. `getRollbar` is memoised, so every client below and the
// provider in main.tsx share one instance - a second would install a second set of window handlers
// and split the breadcrumb buffer.
const reportTransportFailure = createHttpFailureReporter(getRollbar({ service: SERVICE_NAME }));

const monitorService = new HttpClient({
  baseURL: getRuntimeEnv("BLOCKS_MONITOR_BASE_URL") || "",
  blocksKey: getRuntimeEnv("BLOCKS_X_BLOCKS_KEY") || "",
  onError: reportTransportFailure,
});

export const serviceInstances = {
  monitorService,
  /** @deprecated use monitorService */
  observabilityService: monitorService,
  logicService: new HttpClient({
    baseURL: getRuntimeEnv("BLOCKS_LOGIC_BASE_URL") || "",
    blocksKey: getRuntimeEnv("BLOCKS_X_BLOCKS_KEY") || "",
    onError: reportTransportFailure,
  }),
  idpService: new HttpClient({
    baseURL: getRuntimeEnv("BLOCKS_IAM_BASE_URL") || "",
    blocksKey: getRuntimeEnv("BLOCKS_X_BLOCKS_KEY") || "",
    onError: reportTransportFailure,
  }),
};

export { HttpClient };
