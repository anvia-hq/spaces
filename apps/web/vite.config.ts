import { fileURLToPath, URL } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { tanstackRouter } from "@tanstack/router-plugin/vite";

const apiTarget = process.env.SPACES_API_URL ?? "http://localhost:8787";

export default defineConfig({
  plugins: [tanstackRouter({ target: "react", autoCodeSplitting: true }), react(), tailwindcss()],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  server: {
    port: 5173,
    proxy: {
      // `/health` lives at the API root, not under /api/v1. Without this the dev
      // server answers it with the SPA fallback, and a JSON parse of HTML makes
      // the console report the API as unreachable.
      "/health": {
        target: apiTarget,
        changeOrigin: true,
      },
      "/api": {
        target: apiTarget,
        changeOrigin: true,
      },
    },
  },
});
