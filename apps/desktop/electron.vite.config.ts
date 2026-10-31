import { resolve } from "node:path"

import tailwindcss from "@tailwindcss/vite"
import react from "@vitejs/plugin-react"
import { defineConfig } from "electron-vite"

// Workspace packages ship TypeScript source, so they are bundled, not externalized
const workspace = ["@crew/shared"]

export default defineConfig({
  main: {
    build: { externalizeDeps: { exclude: workspace } },
  },
  preload: {
    build: {
      externalizeDeps: { exclude: workspace },
      // Sandboxed preloads must be CommonJS
      rollupOptions: { output: { format: "cjs", entryFileNames: "[name].cjs" } },
    },
  },
  renderer: {
    resolve: { alias: { "@": resolve(__dirname, "src/renderer/src") } },
    plugins: [react(), tailwindcss()],
  },
})
