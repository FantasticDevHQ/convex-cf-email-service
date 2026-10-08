// Fantastic Dev HQ: inspect the actual artifact and package boundary before publication.
import { execFileSync } from "node:child_process";
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import assert from "node:assert/strict";
const p = JSON.parse(readFileSync("package.json", "utf8"));
assert.equal(p.name, "@fantastic.dev/convex-cf-email-service");
assert.equal(
  p.repository.url,
  "git+https://github.com/FantasticDevHQ/convex-cf-email-service.git",
);
assert.equal(p.license, "Apache-2.0");
assert.equal(p.publishConfig.provenance, true);
for (const exp of Object.values(p.exports)) {
  if (typeof exp === "string") assert(existsSync(exp));
  else
    for (const path of Object.values(exp))
      assert(existsSync(path), `Missing export ${path}`);
}
const packed = JSON.parse(
  execFileSync("npm", ["pack", "--dry-run", "--ignore-scripts", "--json"], {
    encoding: "utf8",
  }),
)[0];
const files = new Set(packed.files.map((f) => f.path));
for (const required of [
  "LICENSE",
  "NOTICE",
  "UPSTREAM.md",
  "README.md",
  "src/test.ts",
  "dist/component/_generated/component.d.ts",
  "dist/component/convex.config.js",
])
  assert(files.has(required), `Missing ${required}`);
for (const file of files) {
  assert(
    !/(\.test\.|\.env|node_modules|example\/|scripts\/|\.github\/)/u.test(file),
    `Unexpected packed file ${file}`,
  );
}
for (const folder of ["client", "component", "transport", "bridge"])
  for (const file of readdirSync(join("src", folder), { recursive: true })) {
    if (!file.endsWith(".ts") || file.endsWith(".test.ts")) continue;
    const source = join("src", folder, file),
      text = readFileSync(source, "utf8");
    assert(files.has(source), `Missing source ${source}`);
    for (const ext of [".js", ".d.ts"])
      assert(
        files.has(join("dist", folder, file.replace(/\.ts$/u, ext))),
        `Missing compiled ${source}`,
      );
    assert(!/@fantastic-dev\//u.test(text), `Consumer dependency in ${source}`);
    if (folder === "component" && !file.startsWith("_generated/")) {
      assert(
        !/process\.env|apiToken|Authorization|console\./u.test(text),
        `Secret or logging boundary in ${source}`,
      );
      assert(!/\.collect\(/u.test(text), `Unbounded query in ${source}`);
    }
  }
for (const path of [
  ".github/workflows/ci.yml",
  ".github/workflows/release.yml",
]) {
  const text = readFileSync(path, "utf8");
  for (const line of text.split("\n").filter((l) => l.includes("uses:")))
    assert(/@[a-f0-9]{40}\b/u.test(line), `Unpinned action: ${line}`);
  assert(text.includes("pnpm install --frozen-lockfile"));
}
console.log(
  `Artifact verified: ${files.size} files, ${packed.size} bytes; exports, licensing, component boundary and pinned workflows.`,
);
