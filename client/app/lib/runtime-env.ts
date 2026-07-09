const PLACEHOLDER_PREFIX = "__BLOCKS_";

export type RuntimeKey =
  | "BLOCKS_X_BLOCKS_KEY"
  | "BLOCKS_GOOGLE_SITE_KEY"
  | "BLOCKS_CONSTRUCT_URL"
  | "BLOCKS_GITHUB_SSO_CLIENT_ID"
  | "BLOCKS_OIDC_CLIENT_ID"
  | "BLOCKS_BASE_DOMAIN"
  | "BLOCKS_DEV_HOST"
  | "BLOCKS_IAM_BASE_URL"
  | "BLOCKS_IAM_CALLBACK_URL"
  | "BLOCKS_LOCALIZATION_BASE_URL"
  | "BLOCKS_LOCALIZATION_CALLBACK_URL"
  | "BLOCKS_AGENTS_BASE_URL"
  | "BLOCKS_AGENTS_CALLBACK_URL"
  | "BLOCKS_DATA_BASE_URL"
  | "BLOCKS_DATA_CALLBACK_URL"
  | "BLOCKS_OS_BASE_URL"
  | "BLOCKS_OS_CALLBACK_URL"
  | "BLOCKS_UTILITIES_BASE_URL"
  | "BLOCKS_UTILITIES_CALLBACK_URL"
  | "BLOCKS_LOGIC_BASE_URL"
  | "BLOCKS_LOGIC_CALLBACK_URL"
  | "BLOCKS_MONITOR_BASE_URL"
  | "BLOCKS_MONITOR_CALLBACK_URL"
  | "BLOCKS_RELEASE_BASE_URL"
  | "BLOCKS_RELEASE_CALLBACK_URL"
  | "BLOCKS_STUDIO_BASE_URL"
  | "BLOCKS_STUDIO_CALLBACK_URL"
  | "BLOCKS_DATA_CLIENT_ID"
  | "BLOCKS_IAM_CLIENT_ID"
  | "BLOCKS_LOCALIZATION_CLIENT_ID"
  | "BLOCKS_AGENTS_CLIENT_ID"
  | "BLOCKS_OS_CLIENT_ID"
  | "BLOCKS_UTILITIES_CLIENT_ID"
  | "BLOCKS_LOGIC_CLIENT_ID"
  | "BLOCKS_MONITOR_CLIENT_ID"
  | "BLOCKS_RELEASE_CLIENT_ID"
  | "BLOCKS_STUDIO_CLIENT_ID";

const isPlaceholder = (value?: string) =>
  !!value && value.startsWith(PLACEHOLDER_PREFIX) && value.endsWith("__");

type GetRuntimeEnvOptions = {
  stripPort?: boolean;
  ensureTrailingSlash?: boolean;
};

const stripPortFromUrl = (url: string) => {
  try {
    const parsedUrl = new URL(url);
    parsedUrl.port = "";
    return parsedUrl.toString();
  } catch (error) {
    console.error(`Failed to parse URL: ${url}`, error);
    return url;
  }
};

const ensureTrailingSlash = (url: string) =>
  url.endsWith("/") ? url : `${url}/`;

const isLocalEnv = () => {
  if (import.meta.env.DEV) return true;

  if (typeof window !== "undefined") {
    const { hostname } = window.location;
    return hostname === "localhost" || hostname === "127.0.0.1";
  }

  return false;
};

export const getRuntimeEnv = (
  key: RuntimeKey,
  options: GetRuntimeEnvOptions = {},
): string => {
  let value = "";

  // Cast to a wider record type since Window.__BLOCKS_ENV__ is declared by blocks-kit
  // and its RuntimeKey union may differ from ours
  const env =
    typeof window !== "undefined"
      ? (window.__BLOCKS_ENV__ as Partial<Record<string, string>> | undefined)
      : undefined;

  const windowValue = env?.[key];

  if (windowValue && !isPlaceholder(windowValue)) {
    value = windowValue;
  } else {
    value = import.meta.env[key] || "";
  }

  if (options.stripPort && !isLocalEnv()) {
    value = stripPortFromUrl(value);
  }

  if (value && options.ensureTrailingSlash) {
    value = ensureTrailingSlash(value);
  }

  return value;
};
