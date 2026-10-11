import { build } from "esbuild";
import { spawnSync } from "node:child_process";
import { mkdir, rm } from "node:fs/promises";
import { fileURLToPath } from "node:url";

if (process.env.NODE_ENV === "production") throw new Error("Regression tests must not run in production");
const out = fileURLToPath(new URL("../node_modules/.cache/regression/", import.meta.url));
const suite = process.argv.includes("--browser") ? "browser" : process.argv.includes("--upgrade") ? "upgrade" : "critical";
await mkdir(out, { recursive: true });
try {
  await build({
    entryPoints: [fileURLToPath(new URL(`./${suite}.test.ts`, import.meta.url))],
    outfile: `${out}/critical.test.cjs`, bundle: true, platform: "node", format: "cjs",
    external: ["pg-native", "pino", "pino-http", "playwright"],
    logLevel: "warning",
  });
  const result = spawnSync(process.execPath, ["--test", `${out}/critical.test.cjs`], {
    stdio: "inherit", env: { ...process.env, LOG_LEVEL: "silent" },
  });
  process.exitCode = result.status ?? 1;
} finally {
  await rm(out, { recursive: true, force: true });
}
