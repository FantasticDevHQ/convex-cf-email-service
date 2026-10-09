/** Refuse live deployment until the isolated event subscription is configured. */
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
const config = readFileSync("wrangler.canary.jsonc", "utf8");
if (config.includes("PENDING_ISOLATED_SUBSCRIPTION")) {
  console.error(
    "Configure the cf-email.fantastic.dev event subscription before deploying the canary.",
  );
  process.exit(1);
}
const result = spawnSync(
  "wrangler",
  ["deploy", "--config", "wrangler.canary.jsonc"],
  { stdio: "inherit" },
);
if (result.error) throw result.error;
process.exit(result.status ?? 1);
