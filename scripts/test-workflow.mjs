import { spawn } from "node:child_process";
import { readdir } from "node:fs/promises";
const files = (await readdir("frontend/src", { recursive: true }))
  .filter((file) => file.endsWith(".test.ts"))
  .map((file) => `frontend/src/${file}`);
const runner = spawn(
  process.execPath,
  ["--experimental-strip-types", "--test", ...files],
  { stdio: "inherit" },
);
runner.on("exit", (code) => {
  process.exitCode = code ?? 1;
});
