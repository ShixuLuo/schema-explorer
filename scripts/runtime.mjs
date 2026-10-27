import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
export const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
export function rustRuntime() {
  const file = path.join(root, ".local", "runtime.json");
  const config = existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : {};
  const env = { ...process.env };
  if (config.rustc) env.RUSTC = config.rustc;
  if (config.rustdoc) env.RUSTDOC = config.rustdoc;
  if (config.cargoHome) env.CARGO_HOME = config.cargoHome;
  return { cargo: process.env.SCHEMA_CARGO || config.cargo || "cargo", env };
}
