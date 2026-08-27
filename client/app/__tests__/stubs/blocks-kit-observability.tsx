import type { ReactNode } from "react";

/**
 * Test stub for `@seliseblocks/genesis-os/observability`.
 *
 * The real subpath builds a Rollbar client at import time, and its config reads runtime env
 * through the package's own inlined copy of `getRuntimeEnv` -- not the one behind the `/lib`
 * entry point. Specs that `vi.mock("@seliseblocks/genesis-os/lib")` therefore do not cover it,
 * and the real getter falls through to `import.meta.env`, which is undefined in the externalized
 * dependency under vitest: `TypeError: Cannot read properties of undefined`. Since `http-client`
 * calls `getRollbar` at module scope, that took down every spec importing a service.
 *
 * Stubbing rather than seeding a token is also the behaviour we want: tests should not construct
 * a real notifier or install its window handlers. Nothing here asserts on reporting.
 */

export function RollbarProvider({ children }: Readonly<{ children?: ReactNode }>) {
  return <>{children}</>;
}

/** Shaped like the Rollbar surface the app touches -- it only ever hands the instance onward. */
export const getRollbar = () => ({
  error: () => {},
  warning: () => {},
  info: () => {},
});

export const createHttpFailureReporter = () => () => {};

/** The real one returns an unsubscribe; callers ignore it, but keep the shape honest. */
export const attachQueryErrorReporting = () => () => {};
