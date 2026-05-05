/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_CAMPAIGN_ADDRESS?: `0x${string}`;
  readonly VITE_TOKEN_ADDRESS?: `0x${string}`;
  readonly VITE_E2E_SINGLE_WALLET?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
