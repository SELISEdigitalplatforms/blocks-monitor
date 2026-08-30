/**
 * How this app identifies itself to shared infrastructure.
 *
 * Declared once because more than one call site needs it and a mismatch would not fail loudly:
 * the Rollbar client is memoised on first use, so a second call passing a different name is
 * silently ignored and half the reports would be filed under the wrong service.
 *
 * This is the name `BlocksAppLayout` is given in main.tsx, and the customer-facing product name.
 * The API reports itself as "blocks-monitor-api" instead - that is the serviceName its
 * `ConfigureApi` call already uses for logging and IAM, and Rollbar reads it from there rather
 * than from anything we set. So filter Rollbar on `component` (client / api), or on both service
 * names; `service:blocks-monitor` alone returns browser items only.
 */
export const SERVICE_NAME = "blocks-monitor";
