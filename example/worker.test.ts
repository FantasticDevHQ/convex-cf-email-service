import { expect, test, vi } from "vitest";
import worker from "./worker/index.js";
import { authenticatedBody, signBody } from "../src/bridge/index.js";

const env = () => ({
  EMAIL: { send: vi.fn(async () => ({ messageId: "provider-canary" })) },
  ASSETS: { fetch: vi.fn(async () => new Response("Email Studio")) },
  SEND_BRIDGE_SECRET: "s".repeat(40),
  EVENT_BRIDGE_SECRET: "e".repeat(40),
  CONVEX_EVENTS_URL: "https://host.example/email/events",
  ACCOUNT_ID: "account",
  ZONE_ID: "zone",
  SENDING_DOMAIN: "cf-email.fantastic.dev",
  SUBSCRIPTION_ID: "subscription",
});
const dispatch = () => ({
  emailId: "canary",
  scope: "store",
  transport: "worker",
  attempt: 1,
  idempotencyKey: "canary",
  expiresAt: Date.now() + 60000,
  payload: {
    from: "demo@cf-email.fantastic.dev",
    to: ["reader@example.net"],
    subject: "Canary",
    text: "Hello",
  },
});
async function signed(input: unknown, secret = "s".repeat(40)) {
  const body = JSON.stringify(input),
    timestamp = String(Date.now());
  return new Request("https://cf-email.fantastic.dev/send", {
    method: "POST",
    body,
    headers: {
      "content-type": "application/json",
      "x-email-timestamp": timestamp,
      "x-email-signature": await signBody(secret, timestamp, body),
    },
  });
}
test("site assets remain available, and anonymous send requests cannot invoke the binding", async () => {
  const e = env();
  expect(
    await (
      await worker.fetch(new Request("https://cf-email.fantastic.dev/"), e)
    ).text(),
  ).toBe("Email Studio");
  expect(
    (
      await worker.fetch(
        new Request("https://cf-email.fantastic.dev/send", { method: "POST" }),
        e,
      )
    ).status,
  ).toBe(401);
  expect(
    (await worker.fetch(await signed(dispatch(), "x".repeat(40)), e)).status,
  ).toBe(401);
  expect(e.EMAIL.send).not.toHaveBeenCalled();
  expect((await worker.fetch(await signed(null), e)).status).toBe(400);
  expect(
    (
      await worker.fetch(
        await signed({ ...dispatch(), transport: "primary" }),
        e,
      )
    ).status,
  ).toBe(400);
  expect(
    await (
      await worker.fetch(
        await signed({ ...dispatch(), expiresAt: Date.now() - 1 }),
        e,
      )
    ).json(),
  ).toMatchObject({ kind: "not_sent", retryable: false });
  expect(e.EMAIL.send).not.toHaveBeenCalled();
});
test("signed binding dispatch returns the provider ID, rejects cross-scope dispatch, and never retries an ambiguous send", async () => {
  const e = env();
  expect(
    (await worker.fetch(await signed({ ...dispatch(), scope: "other" }), e))
      .status,
  ).toBe(400);
  expect(e.EMAIL.send).not.toHaveBeenCalled();
  expect(
    await (await worker.fetch(await signed(dispatch()), e)).json(),
  ).toMatchObject({
    kind: "accepted",
    recipients: [{ messageId: "provider-canary" }],
  });
  e.EMAIL.send.mockRejectedValueOnce(new Error("lost response"));
  expect(
    await (await worker.fetch(await signed(dispatch()), e)).json(),
  ).toEqual({ kind: "ambiguous" });
  expect(e.EMAIL.send).toHaveBeenCalledTimes(2);
});
test("actual Queue handler signs sanitized events, retries forwarding failure, and acknowledges only after success", async () => {
  const diagnostic = vi.spyOn(console, "info").mockImplementation(() => {});
  const e = env();
  const body = {
    type: "cf.email.sending.message.delivered",
    source: {
      type: "email.sending",
      zoneId: e.ZONE_ID,
      domain: e.SENDING_DOMAIN,
    },
    metadata: {
      accountId: e.ACCOUNT_ID,
      eventSubscriptionId: e.SUBSCRIPTION_ID,
      eventSchemaVersion: 1,
      eventTimestamp: new Date().toISOString(),
    },
    payload: {
      eventId: "canary-event",
      messageId: "provider-canary",
      recipient: "reader@example.net",
      terminal: true,
      delivery: { status: "delivered", smtpResponse: "private" },
      subject: "private",
    },
  };
  const message = { body, ack: vi.fn(), retry: vi.fn() };
  const fetcher = vi.fn(
    async (_url: string | URL | Request, options?: RequestInit) => {
      const forwarded = await authenticatedBody(
        new Request(e.CONVEX_EVENTS_URL, options),
        [e.EVENT_BRIDGE_SECRET],
      );
      expect(forwarded).toMatchObject({
        scope: "store",
        event: { messageId: "provider-canary", kind: "delivered" },
      });
      expect(JSON.stringify(forwarded)).not.toContain("private");
      return new Response(null, {
        status: fetcher.mock.calls.length === 1 ? 503 : 204,
      });
    },
  );
  vi.stubGlobal("fetch", fetcher);
  await worker.queue({ messages: [message] }, e);
  expect(message.retry).toHaveBeenCalledOnce();
  expect(message.ack).not.toHaveBeenCalled();
  await worker.queue({ messages: [message] }, e);
  expect(message.ack).toHaveBeenCalledOnce();
  const mismatched = {
    body: { ...body, source: { ...body.source, domain: "fantastic.dev" } },
    ack: vi.fn(),
    retry: vi.fn(),
  };
  await worker.queue({ messages: [mismatched] }, e);
  expect(mismatched.retry).toHaveBeenCalledOnce();
  expect(mismatched.ack).not.toHaveBeenCalled();
  expect(fetcher).toHaveBeenCalledTimes(2);
  expect(diagnostic).toHaveBeenCalledWith(
    JSON.stringify({
      event: "email_queue_batch",
      forwarded: 0,
      retried: 1,
      responseCounts: { "503": 1 },
        failureCounts: { forward_failed: 1 },
    }),
  );
  expect(diagnostic).toHaveBeenCalledWith(
    JSON.stringify({
      event: "email_queue_batch",
      forwarded: 1,
      retried: 0,
      responseCounts: { "204": 1 },
        failureCounts: {},
    }),
  );
  expect(JSON.stringify(diagnostic.mock.calls)).not.toContain("private");
  expect(JSON.stringify(diagnostic.mock.calls)).not.toContain(
    "reader@example.net",
  );
  diagnostic.mockRestore();
});
