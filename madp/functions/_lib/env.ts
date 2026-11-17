// The four function variables, read from the platform ctx.env. Values are never logged or put in errors.
import { OpError } from "./errors";
import { utilitiesBaseOf } from "../../src/domain/blocksUtilities";

export const ENV_KEYS = ["BLOCKS_API_URL", "BLOCKS_TENANT", "SVC_CLIENT_ID", "SVC_CLIENT_SECRET"] as const;

export interface FnEnv {
  apiUrl: string;
  tenant: string;
  clientId: string;
  clientSecret: string;
  factoryDesignWorkerId?: string;
  figmaDesignWorkerId?: string;
  extractionWorkerId?: string;
  /** Where Blocks Utilities is called: a gateway path (default "/utilities/v4") or the Utilities host's API root. */
  utilitiesBase?: string;
}

export function readEnv(env: unknown): FnEnv {
  const src = env && typeof env === "object" ? (env as Record<string, unknown>) : {};
  const value = (key: (typeof ENV_KEYS)[number]): string => {
    const v = src[key];
    if (typeof v !== "string" || v.trim() === "") throw new OpError("not_configured");
    return v;
  };
  const clientSecret = value("SVC_CLIENT_SECRET");
  if (clientSecret.includes("{{secret.")) throw new OpError("not_configured");
  const apiUrl = value("BLOCKS_API_URL").trim().replace(/\/+$/, "");
  if (!/^https:\/\/[^\s/]+/.test(apiUrl)) throw new OpError("not_configured");
  const factoryDesignWorkerId = src.FACTORY_DESIGN_WORKER_ID;
  if (factoryDesignWorkerId !== undefined && (typeof factoryDesignWorkerId !== "string" || !/^[A-Za-z0-9_-]{1,100}$/.test(factoryDesignWorkerId))) throw new OpError("not_configured");
  const worker = (key: string): string | undefined => {
    const id = src[key];
    if (id === undefined) return undefined;
    if (typeof id !== 'string' || !/^[A-Za-z0-9_-]{1,100}$/.test(id)) throw new OpError('not_configured');
    return id;
  };
  return { apiUrl, tenant: value("BLOCKS_TENANT").trim(), clientId: value("SVC_CLIENT_ID").trim(), clientSecret,
    ...(factoryDesignWorkerId ? { factoryDesignWorkerId: factoryDesignWorkerId as string } : {}),
    figmaDesignWorkerId: worker('FIGMA_DESIGN_WORKER_ID'), extractionWorkerId: worker('EXTRACTION_WORKER_ID'),
    ...(src.BLOCKS_UTILITIES_BASE !== undefined ? { utilitiesBase: utilitiesBaseOf(src.BLOCKS_UTILITIES_BASE) } : {}) };
}
