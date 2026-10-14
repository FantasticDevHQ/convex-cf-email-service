import { convexTest } from "convex-test";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { CloudflareEmail } from "../src/client/index.js";
import emailTest from "../src/test.js";
import schema from "./convex/schema.js";
import { components, internal } from "./convex/_generated/api.js";
const modules = import.meta.glob("./convex/**/*.ts");
beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());
test("public client enqueues and replays branded sender/reply-to without consumer patches", async () => {
  const t = convexTest(schema, modules);
  emailTest.register(t, "transactionalEmail");
  const email = new CloudflareEmail(components.transactionalEmail);
  const options = {
    scope: "store",
    key: "branded",
    transport: "primary",
    send: internal.email.transport,
    expiresAt: Date.now() + 60000,
    payload: {
      from: "TinyDirs <SUPPORT@MAIL-DEV.TINYDIRS.DEV>",
      replyTo: "TinyDirs <CONTACT@TINYDIRS.DEV>",
      to: [" A@EXAMPLE.NET "],
      subject: "Receipt",
      text: "body",
    },
  };
  const id = await t.run((ctx) => email.enqueue(ctx, options));
  expect(
    await t.run((ctx) =>
      email.enqueue(ctx, {
        ...options,
        payload: {
          ...options.payload,
          from: '"TinyDirs" <support@mail-dev.tinydirs.dev>',
        },
      }),
    ),
  ).toBe(id);
  const claim = await t.mutation(components.transactionalEmail.email.claim, {
    id,
  });
  expect(claim?.request.payload).toMatchObject({
    from: '"TinyDirs" <support@mail-dev.tinydirs.dev>',
    replyTo: '"TinyDirs" <contact@tinydirs.dev>',
    to: ["a@example.net"],
  });
});
