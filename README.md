# Convex Cloudflare Email Service

A reusable Convex component for durable transactional email intent and Cloudflare
Email Service delivery tracking. Owned by Fantastic Dev HQ. Apache-2.0; derived
from a pinned ezyyeah revision recorded in [UPSTREAM.md](UPSTREAM.md).

Prepared package: `@fantastic.dev/convex-cf-email-service`. **Not published yet.**

Install the published version after release, or install a local `npm pack` tarball
for evaluation. Requires Node 24.19+, Convex 1.44+, and pnpm 11.18 for development.

Mount the component in your host app (`convex/convex.config.ts`):

```ts
import { defineApp } from "convex/server";
import email from "@fantastic.dev/convex-cf-email-service/convex.config";
const app = defineApp();
app.use(email, { name: "transactionalEmail" });
app.use(email, { name: "authEmail" });
export default app;
```

Define an internal host transport action (`convex/transport.ts`). Credentials are
resolved for every invocation in the host; the component stores only a function
handle and transport alias. Worker binding transport needs no provider API token.

```ts
import { internalAction } from "./_generated/server.js";
import { dispatchV, resultV } from "@fantastic.dev/convex-cf-email-service";
import { sendRest } from "@fantastic.dev/convex-cf-email-service/transport";
export const send = internalAction({
  args: dispatchV,
  returns: resultV,
  handler: async (_ctx, request) => {
    if (request.transport !== "primary") {
      return {
        kind: "not_sent" as const,
        retryable: false,
        code: "rejected" as const,
      };
    }
    return sendRest(request, async () => ({
      accountId: process.env.CLOUDFLARE_ACCOUNT_ID ?? "",
      apiToken: process.env.CLOUDFLARE_EMAIL_TOKEN ?? "",
    }));
  },
});
```

Enqueue from a host mutation after applying your authorization rules. Enqueue and
host database writes share one transaction. Supply an opaque, stable idempotency
key for the logical send and an absolute expiry appropriate to the rendered content.
This internal example (`convex/receipt.ts`) leaves user access entirely to the host:

```ts
import { internalMutation } from "./_generated/server.js";
import { internal, components } from "./_generated/api.js";
import { CloudflareEmail } from "@fantastic.dev/convex-cf-email-service";
import { v } from "convex/values";
const email = new CloudflareEmail(components.transactionalEmail);
export const enqueueReceipt = internalMutation({
  args: { key: v.string(), recipient: v.string() },
  returns: v.string(),
  handler: async (ctx, { key, recipient }): Promise<string> =>
    email.enqueue(ctx, {
      scope: "store",
      key,
      transport: "primary",
      send: internal.transport.send,
      expiresAt: Date.now() + 60 * 60 * 1000,
      payload: {
        from: "receipts@example.com",
        to: [recipient],
        subject: "Receipt",
        text: "Your order was received.",
      },
    }),
});
```

Run host codegen after mounting. `ComponentApi` is exported through
`@fantastic.dev/convex-cf-email-service/_generated/component.js`; the portable
convex-test registration is exported through `/test`.

The component owns dispatch scheduling. Call enqueue once; do not also schedule
or retry the host send action. Only a proven `not_sent` result permits bounded
resubmission. A timeout, crash, unknown adapter exception, 5xx or malformed response
requires reconciliation. Local idempotency does not guarantee exactly-once
external delivery. Cancellation succeeds before claim; an in-flight send cannot
be recalled. `accepted` describes request completion; `delivered` means recipient
mail-server acceptance, not inbox placement or reading.

The Worker binding returns message IDs and is preferred for delivery correlation.
The documented REST API returns recipient outcome arrays without message IDs;
accepted REST sends require host-obtained provider evidence and `attachMessageId`
for later event correlation. Unknown IDs remain pending for 30 days; matching on
recipient and time alone is unsafe. Neither adapter assumes Cloudflare honors the
component's idempotency key.

Payloads include text/HTML, to/cc/bcc, replyTo, X- headers, and base64 attachments.
The component limits serialized content to 256 KiB, 50 distinct recipients and
32 attachments so enqueue is atomic. It normalizes addresses to lowercase and
sorts recipients for deduplication. Consumers needing case-sensitive local parts
or larger messages should use a separately reviewed extension. All recipients
are blocked if any is suppressed; the component never silently changes an intent.

See [the transport/state contract](docs/architecture.md),
[Queue setup and authentication](docs/events.md),
[retention and operations](docs/operations.md),
[release bootstrap](docs/releasing.md), and
[the separately tracked Jib adoption plan](docs/adoption.md).
The `example/` host and Worker are complete typechecked integration examples,
with placeholder configuration and no deployed infrastructure.

Development:

```sh
pnpm install --frozen-lockfile
pnpm run check
pnpm run check:consumer
```

`check` builds and typechecks the package/examples, runs fault tests and release
notes tests, verifies actual packed contents and boundaries, compiles these README
samples in an isolated app, and compares isolated generated bindings.
`check:consumer` installs a tarball outside this workspace with no source links,
runs anonymous local codegen/typecheck, exercises a real local host callback and
event, then tests early/duplicate events and two component mounts with convex-test.
No Cloudflare credentials or live email send are used in these gates.
