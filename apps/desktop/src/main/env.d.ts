/// <reference types="electron-vite/node" />

interface ImportMetaEnv {
  readonly MAIN_VITE_SERVER_URL?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
