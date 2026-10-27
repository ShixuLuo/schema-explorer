import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
export default defineConfig({
  root: "frontend",
  plugins: [react()],
  optimizeDeps: { include: ["papaparse"] },
  server: {
    port: 5173,
    strictPort: true,
    proxy: { "/api": "http://127.0.0.1:7331" },
  },
  build: { outDir: "../dist", emptyOutDir: true },
  worker: { format: "es" },
});
