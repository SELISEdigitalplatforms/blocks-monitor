// SELISE Blocks OS: the app's NON-SECRET settings.
// In Blocks shell integration: use "embedded" mode so MADP calls go through
// the BFF proxy (/api/data, /api/fn) rather than directly to blocksapi.slsblx.com.
export interface BlocksConfig {
  readonly apiUrl: string;
  readonly projectKey: string;
  readonly oidcClientId: string;
  readonly oidcUrl: string;
  readonly oidcScope: string;
  readonly authMode: "embedded" | "hosted";
}

const config: BlocksConfig = Object.freeze({
  apiUrl: "https://blocksapi.slsblx.com",
  projectKey: "D9c1e01c294f04d9e8af59b5caf80ebcb",
  oidcClientId: "",
  oidcUrl: "",
  oidcScope: "openid profile",
  authMode: "embedded",
});

export const blocksConfig = (): BlocksConfig => config;
export const hostedLoginEnabled = (): boolean => false;
export const usesBlocksCloud = (): boolean => true;
export const adminMounted = (): boolean => true;

export { config as BLOCKS_CONFIG };
