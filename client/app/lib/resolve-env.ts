import { getRuntimeEnv, type RuntimeKey } from "./runtime-env";

/**
 * Resolves placeholders in window.__BLOCKS_ENV__ using getRuntimeEnv.
 * This should be imported as early as possible in the application entry point
 * to ensure that all services and libraries receive the actual environment values
 * instead of the __BLOCKS_...__ placeholders.
 */
export const resolveEnv = () => {
  const blocksEnv =
    typeof window !== "undefined"
      ? (window.__BLOCKS_ENV__ as Record<string, string | undefined>)
      : undefined;
  if (blocksEnv) {
    for (const key in blocksEnv) {
      const value = blocksEnv[key];
      if (
        value &&
        typeof value === "string" &&
        value.startsWith("__BLOCKS_") &&
        value.endsWith("__")
      ) {
        blocksEnv[key] = getRuntimeEnv(key as RuntimeKey);
      }
    }
  }
};

// Execute immediately upon import
resolveEnv();
