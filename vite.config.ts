import { defineConfig } from "vite";
import { resolve } from "path";

const host = process.env.TAURI_DEV_HOST;

export default defineConfig(async () => ({
  resolve: {
    alias: {
      "@": resolve(__dirname, "src"),
    },
  },
  // Workers build as ES modules: the default, iife, can't code-split, and the
  // highlighting worker (src/ui/code_highlight.worker.ts) loads the
  // highlight.js core and each grammar as chunks of their own.
  worker: {
    format: "es",
  },
  clearScreen: false,
  server: {
    port: 1450,
    strictPort: false,
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      ignored: ["**/src-tauri/**"],
      followSymlinks: false,
    },
  },
}));
