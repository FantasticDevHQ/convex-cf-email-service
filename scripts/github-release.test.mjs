import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

function run(mode) {
  const dir = mkdtempSync(join(tmpdir(), "email-release-test-"));
  try {
    writeFileSync(
      join(dir, "gh"),
      `#!/bin/bash\nprintf '%s\\n' "$*" >> "$CALLS"\nif [[ "$1 $2" == "release view" ]]; then [[ "$MODE" == existing ]]; exit; fi\nif [[ "$MODE" == failure ]]; then exit 42; fi\n`,
      { mode: 0o755 },
    );
    const result = spawnSync("bash", ["scripts/github-release.sh"], {
      env: {
        ...process.env,
        PATH: `${dir}:${process.env.PATH}`,
        RELEASE_TAG: "v0.2.0",
        RUNNER_TEMP: dir,
        CALLS: join(dir, "calls"),
        MODE: mode,
      },
      encoding: "utf8",
    });
    return { ...result, calls: readFileSync(join(dir, "calls"), "utf8") };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
test("an existing release is preserved without creating it again", () => {
  const result = run("existing");
  assert.equal(result.status, 0);
  assert.doesNotMatch(result.calls, /release create/);
});
test("a missing manual release is created with verified tag and notes", () => {
  const result = run("absent");
  assert.equal(result.status, 0);
  assert.match(
    result.calls,
    /release create v0.2.0 --verify-tag --title v0.2.0 --notes-file .*release-notes.md/,
  );
});
test("release creation failure is propagated", () => {
  assert.equal(run("failure").status, 42);
});
