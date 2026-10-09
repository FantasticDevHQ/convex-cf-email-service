import { convexTest } from "convex-test";
import { anyApi } from "convex/server";
import { expect, test, vi, afterEach, beforeEach } from "vitest";
import schema from "./convex/schema.js";
import emailTest from "../src/test.js";
const modules = import.meta.glob("./convex/**/*.ts");
function backend() {
  const t = convexTest(schema, modules);
  emailTest.register(t, "transactionalEmail");
  return t;
}
const input = () => ({
  accessCode: "a".repeat(32),
  requestId: "11111111-1111-4111-8111-111111111111",
  recipient: "reader@example.net",
  subject: "Demo",
  text: "Hello",
});
beforeEach(() => {
  vi.useFakeTimers();
  vi.stubEnv("EMAIL_DEMO_ACCESS_CODE", "a".repeat(32));
  vi.stubEnv("EMAIL_DEMO_RECIPIENTS", "reader@example.net");
  vi.stubEnv("EMAIL_DEMO_FROM", "sender@example.com");
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.useRealTimers();
});
test("demo fails closed without server access configuration and denies status access", async () => {
  const t = backend();
  vi.stubEnv("EMAIL_DEMO_ACCESS_CODE", "");
  await expect(t.mutation(anyApi.demo.submit, input())).rejects.toThrow(
    "Demo access denied",
  );
  await expect(
    t.query(anyApi.demo.status, {
      accessCode: "wrong",
      requestId: input().requestId,
    }),
  ).rejects.toThrow("Demo access denied");
});
test("demo recipient allowlist prevents an open relay", async () => {
  const t = backend();
  await expect(
    t.mutation(anyApi.demo.submit, {
      ...input(),
      recipient: "other@example.net",
    }),
  ).rejects.toThrow("Recipient is not enabled for this demo");
});
test("demo replay creates one host record and reports component status", async () => {
  const t = backend();
  const id = await t.mutation(anyApi.demo.submit, input());
  vi.setSystemTime(Date.now() + 1000);
  expect(await t.mutation(anyApi.demo.submit, input())).toBe(id);
  const rows = await t.run((ctx) => ctx.db.query("demoSends").collect());
  expect(rows).toHaveLength(1);
  expect(
    await t.query(anyApi.demo.status, {
      accessCode: input().accessCode,
      requestId: input().requestId,
    }),
  ).toMatchObject({ state: "queued", attempt: 0 });
  await expect(
    t.mutation(anyApi.demo.submit, { ...input(), text: "different" }),
  ).rejects.toThrow("Idempotency conflict");
});
test("demo rate cap rejects a seventh distinct send in one minute but permits replay", async () => {
  const t = backend();
  for (let i = 0; i < 6; i++)
    await t.mutation(anyApi.demo.submit, {
      ...input(),
      requestId: `11111111-1111-4111-8111-${String(i).padStart(12, "0")}`,
    });
  await expect(t.mutation(anyApi.demo.submit, input())).rejects.toThrow(
    "Demo send limit reached",
  );
  expect(
    await t.mutation(anyApi.demo.submit, {
      ...input(),
      requestId: "11111111-1111-4111-8111-000000000000",
    }),
  ).toBeTruthy();
});

test("demo denies an incorrect access code even when configured", async () => {
  const t = backend();
  await expect(
    t.mutation(anyApi.demo.submit, { ...input(), accessCode: "wrong" }),
  ).rejects.toThrow("Demo access denied");
  await expect(
    t.query(anyApi.demo.status, {
      accessCode: "wrong",
      requestId: input().requestId,
    }),
  ).rejects.toThrow("Demo access denied");
});
test("demo cleanup retains recent references and removes them after 24 hours", async () => {
  const t = backend();
  const id = await t.mutation(anyApi.demo.submit, input());
  await t.mutation(anyApi.demo.cleanup, { id });
  expect(await t.run((ctx) => ctx.db.get(id))).toBeTruthy();
  vi.setSystemTime(Date.now() + 86400000);
  await t.mutation(anyApi.demo.cleanup, { id });
  expect(await t.run((ctx) => ctx.db.get(id))).toBeNull();
});

test("explicit wildcard permits any recipient only for authenticated operators", async () => {
  const t = backend();
  vi.stubEnv("EMAIL_DEMO_RECIPIENTS", "*");
  await expect(
    t.mutation(anyApi.demo.submit, {
      ...input(),
      recipient: "another@example.org",
      accessCode: "wrong",
    }),
  ).rejects.toThrow("Demo access denied");
  expect(
    await t.mutation(anyApi.demo.submit, {
      ...input(),
      recipient: "another@example.org",
    }),
  ).toBeTruthy();
});
