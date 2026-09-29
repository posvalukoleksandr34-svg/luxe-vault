import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// Dev: `npm run dev` proxies API + WebSockets to the backend on :8000.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    proxy: {
      "/api": { target: process.env.JARVIS_API ?? "http://localhost:8000", changeOrigin: false, ws: true },
    },
  },
  // assetsInlineLimit 0: no data: URLs, so the strict CSP (font-src/img-src 'self') holds.
  build: { target: "es2022", sourcemap: false, chunkSizeWarningLimit: 900, assetsInlineLimit: 0 },
  test: { environment: "jsdom", setupFiles: ["./src/test/setup.ts"], css: false },
});
