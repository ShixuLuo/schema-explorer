import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
export default defineConfig({
  root: "frontend",
  plugins: [react()],
  optimizeDeps: { include: ["papaparse"], exclude: ["@electric-sql/pglite"] },
  server: { port: 5173, strictPort: true },
  build: { outDir: "../dist", emptyOutDir: true },
  worker: { format: "es" },
});
