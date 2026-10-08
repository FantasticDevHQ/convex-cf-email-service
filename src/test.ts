/// <reference types="vite/client" />
// Modified by Fantastic Dev HQ, 2026: portable component registration.
import type { TestConvex } from "convex-test";
import type { GenericSchema, SchemaDefinition } from "convex/server";
import schema from "./component/schema.js";
const modules = import.meta.glob([
  "./component/**/*.ts",
  "!./component/**/*.test.ts",
]);
export function register<S extends SchemaDefinition<GenericSchema, boolean>>(
  t: TestConvex<S>,
  name = "cloudflareEmail",
) {
  t.registerComponent(name, schema, modules);
}
export default { register, schema, modules };
