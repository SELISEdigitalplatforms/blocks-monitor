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

  if (!blocksEnv) return;

  for (const key in blocksEnv) {
    const value = blocksEnv[key];
    if (value?.startsWith("__BLOCKS_") && value.endsWith("__")) {
      // Read directly from Vite env, bypassing the window object entirely
      blocksEnv[key] = import.meta.env[key] || "";
    }
  }
};

// Execute immediately upon import
resolveEnv();
