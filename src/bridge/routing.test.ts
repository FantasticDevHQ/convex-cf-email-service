import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { forwardEvents, routeDeliveryEvent } from "./index.js";
import type { DeliveryEvent } from "../component/shared.js";
const event = (): DeliveryEvent => ({
  eventId: "event",
  messageId: "<CaseSensitiveID>",
  recipient: " A@EXAMPLE.NET ",
  kind: "delivered",
  at: Date.now(),
  permanent: false,
});
beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());
test("only the owning route is invoked, regardless of another mount's outage", async () => {
  const other = vi.fn(async () => {
    throw new Error("non-owner unavailable");
  });
  const owner = vi.fn(async (_event: DeliveryEvent) => "applied" as const);
  const lookup = vi.fn(async () => ({
    kind: "component" as const,
    route: "receipts",
    expiresAt: Date.now() + 60000,
  }));
  const result = await routeDeliveryEvent(event(), lookup, async (route, e) => {
    if (route === "receipts") return owner(e);
    return other();
  });
  expect(result).toBe("applied");
  expect(other).not.toHaveBeenCalled();
  expect(lookup).toHaveBeenCalledExactlyOnceWith("<CaseSensitiveID>");
  expect(owner).toHaveBeenCalledExactlyOnceWith({
    ...event(),
    recipient: "a@example.net",
  });
});
test.each(["pending", "duplicate"] as const)(
  "committed owning %s ingestion permits acknowledgement",
  async (result) => {
    expect(
      await routeDeliveryEvent(
        event(),
        async () => ({
          kind: "component",
          route: "auth",
          expiresAt: Date.now() + 60000,
        }),
        async () => result,
      ),
    ).toBe(result);
  },
);
test("unknown ownership retries without probing mounts; later receipt repairs the same event", async () => {
  let recorded = false;
  const ingest = vi.fn(async () => "pending" as const);
  const lookup = async () =>
    recorded
      ? {
          kind: "component" as const,
          route: "auth",
          expiresAt: Date.now() + 60000,
        }
      : null;
  expect(await routeDeliveryEvent(event(), lookup, ingest)).toBe(
    "unknown_owner",
  );
  expect(ingest).not.toHaveBeenCalled();
  recorded = true;
  expect(await routeDeliveryEvent(event(), lookup, ingest)).toBe("pending");
  expect(ingest).toHaveBeenCalledTimes(1);
});
test("known legacy receipts acknowledge without inserting pending events into any component", async () => {
  const ingest = vi.fn();
  expect(
    await routeDeliveryEvent(
      event(),
      async () => ({ kind: "legacy", expiresAt: Date.now() + 60000 }),
      ingest,
    ),
  ).toBe("legacy");
  expect(ingest).not.toHaveBeenCalled();
});
test.each(["component", "legacy"] as const)(
  "expired %s ownership cannot authorize ingestion or legacy acknowledgement",
  async (kind) => {
    const ingest = vi.fn();
    expect(
      await routeDeliveryEvent(
        event(),
        async () => ({ kind, route: "auth", expiresAt: Date.now() }),
        ingest,
      ),
    ).toBe("unknown_owner");
    expect(ingest).not.toHaveBeenCalled();
  },
);
test("expiry is checked after asynchronous directory lookup", async () => {
  const deadline = Date.now() + 10,
    ingest = vi.fn();
  expect(
    await routeDeliveryEvent(
      event(),
      async () => {
        vi.setSystemTime(deadline);
        return { kind: "component", route: "auth", expiresAt: deadline };
      },
      ingest,
    ),
  ).toBe("unknown_owner");
  expect(ingest).not.toHaveBeenCalled();
});
test("directory or owning mount outage cannot return a successful result", async () => {
  const ingest = vi.fn();
  await expect(
    routeDeliveryEvent(
      event(),
      async () => {
        throw Error("directory unavailable");
      },
      ingest,
    ),
  ).rejects.toThrow();
  expect(ingest).not.toHaveBeenCalled();
  await expect(
    routeDeliveryEvent(
      event(),
      async () => ({
        kind: "component",
        route: "auth",
        expiresAt: Date.now() + 60000,
      }),
      async () => {
        throw Error("owner unavailable");
      },
    ),
  ).rejects.toThrow();
});
test("malformed receipts and unexpected ingestion responses fail closed", async () => {
  const ingest = vi.fn(async () => "applied" as const);
  for (const receipt of [
    { kind: "component", route: "", expiresAt: Date.now() + 100 },
    { kind: "legacy", expiresAt: Infinity },
    { kind: "other", expiresAt: Date.now() + 100 },
  ]) {
    await expect(
      routeDeliveryEvent(event(), async () => receipt as never, ingest),
    ).rejects.toThrow();
  }
  expect(ingest).not.toHaveBeenCalled();
  await expect(
    routeDeliveryEvent(
      event(),
      async () => ({
        kind: "component",
        route: "auth",
        expiresAt: Date.now() + 100,
      }),
      async () => undefined as never,
    ),
  ).rejects.toThrow();
});
test("invalid events never reach ownership lookup, and extra content is discarded", async () => {
  const lookup = vi.fn(async () => ({
      kind: "component" as const,
      route: "auth",
      expiresAt: Date.now() + 60000,
    })),
    ingest = vi.fn(
      async (_route: string, _event: DeliveryEvent) => "applied" as const,
    );
  for (const bad of [
    { ...event(), messageId: "\nprivate" },
    { ...event(), kind: "accepted" },
    { ...event(), kind: "invalid" },
    { ...event(), permanent: "yes" },
  ])
    await expect(
      routeDeliveryEvent(bad as never, lookup, ingest),
    ).rejects.toThrow();
  expect(lookup).not.toHaveBeenCalled();
  await routeDeliveryEvent(
    { ...event(), subject: "private body" } as DeliveryEvent,
    lookup,
    ingest,
  );
  expect(ingest.mock.calls[0][1]).not.toHaveProperty("subject");
});
test("bridge retries unknown ownership and acknowledges owner persistence without a fan-out", async () => {
  const config = {
    accountId: "account",
    zoneId: "zone",
    domain: "send.example.com",
    subscriptionId: "sub",
    scope: "shared",
  };
  const raw = {
    type: "cf.email.sending.message.delivered",
    source: {
      type: "email.sending",
      zoneId: config.zoneId,
      domain: config.domain,
    },
    metadata: {
      accountId: config.accountId,
      eventSubscriptionId: config.subscriptionId,
      eventSchemaVersion: 1,
      eventTimestamp: new Date().toISOString(),
    },
    payload: {
      eventId: "event",
      messageId: "<CaseSensitiveID>",
      recipient: "a@example.net",
      terminal: true,
      delivery: { status: "delivered" },
    },
  };
  let receiptExists = false;
  const ack = vi.fn(),
    retry = vi.fn(),
    ingest = vi.fn(async () => "pending" as const);
  const fetcher: typeof fetch = async (_url, init) => {
    const body = JSON.parse(String(init?.body));
    const result = await routeDeliveryEvent(
      body.event,
      async () =>
        receiptExists
          ? { kind: "component", route: "auth", expiresAt: Date.now() + 60000 }
          : null,
      ingest,
    );
    return new Response(null, {
      status: result === "unknown_owner" ? 503 : 204,
    });
  };
  await forwardEvents(
    [{ body: raw, ack, retry }],
    config,
    "https://host.example/events",
    "s".repeat(32),
    fetcher,
  );
  expect(retry).toHaveBeenCalledTimes(1);
  expect(ack).not.toHaveBeenCalled();
  expect(ingest).not.toHaveBeenCalled();
  receiptExists = true;
  await forwardEvents(
    [{ body: raw, ack, retry }],
    config,
    "https://host.example/events",
    "s".repeat(32),
    fetcher,
  );
  expect(ack).toHaveBeenCalledTimes(1);
  expect(ingest).toHaveBeenCalledTimes(1);
});
