import { spawn, spawnSync } from "node:child_process";
import { root, rustRuntime } from "./runtime.mjs";
const { cargo, env } = rustRuntime();
if (spawnSync(cargo, ["--version"], { env }).status !== 0) {
  console.error(
    "Cargo is required. Install Rust, or set SCHEMA_CARGO to your cargo executable.",
  );
  process.exit(1);
}
const children = [
  spawn(
    cargo,
    [
      "run",
      "--manifest-path",
      "backend/Cargo.toml",
      "--features",
      "server",
      "--bin",
      "server",
    ],
    { cwd: root, env, stdio: "inherit" },
  ),
  spawn(
    process.execPath,
    ["node_modules/vite/bin/vite.js", "--host", "127.0.0.1"],
    { cwd: root, env, stdio: "inherit" },
  ),
];
let stopping = false;
function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  for (const child of children) child.kill("SIGTERM");
  setTimeout(() => process.exit(code), 300).unref();
}
for (const child of children) {
  child.on("error", (err) => {
    console.error(err.message);
    stop(1);
  });
  child.on("exit", (code) => {
    if (!stopping) stop(code ?? 1);
  });
}
process.on("SIGINT", () => stop());
process.on("SIGTERM", () => stop());
