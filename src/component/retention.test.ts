import { convexTest } from "convex-test";
import { anyApi } from "convex/server";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import schema from "./schema.js";
const modules = import.meta.glob("./**/*.ts");
const request = () => ({
  scope: "tenant",
  key: "logical-send",
  transport: "primary",
  handle: "function://host:send",
  expiresAt: Date.now() + 60000,
  payload: {
    from: "Brand <sender@example.com>",
    to: ["a@example.net"],
    replyTo: "Support <support@example.com>",
    subject: "Private subject",
    text: "Private code",
    html: "<a href='https://example.com/auth?token=private'>Sign in</a>",
    attachments: [
      {
        filename: "private.txt",
        type: "text/plain",
        content: "cHJpdmF0ZQ==",
        disposition: "attachment" as const,
      },
    ],
  },
});
beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

test("immediate terminal redaction removes the entire payload and preserves dedup and metadata", async () => {
  const t = convexTest(schema, modules);
  const input = { ...request(), redactOnTerminal: true };
  const id = await t.mutation(anyApi.email.enqueue, input);
  await t.mutation(anyApi.email.claim, { id });
  await t.mutation(anyApi.email.complete, {
    id,
    attempt: 1,
    result: {
      kind: "accepted",
      recipients: [
        {
          recipient: "a@example.net",
          messageId: "provider-1",
          status: "accepted",
        },
      ],
    },
  });
  expect(
    (await t.run((ctx) => ctx.db.get("emails", id)))?.payload,
  ).toBeUndefined();
  expect(await t.query(anyApi.email.status, { id })).toMatchObject({
    state: "accepted",
    attempt: 1,
  });
  expect(await t.mutation(anyApi.email.enqueue, input)).toBe(id);
  expect(
    await t.run((ctx) => ctx.db.query("recipients").collect()),
  ).toHaveLength(1);
  expect(await t.run((ctx) => ctx.db.query("attempts").collect())).toHaveLength(
    1,
  );
});

test.each([
  "failed",
  "ambiguous",
  "cancelled",
  "suppressed",
  "expired",
  "recovered",
])("redacts immediately when the intent ends %s", async (outcome) => {
  const t = convexTest(schema, modules);
  const input = { ...request(), redactOnTerminal: true };
  if (outcome === "suppressed")
    await t.mutation(anyApi.email.ingest, {
      scope: input.scope,
      event: {
        eventId: "bounce",
        messageId: "prior",
        recipient: "a@example.net",
        kind: "bounced",
        at: Date.now(),
        permanent: true,
      },
    });
  const id = await t.mutation(anyApi.email.enqueue, input);
  if (outcome === "cancelled") await t.mutation(anyApi.email.cancel, { id });
  else if (outcome === "expired") {
    vi.setSystemTime(input.expiresAt + 1);
    await t.mutation(anyApi.email.expire, { id });
  } else {
    await t.mutation(anyApi.email.claim, { id });
    if (outcome === "recovered")
      await t.mutation(anyApi.email.recover, { id, attempt: 1 });
    else if (outcome === "failed")
      await t.mutation(anyApi.email.complete, {
        id,
        attempt: 1,
        result: { kind: "not_sent", retryable: false, code: "rejected" },
      });
    else if (outcome === "ambiguous")
      await t.mutation(anyApi.email.complete, {
        id,
        attempt: 1,
        result: { kind: "ambiguous" },
      });
  }
  expect(
    (await t.run((ctx) => ctx.db.get("emails", id)))?.payload,
  ).toBeUndefined();
  expect((await t.query(anyApi.email.status, { id }))?.state).toBe(
    outcome === "recovered" ? "ambiguous" : outcome,
  );
  expect(await t.mutation(anyApi.email.claim, { id })).toBeNull();
});

