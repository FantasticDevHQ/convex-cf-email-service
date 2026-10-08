import { expect, test, vi } from "vitest";
import { sendBinding, sendRest } from "./index.js";
const request = () => ({
  emailId: "email",
  scope: "scope",
  attempt: 1,
  transport: "primary",
  idempotencyKey: "k",
  expiresAt: Date.now() + 60000,
  payload: {
    from: "sender@example.com",
    to: ["a@example.net"],
    subject: "Receipt",
    text: "hello",
  },
});
test("binding returns a message ID without resolving API credentials", async () => {
  let calls = 0;
  const result = await sendBinding(
    {
      async send() {
        calls++;
        return { messageId: "m" };
      },
    },
    request(),
  );
  expect(calls).toBe(1);
  expect(result).toMatchObject({
    kind: "accepted",
    recipients: [
      { recipient: "a@example.net", messageId: "m", status: "accepted" },
    ],
  });
});
test("unknown binding failures are ambiguous, documented rate rejection is safe to retry", async () => {
  expect(
    await sendBinding(
      {
        async send() {
          throw new Error("secret provider response");
        },
      },
      request(),
    ),
  ).toEqual({ kind: "ambiguous" });
  expect(
    await sendBinding(
      {
        async send() {
          throw Object.assign(new Error("private"), {
            code: "E_RATE_LIMIT_EXCEEDED",
          });
        },
      },
      request(),
    ),
  ).toEqual({ kind: "not_sent", retryable: true, code: "rate_limited" });
});
test("REST resolves a rotated credential on every attempt and maps partial recipient outcomes", async () => {
  let token = "first";
  const seen: string[] = [];
  const fetcher: typeof fetch = async (_url, init) => {
    seen.push(new Headers(init?.headers).get("Authorization") ?? "");
    return Response.json({
      success: true,
      result: {
        delivered: [],
        queued: ["a@example.net"],
        permanent_bounces: [],
      },
    });
  };
  const resolver = async () => ({ accountId: "a".repeat(32), apiToken: token });
  expect(await sendRest(request(), resolver, fetcher)).toMatchObject({
    kind: "accepted",
    recipients: [{ recipient: "a@example.net", status: "accepted" }],
  });
  token = "second";
  await sendRest(request(), resolver, fetcher);
  expect(seen).toEqual(["Bearer first", "Bearer second"]);
});
test.each([500, 502, 503, 200])(
  "REST %s with unknown acceptance never authorizes resubmission",
  async (status) => {
    const result = await sendRest(
      request(),
      async () => ({ accountId: "a".repeat(32), apiToken: "current" }),
      async () => new Response("private raw body", { status }),
    );
    expect(result).toEqual({ kind: "ambiguous" });
  },
);
test("no transport call after expiry", async () => {
  const send = vi.fn(),
    req = { ...request(), expiresAt: Date.now() - 1 };
  await sendBinding({ send }, req);
  expect(send).not.toHaveBeenCalled();
});
test("expiry during credential resolution prevents the external REST call", async () => {
  const req = request(),
    fetcher = vi.fn();
  const result = await sendRest(
    req,
    async () => {
      req.expiresAt = Date.now() - 1;
      return { accountId: "a".repeat(32), apiToken: "current" };
    },
    fetcher,
  );
  expect(fetcher).not.toHaveBeenCalled();
  expect(result.kind).toBe("not_sent");
});
