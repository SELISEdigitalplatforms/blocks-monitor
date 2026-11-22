/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_BLOCKS_API_URL?: string;
  readonly VITE_BLOCKS_PROJECT_KEY?: string;
  readonly VITE_MF_NOTIFIER_HUB_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
