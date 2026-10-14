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

test("binding sends branded mailboxes using native email/name objects", async () => {
  const req = {
    ...request(),
    payload: {
      ...request().payload,
      from: "TinyDirs <SUPPORT@MAIL-DEV.TINYDIRS.DEV>",
      replyTo: '"TinyDirs, Support" <CONTACT@TINYDIRS.DEV>',
    },
  };
  const send = vi.fn(async () => ({ messageId: "branded-message" }));
  expect(await sendBinding({ send }, req)).toMatchObject({
    kind: "accepted",
    recipients: [{ recipient: "a@example.net" }],
  });
  expect(send).toHaveBeenCalledWith(
    expect.objectContaining({
      from: { email: "support@mail-dev.tinydirs.dev", name: "TinyDirs" },
      replyTo: { email: "contact@tinydirs.dev", name: "TinyDirs, Support" },
    }),
  );
});
test("REST sends branded mailboxes using address/name and reply_to", async () => {
  const req = {
    ...request(),
    payload: {
      ...request().payload,
      from: "TinyDirs <SUPPORT@MAIL-DEV.TINYDIRS.DEV>",
      replyTo: '"TinyDirs, Support" <CONTACT@TINYDIRS.DEV>',
    },
  };
  const fetcher = vi.fn<typeof fetch>(async () =>
    Response.json({
      success: true,
      result: {
        queued: ["a@example.net"],
        delivered: [],
        permanent_bounces: [],
      },
    }),
  );
  expect(
    await sendRest(
      req,
      async () => ({ accountId: "a".repeat(32), apiToken: "fixture" }),
      fetcher,
    ),
  ).toMatchObject({ kind: "accepted" });
  const body = JSON.parse(String(fetcher.mock.calls[0][1]?.body));
  expect(body.from).toEqual({
    address: "support@mail-dev.tinydirs.dev",
    name: "TinyDirs",
  });
  expect(body.reply_to).toEqual({
    address: "contact@tinydirs.dev",
    name: "TinyDirs, Support",
  });
  expect(body).not.toHaveProperty("replyTo");
});
test("plain sender and reply-to remain plain strings through both transports", async () => {
  const req = {
    ...request(),
    payload: { ...request().payload, replyTo: " CONTACT@EXAMPLE.COM " },
  };
  const send = vi.fn(async () => ({ messageId: "plain" }));
  await sendBinding({ send }, req);
  expect(send).toHaveBeenCalledWith(
    expect.objectContaining({
      from: "sender@example.com",
      replyTo: "contact@example.com",
    }),
  );
  const fetcher = vi.fn<typeof fetch>(async () =>
    Response.json({
      success: true,
      result: {
        queued: ["a@example.net"],
        delivered: [],
        permanent_bounces: [],
      },
    }),
  );
  await sendRest(
    req,
    async () => ({ accountId: "a".repeat(32), apiToken: "fixture" }),
    fetcher,
  );
  expect(JSON.parse(String(fetcher.mock.calls[0][1]?.body))).toMatchObject({
    from: "sender@example.com",
    reply_to: "contact@example.com",
  });
});
test.each(["from", "replyTo"] as const)(
  "invalid %s mailboxes never reach either provider",
  async (field) => {
    for (const value of [
      "A <bad>",
      "a@example.com\r\n",
      "A\0 <a@example.com>",
      "A <a@example.com>, B <b@example.com>",
    ]) {
      const req = {
        ...request(),
        payload: { ...request().payload, [field]: value },
      };
      const send = vi.fn(),
        fetcher = vi.fn();
      const denied = { kind: "not_sent", retryable: false, code: "rejected" };
      expect(await sendBinding({ send }, req)).toEqual(denied);
      expect(
        await sendRest(
          req,
          async () => ({ accountId: "a".repeat(32), apiToken: "fixture" }),
          fetcher,
        ),
      ).toEqual(denied);
      expect(send).not.toHaveBeenCalled();
      expect(fetcher).not.toHaveBeenCalled();
    }
  },
);
