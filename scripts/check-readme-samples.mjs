// Compile the README's exact TypeScript blocks against generated host bindings.
import {
  readFileSync,
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  cpSync,
  rmSync,
  symlinkSync,
} from "node:fs";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
const root = process.cwd();
const blocks = [
  ...readFileSync("README.md", "utf8").matchAll(
    /```(?:ts|typescript)\n([\s\S]*?)```/gu,
  ),
].map((m) => m[1]);
if (blocks.length !== 3)
  throw new Error(
    "Expected three complete README samples; update the compiled inventory when adding samples",
  );
const dir = mkdtempSync(join(root, ".readme-check-"));
try {
  mkdirSync(join(dir, "convex"));
  symlinkSync(resolve("node_modules"), join(dir, "node_modules"), "dir");
  cpSync("example/convex/_generated", join(dir, "convex/_generated"), {
    recursive: true,
  });
  cpSync("example/convex/schema.ts", join(dir, "convex/schema.ts"));
  cpSync("example/convex/email.ts", join(dir, "convex/email.ts"));
  cpSync("example/convex/http.ts", join(dir, "convex/http.ts"));
  ["convex.config", "transport", "receipt"].forEach((name, i) =>
    writeFileSync(join(dir, "convex", `${name}.ts`), blocks[i]),
  );
  // Generated binding inventory is augmented for these real sample modules, rather than
  // stubbing any API or disabling the type checker for the call to the host action.
  const api = join(dir, "convex/_generated/api.d.ts");
  let source = readFileSync(api, "utf8");
  source = source.replace(
    "import type {",
    `import type * as transport from '../transport.js';\nimport type * as receipt from '../receipt.js';\nimport type {`,
  );
  source = source.replace(
    "ApiFromModules<{",
    "ApiFromModules<{\n transport: typeof transport;\n receipt: typeof receipt;",
  );
  writeFileSync(api, source);
  writeFileSync(
    join(dir, "package.json"),
    readFileSync("package.json", "utf8"),
  );
  symlinkSync(resolve("dist"), join(dir, "dist"), "dir");
  writeFileSync(
    join(dir, "tsconfig.json"),
    JSON.stringify({
      compilerOptions: {
        strict: true,
        skipLibCheck: true,
        target: "ESNext",
        module: "ESNext",
        moduleResolution: "Bundler",
        noEmit: true,
        lib: ["ES2023", "DOM"],
        types: ["node"],
      },
      include: ["convex/**/*.ts"],
    }),
  );
  const result = spawnSync("pnpm", ["exec", "tsc", "--noEmit"], {
    cwd: dir,
    encoding: "utf8",
  });
  if (result.status !== 0) throw new Error(result.stdout + result.stderr);
  console.log(
    "All three README samples compile with real generated host types.",
  );
} finally {
  rmSync(dir, { recursive: true, force: true });
}