test("safe retries retain content until a terminal outcome", async () => {
  const t = convexTest(schema, modules);
  const id = await t.mutation(anyApi.email.enqueue, {
    ...request(),
    redactOnTerminal: true,
  });
  await t.mutation(anyApi.email.claim, { id });
  await t.mutation(anyApi.email.complete, {
    id,
    attempt: 1,
    result: { kind: "not_sent", retryable: true, code: "rate_limited" },
  });
  expect((await t.run((ctx) => ctx.db.get("emails", id)))?.payload?.text).toBe(
    "Private code",
  );
  vi.setSystemTime(Date.now() + 1000);
  expect(await t.mutation(anyApi.email.claim, { id })).not.toBeNull();
  await t.mutation(anyApi.email.complete, {
    id,
    attempt: 2,
    result: { kind: "not_sent", retryable: false, code: "rejected" },
  });
  expect(
    (await t.run((ctx) => ctx.db.get("emails", id)))?.payload,
  ).toBeUndefined();
});

test("redacted uncertainty still accepts late evidence and correlated event replay", async () => {
  const t = convexTest(schema, modules);
  const input = { ...request(), redactOnTerminal: true };
  const id = await t.mutation(anyApi.email.enqueue, input);
  await t.mutation(anyApi.email.claim, { id });
  await t.mutation(anyApi.email.recover, { id, attempt: 1 });
  const event = {
    eventId: "delivered",
    messageId: "provider-1",
    recipient: "a@example.net",
    kind: "delivered",
    at: Date.now(),
    permanent: false,
  };
  expect(
    await t.mutation(anyApi.email.ingest, { scope: input.scope, event }),
  ).toBe("pending");
  await t.mutation(anyApi.email.reconcile, {
    id,
    attempt: 1,
    decision: {
      kind: "accepted",
      recipients: [
        {
          recipient: event.recipient,
          messageId: event.messageId,
          status: "accepted",
        },
      ],
    },
  });
  expect(
    await t.mutation(anyApi.email.ingest, { scope: input.scope, event }),
  ).toBe("duplicate");
  await t.mutation(anyApi.email.ingest, {
    scope: input.scope,
    event: {
      ...event,
      eventId: "old-deferred",
      kind: "deferred",
      at: Date.now() - 1,
    },
  });
  expect((await t.query(anyApi.email.status, { id }))?.delivery).toEqual([
    { state: "delivered", count: 1 },
  ]);
  expect(
    (await t.run((ctx) => ctx.db.get("emails", id)))?.payload,
  ).toBeUndefined();
});

test("not-sent reconciliation never queues a retry after immediate payload deletion", async () => {
  const t = convexTest(schema, modules);
  const id = await t.mutation(anyApi.email.enqueue, {
    ...request(),
    redactOnTerminal: true,
  });
  await t.mutation(anyApi.email.claim, { id });
  await t.mutation(anyApi.email.recover, { id, attempt: 1 });
  await t.mutation(anyApi.email.reconcile, {
    id,
    attempt: 1,
    decision: { kind: "not_sent" },
  });
  expect((await t.query(anyApi.email.status, { id }))?.state).toBe("failed");
  expect(await t.mutation(anyApi.email.claim, { id })).toBeNull();
});

test("default retention remains unchanged and duplicate keys retain the original policy", async () => {
  const t = convexTest(schema, modules);
  const input = request();
  const id = await t.mutation(anyApi.email.enqueue, input);
  expect(
    await t.mutation(anyApi.email.enqueue, {
      ...input,
      redactOnTerminal: true,
    }),
  ).toBe(id);
  await t.mutation(anyApi.email.claim, { id });
  await t.mutation(anyApi.email.complete, {
    id,
    attempt: 1,
    result: {
      kind: "accepted",
      recipients: [{ recipient: "a@example.net", status: "accepted" }],
    },
  });
  expect(
    (await t.run((ctx) => ctx.db.get("emails", id)))?.payload,
  ).toBeDefined();
  vi.setSystemTime(input.expiresAt + 1);
  await t.mutation(anyApi.email.expire, { id });
  expect(
    (await t.run((ctx) => ctx.db.get("emails", id)))?.payload,
  ).toBeUndefined();
});
