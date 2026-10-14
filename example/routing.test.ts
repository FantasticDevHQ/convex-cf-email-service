import { convexTest } from "convex-test";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import type { DeliveryEvent } from "../src/component/shared.js";
import type { EventOwnershipReceipt } from "../src/bridge/index.js";
import { ingestSharedEvent } from "./routing/shared.js";
import emailTest from "../src/test.js";
import schema from "./convex/schema.js";
import { components } from "./convex/_generated/api.js";
const modules = import.meta.glob("./convex/**/*.ts");
beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());
test("early routed delivery survives a lost reply without fan-out or ambiguous resend", async () => {
  const t = convexTest(schema, modules);
  emailTest.register(t, "transactionalEmail");
  emailTest.register(t, "authEmail");
  const request = {
    scope: "store",
    key: "route",
    handle: "function://host:send",
    transport: "primary",
    expiresAt: Date.now() + 3600000,
    payload: {
      from: "mail@example.com",
      to: ["reader@example.net"],
      subject: "Private receipt",
      text: "Private content",
    },
  };
  const id = await t.mutation(
    components.transactionalEmail.email.enqueue,
    request,
  );
  const other = await t.mutation(components.authEmail.email.enqueue, {
    ...request,
    scope: "authentication",
  });
  await t.mutation(components.authEmail.email.cancel, { id: other });
  await t.mutation(components.transactionalEmail.email.claim, { id });
  const event: DeliveryEvent = {
    eventId: "real-provider-fixture",
    messageId: "provider-id",
    recipient: "reader@example.net",
    kind: "delivered",
    at: Date.now(),
    permanent: false,
  };
  // Test fixture for a host-owned directory. Production uses a durable indexed table.
  let receipt: EventOwnershipReceipt | null = null;
  const route = () =>
    t.run((ctx) => ingestSharedEvent(ctx, event, async () => receipt));
  expect(await route()).toBe("unknown_owner");
  // Worker commits this receipt after binding acceptance, before its lost HTTP reply.
  receipt = {
    kind: "component",
    route: "receipts",
    expiresAt: Date.now() + 3600000,
  };
  expect(await route()).toBe("pending");
  expect(await route()).toBe("duplicate");
  await vi.advanceTimersByTimeAsync(60001);
  await t.finishInProgressScheduledFunctions();
  expect(
    await t.query(components.transactionalEmail.email.status, { id }),
  ).toMatchObject({ state: "ambiguous", attempt: 1 });
  expect(
    await t.query(components.authEmail.email.metrics, {
      scope: "authentication",
      since: Date.now() - 86400000,
    }),
  ).not.toContainEqual(expect.objectContaining({ name: "pending_events" }));
  // The non-owner remains cancelled and receives no pending delivery event.
  expect(
    await t.query(components.authEmail.email.status, { id: other }),
  ).toMatchObject({ state: "cancelled", attempt: 0 });
  await t.mutation(components.transactionalEmail.email.reconcile, {
    id,
    attempt: 1,
    decision: {
      kind: "accepted",
      recipients: [
        {
          recipient: "reader@example.net",
          messageId: "provider-id",
          status: "accepted",
        },
      ],
    },
  });
  expect(
    await t.query(components.transactionalEmail.email.status, { id }),
  ).toMatchObject({
    state: "accepted",
    attempt: 1,
    delivery: [{ state: "delivered", count: 1 }],
  });
});
test("unconfigured owner and expired directory never authorize a component write", async () => {
  const t = convexTest(schema, modules);
  emailTest.register(t, "transactionalEmail");
  emailTest.register(t, "authEmail");
  const event: DeliveryEvent = {
    eventId: "fixture",
    messageId: "m",
    recipient: "reader@example.net",
    kind: "delivered",
    at: Date.now(),
    permanent: false,
  };
  await expect(
    t.run((ctx) =>
      ingestSharedEvent(ctx, event, async () => ({
        kind: "component",
        route: "__proto__",
        expiresAt: Date.now() + 1000,
      })),
    ),
  ).rejects.toThrow("Unconfigured event owner");
  expect(
    await t.run((ctx) =>
      ingestSharedEvent(ctx, event, async () => ({
        kind: "legacy",
        expiresAt: Date.now(),
      })),
    ),
  ).toBe("unknown_owner");
});
