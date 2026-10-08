// Rebuild from source, so stale JavaScript cannot survive a module removal into npm.
import { rmSync } from "node:fs";
import { spawnSync } from "node:child_process";
rmSync("dist", { recursive: true, force: true });
rmSync("tsconfig.build.tsbuildinfo", { force: true });
const result = spawnSync("pnpm", ["exec", "tsc", "-p", "tsconfig.build.json"], {
  stdio: "inherit",
});
process.exit(result.status ?? 1);
