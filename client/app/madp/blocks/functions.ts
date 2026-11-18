// The SELISE Blocks Logic Function registry: the only place that knows function ids and invoke paths.
import type { BlocksRequestOptions } from "@seliseblocks/client";
import idsJson from "./function-ids.json";

export type FunctionName = "workspace" | "project" | "delivery" | "collab" | "admin" | "billing";

export const FUNCTION_NAMES: readonly FunctionName[] = ["workspace", "project", "delivery", "collab", "admin", "billing"];

export const FUNCTION_SLUG: Record<FunctionName, string> = {
  workspace: "mf-workspace",
  project: "mf-project",
  delivery: "mf-delivery",
  collab: "mf-collab",
  admin: "mf-admin",
  billing: "mf-billing",
};

const SAFE_ID = /^[A-Za-z0-9_-]{1,64}$/;
const GUID = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
const POLL_TOKEN = /^[\x20-\x7e]{1,512}$/;

/** Read the deploy-written ids file; unknown keys are ignored and a bad value counts as not configured. */
export function functionIdsFrom(json: unknown): Readonly<Record<FunctionName, string | null>> {
  const src = typeof json === "object" && json !== null ? (json as Record<string, unknown>) : {};
  const out = {} as Record<FunctionName, string | null>;
  for (const name of FUNCTION_NAMES) {
    const v = Object.prototype.hasOwnProperty.call(src, name) ? src[name] : null;
    out[name] = typeof v === "string" && SAFE_ID.test(v) ? v : null;
  }
  return out;
}

// written by the deploy script (scripts/functions-deploy.mjs) after a successful deploy
export const FUNCTION_IDS: Readonly<Record<FunctionName, string | null>> = Object.freeze(functionIdsFrom(idsJson));

export type FunctionHost = "local" | "blocks";

declare const __MF_FN_HOST__: string | undefined;

// 'local' (Host A, the Vite dev server) only when the dev plugin injected it; vitest and vite build get 'blocks'
export const FUNCTION_HOST: FunctionHost = typeof __MF_FN_HOST__ !== "undefined" && __MF_FN_HOST__ === "local" ? "local" : "blocks";

/** Thrown when a function cannot be reached: no SELISE Blocks id yet, or the local server has no service credential. */
export class FunctionNotConfiguredError extends Error {
  readonly fn: FunctionName;
  readonly reason: "id" | "server";
  constructor(fn: FunctionName, reason: "id" | "server" = "id") {
    super(
      reason === "server"
        ? `The ${FUNCTION_SLUG[fn]} function is not configured yet on this computer (the MADP Factory server has no service credential; see Local setup in functions/README.md).`
        : `The ${FUNCTION_SLUG[fn]} function is not configured yet.`,
    );
    this.name = "FunctionNotConfiguredError";
    this.fn = fn;
    this.reason = reason;
  }
}

export interface ResolvedFunction {
  name: FunctionName;
  slug: string;
  host: FunctionHost;
  id: string | null;
  invokePath: string;
  pollRequest(runId: string, pollToken: string): { path: string; options: BlocksRequestOptions };
}

/** Resolve a function to its invoke path and poll request; throws when a Blocks function has no id. */
export function resolveFunction(
  name: FunctionName,
  ids: Readonly<Record<FunctionName, string | null>> = FUNCTION_IDS,
  host: FunctionHost = "blocks",
): ResolvedFunction {
  if (!FUNCTION_NAMES.includes(name)) throw new TypeError(`Unknown function "${String(name)}".`);
  if (host === "local") {
    return {
      name,
      slug: FUNCTION_SLUG[name],
      host,
      id: null,
      invokePath: `/api/fn/${name}`,
      pollRequest(): never {
        throw new TypeError("The local host answers directly; there is nothing to poll.");
      },
    };
  }
  const id = ids[name];
  if (id === null || id === undefined || id === "") throw new FunctionNotConfiguredError(name);
  if (!SAFE_ID.test(id)) throw new TypeError(`Invalid function id for ${FUNCTION_SLUG[name]}.`);
  // Both path shapes are to be confirmed by probe F0-2 and changed only here.
  return {
    name,
    slug: FUNCTION_SLUG[name],
    host,
    id,
    invokePath: `/logic/v4/fn/${id}`,
    pollRequest(runId: string, pollToken: string) {
      if (!GUID.test(runId)) throw new TypeError("Invalid run id.");
      if (!POLL_TOKEN.test(pollToken)) throw new TypeError("Invalid poll token.");
      return { path: `/logic/v4/fn/runs/${runId}/result`, options: { method: "GET", headers: { "x-poll-token": pollToken } } };
    },
  };
}
