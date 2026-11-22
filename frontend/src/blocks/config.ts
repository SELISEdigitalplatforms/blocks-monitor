// SELISE Blocks OS: the app's NON-SECRET settings, read once. Client secrets never go in the web app.
export interface BlocksConfig {
  /** Blocks API base URL used by the hosted SDK or the historical same-origin bridge. */
  readonly apiUrl: string;
  /** The x-blocks-key: the project's public tenant id. */
  readonly projectKey: string;
  readonly oidcClientId: string;
  readonly oidcUrl: string;
  readonly oidcScope: string;
  readonly authMode: "embedded" | "hosted";
}

const env = import.meta.env;

const config: BlocksConfig = Object.freeze({
  apiUrl: env.VITE_BLOCKS_API_URL || "https://blocksapi.slsblx.com",
  projectKey: env.VITE_BLOCKS_PROJECT_KEY || "D9c1e01c294f04d9e8af59b5caf80ebcb",
  oidcClientId: env.VITE_BLOCKS_OIDC_CLIENT_ID || "",
  oidcUrl: env.VITE_BLOCKS_OIDC_URL || "",
  oidcScope: env.VITE_BLOCKS_OIDC_SCOPE || "openid profile",
  authMode: env.VITE_BLOCKS_AUTH_MODE === "embedded" ? "embedded" : "hosted",
});

export const blocksConfig = (): BlocksConfig => config;
export const hostedLoginEnabled = (): boolean => config.authMode === "hosted" && Boolean(config.oidcClientId && config.oidcUrl);
export const usesBlocksCloud = (): boolean => config.authMode === "embedded" || hostedLoginEnabled();
/** The platform admin function (mf-admin) is served by this app's own function host: the local host and the Blocks host
 *  (embedded sign-in, server/blocks/backend.ts) both mount it, so the Admin entry shows there for platform admins. With
 *  hosted (OIDC) sign-in the functions run as Blocks Logic Functions, where the admin people ops have no caller token,
 *  so the app neither calls it nor shows the Admin entry. */
export const adminMounted = (): boolean => !hostedLoginEnabled();

export { config as BLOCKS_CONFIG };
