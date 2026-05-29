import fs from "fs";
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

// https://vite.dev/config/
export default defineConfig({
  server: {
    host: "0.0.0.0",
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
  clearScreen: false,
  plugins: [react(), tailwindcss()],
});
