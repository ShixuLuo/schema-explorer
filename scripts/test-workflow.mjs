import { spawn } from "node:child_process";
import { root, rustRuntime } from "./runtime.mjs";
const { cargo, env } = rustRuntime();
const server = spawn(
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
  {
    cwd: root,
    env: { ...env, SCHEMA_PORT: "0" },
    stdio: ["ignore", "pipe", "pipe"],
  },
);
server.stderr.on("data", (data) => process.stderr.write(data));
let output = "",
  runner;
try {
  const origin = await new Promise((resolve, reject) => {
    const timeout = setTimeout(
      () => reject(new Error("The test Rust service did not start.")),
      60000,
    );
    server.on("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    server.on("exit", (code) => {
      clearTimeout(timeout);
      reject(new Error(`The test Rust service exited (${code}).`));
    });
    server.stdout.on("data", (data) => {
      output += data;
      const match = output.match(
        /Schema Explorer service: (http:\/\/127\.0\.0\.1:\d+)/,
      );
      if (match) {
        clearTimeout(timeout);
        resolve(match[1]);
      }
    });
  });
  runner = spawn(
    process.execPath,
    [
      "--experimental-strip-types",
      "--test",
      "frontend/src/application/workflow.test.ts",
      "frontend/src/application/architecture.test.ts",
      "frontend/src/diagram/diagram.test.ts",
    ],
    {
      cwd: root,
      env: { ...process.env, SCHEMA_TEST_ORIGIN: origin },
      stdio: "inherit",
    },
  );
  process.exitCode = await new Promise((resolve, reject) => {
    runner.on("error", reject);
    runner.on("exit", (code) => resolve(code ?? 1));
  });
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
} finally {
  runner?.kill("SIGTERM");
  server.kill("SIGTERM");
}
