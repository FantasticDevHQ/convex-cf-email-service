import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
const run = (client = "", key = "") =>
  spawnSync("bash", ["scripts/release-preflight.sh"], {
    env: {
      PATH: process.env.PATH,
      RELEASE_APP_CLIENT_ID: client,
      RELEASE_APP_PRIVATE_KEY: key,
    },
    encoding: "utf8",
  });
test("missing client ID fails with an actionable bootstrap message", () => {
  const result = run();
  assert.equal(result.status, 1);
  assert.match(result.stderr, /RELEASE_APP_CLIENT_ID/);
});
test("missing repository-scoped key fails without printing credential input", () => {
  const result = run("synthetic-client");
  assert.equal(result.status, 1);
  assert.match(result.stderr, /selected repositories/);
  assert.doesNotMatch(result.stdout + result.stderr, /synthetic-client/);
});
test("configured preflight succeeds without printing the key", () => {
  const result = run("synthetic-client", "synthetic-secret");
  assert.equal(result.status, 0);
  assert.doesNotMatch(
    result.stdout + result.stderr,
    /synthetic-secret|synthetic-client/,
  );
});
test("App authentication precedes tag creation and publishing requires successful release job", () => {
  const source = readFileSync(".github/workflows/release.yml", "utf8");
  assert(source.indexOf("id: app-token") < source.indexOf("id: release"));
  assert.match(source, /needs\.release-please\.result == 'success'/);
});
