/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly BLOCKS_IAM_BASE_URL: string;
  readonly BLOCKS_X_BLOCKS_KEY: string;
  readonly BLOCKS_GOOGLE_SITE_KEY: string;
  readonly BLOCKS_CONSTRUCT_URL: string;
  readonly BLOCKS_GITHUB_SSO_CLIENT_ID: string;
  readonly BLOCKS_OIDC_CLIENT_ID: string;
  readonly BLOCKS_BASE_DOMAIN: string;
  readonly BLOCKS_IAM_CALLBACK_URL: string;
  readonly BLOCKS_LOCALIZATION_BASE_URL: string;
  readonly BLOCKS_LOCALIZATION_CALLBACK_URL: string;
  readonly BLOCKS_AGENTS_BASE_URL: string;
  readonly BLOCKS_AGENTS_CALLBACK_URL: string;
  readonly BLOCKS_DATA_BASE_URL: string;
  readonly BLOCKS_DATA_CALLBACK_URL: string;
  readonly BLOCKS_OS_BASE_URL: string;
  readonly BLOCKS_OS_CALLBACK_URL: string;
  readonly BLOCKS_UTILITIES_BASE_URL: string;
  readonly BLOCKS_UTILITIES_CALLBACK_URL: string;
  readonly BLOCKS_LOGIC_BASE_URL: string;
  readonly BLOCKS_LOGIC_CALLBACK_URL: string;
  readonly BLOCKS_MONITOR_BASE_URL: string;
  readonly BLOCKS_MONITOR_CALLBACK_URL: string;
  readonly BLOCKS_RELEASE_BASE_URL: string;
  readonly BLOCKS_RELEASE_CALLBACK_URL: string;
  readonly BLOCKS_STUDIO_BASE_URL: string;
  readonly BLOCKS_STUDIO_CALLBACK_URL: string;
  readonly BLOCKS_DEV_HOST: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

declare module "*.svg?react" {
  import type { FC, SVGProps } from "react";
  const ReactComponent: FC<SVGProps<SVGSVGElement> & { title?: string }>;
  export default ReactComponent;
}
