import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const wranglerRequire = createRequire(require.resolve("wrangler/package.json"));
const { Miniflare, convertV4MiniflareOptions } = wranglerRequire("miniflare");
const { build } = wranglerRequire("esbuild");

test("Workers runtime forwards signed Queue events, rejects redirects and recovers after failure", async () => {
  const bundle = await build({
    stdin: {
      contents: `import worker from './worker/index.ts'; export default {async fetch(request,env){let acked=0,retried=0; await worker.queue({messages:[{body:await request.json(),ack(){acked++},retry(){retried++}}]},env); return Response.json({acked,retried});}}`,
      resolveDir: new URL(".", import.meta.url).pathname,
    },
    bundle: true,
    format: "esm",
    write: false,
  });
  let status = 503;
  const requests = [];
  const runtime = new Miniflare(
    convertV4MiniflareOptions({
      compatibilityDate: "2026-10-09",
      modules: true,
      script: bundle.outputFiles[0].text,
      bindings: {
        ACCOUNT_ID: "account",
        ZONE_ID: "zone",
        SENDING_DOMAIN: "cf-email.fantastic.dev",
        SUBSCRIPTION_ID: "subscription",
        CONVEX_EVENTS_URL: "https://host.example/email/events",
        EVENT_BRIDGE_SECRET: "e".repeat(40),
      },
      outboundService: async (request) => {
        requests.push({
          url: request.url,
          signature: request.headers.get("x-email-signature"),
          body: await request.json(),
        });
        return new Response(null, {
          status,
          ...(status === 302
            ? { headers: { Location: "https://other.example/" } }
            : {}),
        });
      },
    }),
  );
  const fixture = {
    type: "cf.email.sending.message.delivered",
    source: {
      type: "email.sending",
      zoneId: "zone",
      domain: "cf-email.fantastic.dev",
    },
    metadata: {
      accountId: "account",
      eventSubscriptionId: "subscription",
      eventSchemaVersion: 1,
      eventTimestamp: new Date().toISOString(),
    },
    payload: {
      eventId: "fixture-event",
      messageId: "fixture-message",
      recipient: "reader@example.net",
      terminal: true,
      delivery: { status: "delivered" },
      subject: "private",
    },
  };
  const dispatch = async () =>
    (
      await runtime.dispatchFetch("https://local.example/", {
        method: "POST",
        body: JSON.stringify(fixture),
      })
    ).json();
  try {
    assert.deepEqual(await dispatch(), { acked: 0, retried: 1 });
    assert.equal(requests.length, 1);
    status = 302;
    assert.deepEqual(await dispatch(), { acked: 0, retried: 1 });
    assert.equal(requests.length, 2);
    status = 204;
    assert.deepEqual(await dispatch(), { acked: 1, retried: 0 });
    assert.equal(requests.length, 3);
    for (const request of requests) {
      assert.equal(request.url, "https://host.example/email/events");
      assert.match(request.signature, /^[a-f0-9]{64}$/);
      assert.equal(JSON.stringify(request.body).includes("private"), false);
    }
  } finally {
    await runtime.dispose();
  }
});
