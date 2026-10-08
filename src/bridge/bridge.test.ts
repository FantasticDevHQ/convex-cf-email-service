import { expect, test, vi } from "vitest";
import {
  normalizeCloudflareEvent,
  signBody,
  authenticatedBody,
  forwardEvents,
} from "./index.js";
const config = {
  accountId: "account",
  zoneId: "zone",
  domain: "send.example.com",
  subscriptionId: "sub",
  scope: "tenant-a",
};
const event = () => ({
  type: "cf.email.sending.message.delivered",
  source: { type: "email.sending", zoneId: "zone", domain: "send.example.com" },
  metadata: {
    accountId: "account",
    eventSubscriptionId: "sub",
    eventSchemaVersion: 1,
    eventTimestamp: new Date().toISOString(),
  },
  payload: {
    eventId: "ev",
    messageId: "m",
    recipient: "a@example.net",
    subject: "private",
    sender: "mail@example.com",
    terminal: true,
    delivery: { status: "delivered", smtpResponse: "private raw" },
  },
});
const secret = "s".repeat(40);
test("Cloudflare envelope is reduced to necessary fields and source pinned", () => {
  expect(normalizeCloudflareEvent(event(), config)).toMatchObject({
    eventId: "ev",
    messageId: "m",
    kind: "delivered",
  });
  expect(
    JSON.stringify(normalizeCloudflareEvent(event(), config)),
  ).not.toContain("private");
  expect(() =>
    normalizeCloudflareEvent(event(), { ...config, accountId: "other" }),
  ).toThrow("source mismatch");
  expect(() =>
    normalizeCloudflareEvent({ ...event(), type: "unknown" }, config),
  ).toThrow("Unknown event type");
});
test("timestamped HMAC authenticates exact bytes, rotation works, tampering and stale requests fail", async () => {
  const body = JSON.stringify({
      scope: "tenant-a",
      event: normalizeCloudflareEvent(event(), config),
    }),
    timestamp = String(Date.now()),
    signature = await signBody(secret, timestamp, body);
  const req = (b = body, ts = timestamp, sig = signature) =>
    new Request("https://host.example/events", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-email-timestamp": ts,
        "x-email-signature": sig,
      },
      body: b,
    });
  expect(
    await authenticatedBody(req(), ["new".repeat(16), secret]),
  ).toHaveProperty("scope", "tenant-a");
  await expect(authenticatedBody(req(body + " "), [secret])).rejects.toThrow(
    "authentication",
  );
  await expect(
    authenticatedBody(req(), [secret], Date.now() + 300001),
  ).rejects.toThrow("authentication");
  await expect(
    authenticatedBody(req("x".repeat(16385)), [secret]),
  ).rejects.toThrow("too large");
});
test("queue messages ack only after durable ingestion success and retry failures for DLQ", async () => {
  const a = { body: event(), ack: vi.fn(), retry: vi.fn() },
    b = { body: event(), ack: vi.fn(), retry: vi.fn() },
    c = { body: { type: "bad" }, ack: vi.fn(), retry: vi.fn() };
  let n = 0;
  const fetcher: typeof fetch = async () =>
    new Response(null, { status: ++n === 1 ? 204 : 503 });
  expect(
    await forwardEvents(
      [a, b, c],
      config,
      "https://host.example/events",
      secret,
      fetcher,
    ),
  ).toEqual({ forwarded: 1, retried: 2 });
  expect(a.ack).toHaveBeenCalledOnce();
  expect(b.retry).toHaveBeenCalledOnce();
  expect(c.retry).toHaveBeenCalledOnce();
});
