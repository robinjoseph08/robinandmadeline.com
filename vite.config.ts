import fs from "fs";
import { hostname } from "os";
import path from "path";

import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

/**
 * Resolves the API server port with the following priority:
 *   1. API_PORT environment variable
 *   2. tmp/api.port file (written by the API server at startup)
 *   3. Default port 8400
 */
function getApiPort(): number {
  if (process.env.API_PORT) {
    const port = parseInt(process.env.API_PORT, 10);
    if (!isNaN(port)) {
      return port;
    }
  }

  const portFilePath = path.resolve(__dirname, "tmp/api.port");
  try {
    if (fs.existsSync(portFilePath)) {
      const content = fs.readFileSync(portFilePath, "utf-8").trim();
      const port = parseInt(content, 10);
      if (!isNaN(port)) {
        return port;
      }
    }
  } catch {
    // Ignore errors and fall through to the default.
  }

  return 8400;
}

// Other machines on the network reach the dev server by this machine's name
// (bare over Tailscale MagicDNS, with a .local suffix over mDNS). Vite only
// allows localhost hosts by default. macOS can report the hostname with a
// domain suffix (robin-m3.local, robin-m3.lan), so keep just the first label.
const machine = hostname().toLowerCase().split(".")[0];

// https://vite.dev/config/
export default defineConfig({
  server: {
    host: "0.0.0.0",
    allowedHosts: [machine, `${machine}.local`],
    port: 8401,
    strictPort: false,
    proxy: {
      // Forward all /api requests to the Go server, preserving the /api prefix
      // since the backend mounts its routes under /api.
      "/api": {
        target: `http://localhost:${getApiPort()}`,
        changeOrigin: true,
      },
    },
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./app"),
    },
  },
  build: {
    outDir: "./build/app",
    emptyOutDir: true,
  },
  // Let the e2e harness point Vite at an isolated cache dir (VITE_CACHE_DIR) so a
  // run does not corrupt the dev server's dependency pre-bundle, or another
  // concurrent Vite's, when several run from this same project directory.
  cacheDir: process.env.VITE_CACHE_DIR || undefined,
  clearScreen: false,
  plugins: [react(), tailwindcss()],
});
