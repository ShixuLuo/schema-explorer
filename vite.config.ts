import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
export default defineConfig({
  root: "frontend",
  plugins: [react()],
  optimizeDeps: { include: ["papaparse"], exclude: ["@electric-sql/pglite"] },
  server: {
    port: 5173,
    strictPort: true,
    fs: {
      deny: [".env", ".env.*", "*.{crt,pem}", "**/.git/**", "**/.local/**"],
    },
    proxy: {
      "/api/ai": {
        target: process.env.AI_API_URL ?? "http://127.0.0.1:5184",
        changeOrigin: true,
      },
      "/api/cql": {
        target: process.env.CQL_API_URL ?? "http://127.0.0.1:5185",
        changeOrigin: true,
      },
    },
  },
  build: { outDir: "../dist", emptyOutDir: true },
  worker: { format: "es" },
});
