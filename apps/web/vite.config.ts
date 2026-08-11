import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Dev: `bs web` runs the API on :4319; Vite proxies /api to it.
export default defineConfig({
  plugins: [react()],
  server: {
    host: true,
    port: 5319,
    allowedHosts: true,
    proxy: { "/api": "http://localhost:4319" },
  },
  build: { outDir: "dist", emptyOutDir: true },
});
