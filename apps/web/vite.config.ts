import { defineConfig, type PluginOption } from "vite";
import react from "@vitejs/plugin-react";
import { spawn, type ChildProcess } from "node:child_process";

const API_PORT = 4319;

// Dev: the API runs on :4319 and Vite proxies /api to it.
// This plugin auto-starts the `bs web` API server alongside Vite so the
// single dev command boots the full stack (and cleans it up on exit).
function apiServer(): PluginOption {
  let child: ChildProcess | undefined;
  return {
    name: "backstory-api-server",
    apply: "serve",
    async configureServer() {
      // Skip if an API server is already listening on the port.
      const alreadyUp = await fetch(`http://localhost:${API_PORT}/api/stats`)
        .then((r) => r.ok)
        .catch(() => false);
      if (alreadyUp) return;

      child = spawn("pnpm", ["--filter", "@backstory/cli", "run", "bs", "web", "--no-open"], {
        cwd: "../..",
        stdio: "inherit",
        env: process.env,
      });

      const stop = () => {
        if (child && !child.killed) child.kill("SIGTERM");
      };
      process.on("exit", stop);
      process.on("SIGINT", stop);
      process.on("SIGTERM", stop);
    },
  };
}

export default defineConfig({
  plugins: [react(), apiServer()],
  server: {
    port: 5319,
    proxy: { "/api": `http://localhost:${API_PORT}` },
  },
  build: { outDir: "dist", emptyOutDir: true },
});
