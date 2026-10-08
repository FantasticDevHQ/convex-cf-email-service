import { convexTest } from "convex-test";
import { anyApi } from "convex/server";
import { expect, test, vi, afterEach, beforeEach } from "vitest";
import schema from "./schema.js";
const modules = import.meta.glob("./**/*.ts");
const request = () => ({
  scope: "tenant-a",
  key: "order-1",
  transport: "primary",
  handle: "function://host:send",
  payload: {
    from: "mail@example.com",
    to: ["a@example.net"],
    subject: "Receipt",
    text: "paid",
  },
  expiresAt: Date.now() + 60000,
});
beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());
test("enqueue persists a durable intent instead of returning without a record", async () => {
  const t = convexTest(schema, modules);
  const id = await t.mutation(anyApi.email.enqueue, request());
  expect(typeof id).toBe("string");
  expect(await t.run((ctx) => ctx.db.get(id))).not.toBeNull();
});
test("durable idempotency survives a new context and rejects changed bodies", async () => {
  vi.useFakeTimers();
  const t = convexTest(schema, modules),
    a = request();
  const id = await t.mutation(anyApi.email.enqueue, a);
  expect(
    await t.mutation(anyApi.email.enqueue, {
      ...a,
      payload: { ...a.payload, to: [" A@EXAMPLE.NET "] },
    }),
  ).toBe(id);
  await expect(
    t.mutation(anyApi.email.enqueue, {
      ...a,
      payload: { ...a.payload, text: "different" },
    }),
  ).rejects.toThrow("Idempotency conflict");
  const rows = await t.run((ctx) => ctx.db.query("emails").collect());
  expect(rows).toHaveLength(1);
  const scheduled = await t.run((ctx) =>
    ctx.db.system.query("_scheduled_functions").collect(),
  );
  expect(scheduled.filter((x) => x.name.includes("dispatch"))).toHaveLength(1);
  expect(JSON.stringify(rows)).not.toContain("apiToken");
});
test("overlapping dispatch callbacks claim only one external attempt", async () => {
  vi.useFakeTimers();
  const t = convexTest(schema, modules),
    id = await t.mutation(anyApi.email.enqueue, request());
  const claims = await Promise.all([
    t.mutation(anyApi.email.claim, { id }),
    t.mutation(anyApi.email.claim, { id }),
  ]);
  expect(claims.filter(Boolean)).toHaveLength(1);
  expect(await t.run((ctx) => ctx.db.query("attempts").collect())).toHaveLength(
    1,
  );
});
test("cancellation before claim prevents sending and cancellation during sending records intent", async () => {
  vi.useFakeTimers();
  const t = convexTest(schema, modules),
    id = await t.mutation(anyApi.email.enqueue, request());
  expect(await t.mutation(anyApi.email.cancel, { id })).toBe(true);
  expect(await t.mutation(anyApi.email.claim, { id })).toBeNull();
  const id2 = await t.mutation(anyApi.email.enqueue, {
    ...request(),
    key: "second",
  });
  await t.mutation(anyApi.email.claim, { id: id2 });
  expect(await t.mutation(anyApi.email.cancel, { id: id2 })).toBe(false);
  await t.mutation(anyApi.email.complete, {
    id: id2,
    attempt: 1,
    result: {
      kind: "accepted",
      recipients: [
        { recipient: "a@example.net", messageId: "m", status: "accepted" },
      ],
    },
  });
  expect(await t.query(anyApi.email.status, { id: id2 })).toMatchObject({
    state: "accepted",
    cancelRequested: true,
  });
});
test("safe not-sent retries are bounded; provider acceptance is never resubmitted", async () => {
  vi.useFakeTimers();
  const t = convexTest(schema, modules),
    id = await t.mutation(anyApi.email.enqueue, {
      ...request(),
      maxAttempts: 2,
    });
  await t.mutation(anyApi.email.claim, { id });
  const rejected = { kind: "not_sent", retryable: true, code: "rate_limited" };
  await t.mutation(anyApi.email.complete, { id, attempt: 1, result: rejected });
  expect(await t.mutation(anyApi.email.claim, { id })).toBeNull();
  vi.setSystemTime(Date.now() + 1000);
  expect(await t.mutation(anyApi.email.claim, { id })).not.toBeNull();
  await t.mutation(anyApi.email.complete, { id, attempt: 2, result: rejected });
  expect(await t.query(anyApi.email.status, { id })).toMatchObject({
    state: "failed",
    attempt: 2,
  });
  expect(await t.mutation(anyApi.email.claim, { id })).toBeNull();
});
test("crash after claim requires reconciliation and stale result cannot finish a later attempt", async () => {
  vi.useFakeTimers();
  const t = convexTest(schema, modules),
    id = await t.mutation(anyApi.email.enqueue, request());
  await t.mutation(anyApi.email.claim, { id });
  await t.mutation(anyApi.email.recover, { id, attempt: 1 });
  expect(await t.mutation(anyApi.email.claim, { id })).toBeNull();
  await t.mutation(anyApi.email.reconcile, {
    id,
    attempt: 1,
    decision: { kind: "not_sent" },
  });
  await t.mutation(anyApi.email.claim, { id });
  await t.mutation(anyApi.email.complete, {
    id,
    attempt: 1,
    result: {
      kind: "accepted",
      recipients: [{ recipient: "a@example.net", status: "accepted" }],
    },
  });
  expect(await t.query(anyApi.email.status, { id })).toMatchObject({
    state: "sending",
    attempt: 2,
  });
});
test("a late positive result resolves ambiguity without another send", async () => {
  vi.useFakeTimers();
  const t = convexTest(schema, modules),
    id = await t.mutation(anyApi.email.enqueue, request());
  await t.mutation(anyApi.email.claim, { id });
  await t.mutation(anyApi.email.recover, { id, attempt: 1 });
  await t.mutation(anyApi.email.complete, {
    id,
    attempt: 1,
    result: {
      kind: "accepted",
      recipients: [
        { recipient: "a@example.net", messageId: "late", status: "accepted" },
      ],
    },
  });
  expect(await t.query(anyApi.email.status, { id })).toMatchObject({
    state: "accepted",
    attempt: 1,
  });
});
test("early events deduplicate and terminal delivery withstands reordered deferrals", async () => {
  vi.useFakeTimers();
  const t = convexTest(schema, modules),
    id = await t.mutation(anyApi.email.enqueue, request());
  const event = {
    eventId: "event1",
    messageId: "m",
    recipient: "a@example.net",
    kind: "delivered",
    at: Date.now(),
    permanent: false,
  };
  expect(
    await t.mutation(anyApi.email.ingest, { scope: "tenant-a", event }),
  ).toBe("pending");
  expect(
    await t.mutation(anyApi.email.ingest, { scope: "tenant-a", event }),
  ).toBe("duplicate");
  await t.mutation(anyApi.email.claim, { id });
  await t.mutation(anyApi.email.complete, {
    id,
    attempt: 1,
    result: {
      kind: "accepted",
      recipients: [
        { recipient: "a@example.net", messageId: "m", status: "accepted" },
      ],
    },
  });
  await t.mutation(anyApi.email.ingest, {
    scope: "tenant-a",
    event: {
      ...event,
      eventId: "event2",
      kind: "deferred",
      at: Date.now() + 1,
    },
  });
  expect(await t.query(anyApi.email.status, { id })).toMatchObject({
    state: "accepted",
    delivery: [{ state: "delivered", count: 1 }],
  });
  await expect(
    t.mutation(anyApi.email.ingest, {
      scope: "tenant-a",
      event: { ...event, kind: "bounced" },
    }),
  ).rejects.toThrow("Event ID conflict");
});
test("complaints suppress only their scope and cannot be erased by a delayed delivery", async () => {
  vi.useFakeTimers();
  const t = convexTest(schema, modules);
  const event = {
    eventId: "complaint",
    messageId: "m",
    recipient: "a@example.net",
    kind: "complained",
    at: Date.now(),
    permanent: true,
  };
  await t.mutation(anyApi.email.ingest, { scope: "tenant-a", event });
  const id = await t.mutation(anyApi.email.enqueue, request());
  expect(await t.mutation(anyApi.email.claim, { id })).toBeNull();
  expect(await t.query(anyApi.email.status, { id })).toMatchObject({
    state: "suppressed",
  });
  const other = await t.mutation(anyApi.email.enqueue, {
    ...request(),
    scope: "tenant-b",
  });
  expect(await t.mutation(anyApi.email.claim, { id: other })).not.toBeNull();
  expect(
    await t.mutation(anyApi.email.clearSuppression, {
      scope: "tenant-a",
      recipient: "a@example.net",
    }),
  ).toBe(true);
});
test("soft bounces do not suppress while hard bounces do, including before acceptance", async () => {
  vi.useFakeTimers();
  const t = convexTest(schema, modules);
  const event = {
    eventId: "soft",
    messageId: "m",
    recipient: "a@example.net",
    kind: "bounced",
    at: Date.now(),
    permanent: false,
  };
  await t.mutation(anyApi.email.ingest, { scope: "tenant-a", event });
  const id = await t.mutation(anyApi.email.enqueue, request());
  expect(await t.mutation(anyApi.email.claim, { id })).not.toBeNull();
  await t.mutation(anyApi.email.ingest, {
    scope: "tenant-a",
    event: { ...event, eventId: "hard", permanent: true },
  });
  const next = await t.mutation(anyApi.email.enqueue, {
    ...request(),
    key: "new",
  });
  expect(await t.mutation(anyApi.email.claim, { id: next })).toBeNull();
});
test("expiry prevents retry of authentication content and diagnostics never reveal bodies", async () => {
  vi.useFakeTimers();
  const t = convexTest(schema, modules),
    a = request();
  a.payload.text = "https://example.com/magic?secret=PRIVATE";
  const id = await t.mutation(anyApi.email.enqueue, a);
  vi.setSystemTime(a.expiresAt);
  expect(await t.mutation(anyApi.email.claim, { id })).toBeNull();
  await t.mutation(anyApi.email.expire, { id });
  expect(await t.run((ctx) => ctx.db.get(id))).not.toHaveProperty("payload");
  expect(
    JSON.stringify(await t.query(anyApi.email.status, { id })),
  ).not.toContain("PRIVATE");
});
test("retention removes recipient/attempt content but keeps a dedup tombstone", async () => {
  vi.useFakeTimers();
  const t = convexTest(schema, modules),
    a = request(),
    id = await t.mutation(anyApi.email.enqueue, a);
  await t.mutation(anyApi.email.claim, { id });
  vi.setSystemTime(Date.now() + 30 * 86400000);
  await t.mutation(anyApi.email.prune, { id });
  expect(
    await t.run((ctx) => ctx.db.query("recipients").collect()),
  ).toHaveLength(0);
  expect(await t.run((ctx) => ctx.db.query("attempts").collect())).toHaveLength(
    0,
  );
  const row = await t.run((ctx) => ctx.db.get(id));
  expect(row).not.toHaveProperty("payload");
  expect(row).toHaveProperty("digest");
  expect(
    await t.mutation(anyApi.email.enqueue, {
      ...a,
      expiresAt: Date.now() + 60000,
    }),
  ).toBe(id);
});
test("partial provider outcomes are not committed as successful acceptance", async () => {
  vi.useFakeTimers();
  const t = convexTest(schema, modules),
    id = await t.mutation(anyApi.email.enqueue, {
      ...request(),
      payload: { ...request().payload, to: ["a@example.net", "b@example.net"] },
    });
  await t.mutation(anyApi.email.claim, { id });
  await expect(
    t.mutation(anyApi.email.complete, {
      id,
      attempt: 1,
      result: {
        kind: "accepted",
        recipients: [{ recipient: "a@example.net", status: "accepted" }],
      },
    }),
  ).rejects.toThrow("Incomplete");
  expect(await t.query(anyApi.email.status, { id })).toMatchObject({
    state: "sending",
  });
  await t.mutation(anyApi.email.recover, { id, attempt: 1 });
  expect(await t.query(anyApi.email.status, { id })).toMatchObject({
    state: "ambiguous",
  });
});
test("recipient delivery is queued until the provider accepts the request", async () => {
  const t = convexTest(schema, modules),
    id = await t.mutation(anyApi.email.enqueue, request());
  expect(await t.query(anyApi.email.status, { id })).toMatchObject({
    state: "queued",
    delivery: [{ state: "queued", count: 1 }],
  });
});
test("scheduled callbacks cannot prune live data before their retention deadlines", async () => {
  const t = convexTest(schema, modules),
    id = await t.mutation(anyApi.email.enqueue, request());
  await t.mutation(anyApi.email.prune, { id });
  await t.mutation(anyApi.email.deleteEmail, { id });
  expect(await t.run((ctx) => ctx.db.get(id))).toHaveProperty("payload");
  expect(
    await t.run((ctx) => ctx.db.query("recipients").collect()),
  ).toHaveLength(1);
});
test("recipient outcomes stay independent in a mixed-recipient acceptance", async () => {
  const t = convexTest(schema, modules),
    id = await t.mutation(anyApi.email.enqueue, {
      ...request(),
      payload: {
        ...request().payload,
        to: ["a@example.net", "b@example.net", "c@example.net"],
      },
    });
  await t.mutation(anyApi.email.claim, { id });
  await t.mutation(anyApi.email.complete, {
    id,
    attempt: 1,
    result: {
      kind: "accepted",
      recipients: [
        { recipient: "a@example.net", status: "delivered", messageId: "m" },
        { recipient: "b@example.net", status: "accepted", messageId: "m" },
        { recipient: "c@example.net", status: "bounced", messageId: "m" },
      ],
    },
  });
  await t.mutation(anyApi.email.ingest, {
    scope: "tenant-a",
    event: {
      eventId: "complaint",
      messageId: "m",
      recipient: "a@example.net",
      kind: "complained",
      at: Date.now(),
      permanent: true,
    },
  });
  await t.mutation(anyApi.email.ingest, {
    scope: "tenant-a",
    event: {
      eventId: "old-delivery",
      messageId: "m",
      recipient: "a@example.net",
      kind: "delivered",
      at: Date.now() - 1000,
      permanent: false,
    },
  });
  const result = await t.query(anyApi.email.status, { id });
  expect(result.delivery).toEqual(
    expect.arrayContaining([
      { state: "complained", count: 1 },
      { state: "accepted", count: 1 },
      { state: "bounced", count: 1 },
    ]),
  );
});
test("REST acceptance without IDs can attach trusted correlation and replay pending events", async () => {
  const t = convexTest(schema, modules),
    id = await t.mutation(anyApi.email.enqueue, request());
  await t.mutation(anyApi.email.claim, { id });
  await t.mutation(anyApi.email.complete, {
    id,
    attempt: 1,
    result: {
      kind: "accepted",
      recipients: [{ recipient: "a@example.net", status: "accepted" }],
    },
  });
  await t.mutation(anyApi.email.ingest, {
    scope: "tenant-a",
    event: {
      eventId: "e",
      messageId: "actual",
      recipient: "a@example.net",
      kind: "delivered",
      at: Date.now(),
      permanent: false,
    },
  });
  await t.mutation(anyApi.email.attachMessageId, {
    id,
    recipient: "a@example.net",
    messageId: "actual",
  });
  expect(await t.query(anyApi.email.status, { id })).toMatchObject({
    delivery: [{ state: "delivered", count: 1 }],
  });
  await expect(
    t.mutation(anyApi.email.attachMessageId, {
      id,
      recipient: "a@example.net",
      messageId: "wrong",
    }),
  ).rejects.toThrow("Correlation conflict");
});
test("event deduplication increments only the duplicate operational counter", async () => {
  const t = convexTest(schema, modules),
    event = {
      eventId: "e",
      messageId: "m",
      recipient: "a@example.net",
      kind: "deferred",
      at: Date.now(),
      permanent: false,
    };
  await t.mutation(anyApi.email.ingest, { scope: "tenant-a", event });
  await t.mutation(anyApi.email.ingest, { scope: "tenant-a", event });
  const counters = await t.query(anyApi.email.metrics, {
    scope: "tenant-a",
    since: Date.now() - 1000,
  });
  expect(
    counters.find((x: { name: string }) => x.name === "pending_events"),
  ).toMatchObject({ count: 1 });
  expect(
    counters.find((x: { name: string }) => x.name === "duplicate_events"),
  ).toMatchObject({ count: 1 });
  expect(
    await t.query(anyApi.email.metrics, {
      scope: "tenant-b",
      since: Date.now() - 1000,
    }),
  ).toEqual([]);
});
test("dedup and event records are deleted only after their documented horizon", async () => {
  const t = convexTest(schema, modules),
    id = await t.mutation(anyApi.email.enqueue, request());
  const event = {
    eventId: "retained",
    messageId: "m",
    recipient: "a@example.net",
    kind: "deferred",
    at: Date.now(),
    permanent: false,
  };
  await t.mutation(anyApi.email.ingest, { scope: "tenant-a", event });
  const ev = await t.run((ctx) => ctx.db.query("events").first());
  await t.mutation(anyApi.email.deleteEvent, { id: ev!._id });
  expect(await t.run((ctx) => ctx.db.get(ev!._id))).not.toBeNull();
  vi.setSystemTime(Date.now() + 30 * 86400000 + 100);
  await t.mutation(anyApi.email.deleteEvent, { id: ev!._id });
  await t.mutation(anyApi.email.prune, { id });
  expect(await t.run((ctx) => ctx.db.get(ev!._id))).toBeNull();
  expect(await t.run((ctx) => ctx.db.get(id))).not.toBeNull();
  vi.setSystemTime(Date.now() + 60 * 86400000);
  await t.mutation(anyApi.email.deleteEmail, { id });
  expect(await t.run((ctx) => ctx.db.get(id))).toBeNull();
});
test("event races with many pending updates drain in bounded durable batches", async () => {
  const t = convexTest(schema, modules),
    id = await t.mutation(anyApi.email.enqueue, request());
  await t.mutation(anyApi.email.claim, { id });
  for (let i = 0; i < 12; i++)
    await t.mutation(anyApi.email.ingest, {
      scope: "tenant-a",
      event: {
        eventId: `pending-${i}`,
        messageId: "m",
        recipient: "a@example.net",
        kind: i === 11 ? "complained" : "deferred",
        at: Date.now(),
        permanent: i === 11,
      },
    });
  await t.mutation(anyApi.email.complete, {
    id,
    attempt: 1,
    result: {
      kind: "accepted",
      recipients: [
        { recipient: "a@example.net", status: "accepted", messageId: "m" },
      ],
    },
  });
  const pending = await t.run((ctx) => ctx.db.query("events").collect());
  expect(pending.filter((x) => x.applied)).toHaveLength(5);
  const recipient = await t.run((ctx) => ctx.db.query("recipients").first());
  await t.mutation(anyApi.email.drainEvents, { id: recipient!._id });
  expect(await t.query(anyApi.email.status, { id })).toMatchObject({
    delivery: [{ state: "complained", count: 1 }],
  });
  expect(
    (await t.run((ctx) => ctx.db.query("events").collect())).every(
      (x) => x.applied,
    ),
  ).toBe(true);
});
