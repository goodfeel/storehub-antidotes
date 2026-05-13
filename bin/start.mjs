#!/usr/bin/env node
/**
 * Production entry point. Verifies the build artifact exists before booting
 * `dist/index.js`, so misconfigured deploys fail with a clear actionable
 * message instead of a raw MODULE_NOT_FOUND stack trace.
 */
import { existsSync } from "node:fs";
import { spawn } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(__dirname, "..");
const entry = resolve(projectRoot, "dist/index.js");

if (!existsSync(entry)) {
  console.error(
    [
      "",
      "ERROR: dist/index.js was not found at:",
      `  ${entry}`,
      "",
      "The production bundle has not been built on this host.",
      "Run the build step before starting the server, e.g.:",
      "",
      "  pnpm install --frozen-lockfile",
      "  pnpm build",
      "",
      "Or run the combined release step (install + build + migrate):",
      "",
      "  pnpm release",
      "",
    ].join("\n")
  );
  process.exit(1);
}

process.env.NODE_ENV ??= "production";

const child = spawn(process.execPath, [entry], {
  stdio: "inherit",
  cwd: projectRoot,
});

const forward = (signal) => {
  if (!child.killed) child.kill(signal);
};
process.on("SIGTERM", () => forward("SIGTERM"));
process.on("SIGINT", () => forward("SIGINT"));
process.on("SIGHUP", () => forward("SIGHUP"));

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 0);
});
