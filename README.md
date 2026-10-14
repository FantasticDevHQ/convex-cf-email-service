# Convex Cloudflare Email Service

A reusable Convex component for durable transactional email intent and Cloudflare
Email Service delivery tracking. Owned by Fantastic Dev HQ. Apache-2.0; derived
from a pinned ezyyeah revision recorded in [UPSTREAM.md](UPSTREAM.md).

Published on npm as
[@fantastic.dev/convex-cf-email-service](https://www.npmjs.com/package/@fantastic.dev/convex-cf-email-service).

Install it in your existing Convex app:

```sh
npm install @fantastic.dev/convex-cf-email-service
```

With pnpm, use `pnpm add @fantastic.dev/convex-cf-email-service`.
The package requires Convex 1.44+ and Node 24.19+.

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
        from: "Example Store <receipts@example.com>",
        replyTo: "Example Support <support@example.com>",
        to: [recipient],
        subject: "Receipt",
        text: "Your order was received.",
      },
    }),
});
```

After mounting and adding the host files above, run Convex development to generate
host bindings and sync the component with your development deployment:

```sh
npx convex dev
```

Use your app's normal `npx convex deploy` workflow when ready to deploy.
`ComponentApi` is exported through
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
sorts recipients for deduplication. `from` and `replyTo` accept a bare address or
a single branded mailbox such as `TinyDirs <support@example.com>`. Display names
retain their case and Unicode; names with commas, quotes or backslashes must use
a quoted phrase with escaped quotes/backslashes. Normalization quotes display
names consistently, so equivalent quoting and address case reuse an idempotency
key; changing the display name conflicts. Both transports preserve the name using
Cloudflare named-address objects, with `email` for Workers and `address` for REST.
To/cc/bcc and suppression keys remain bare addresses. Mailboxes are limited to
998 characters after canonicalization and support dot-atom addresses with DNS
domains. Comments, groups, lists, quoted local parts, CR/LF/NUL and folded headers
are rejected without including input in errors.
See Cloudflare's [mailbox contracts](https://developers.cloudflare.com/email-service/examples/email-sending/recipients/)
and [REST address type](https://github.com/cloudflare/cloudflare-typescript/blob/main/src/resources/email-sending/email-sending.ts).
Consumers needing case-sensitive local parts
or larger messages should use a separately reviewed extension. All recipients
are blocked if any is suppressed; the component never silently changes an intent.

See [the transport/state contract](docs/architecture.md),
[Queue setup and authentication](docs/events.md),
[retention and operations](docs/operations.md),
[release bootstrap](docs/releasing.md), and
[the separately tracked Jib adoption plan](docs/adoption.md).
The `example/` host and Worker are complete typechecked integration examples,
with placeholder configuration and no deployed infrastructure.
[Email Studio](example/README.md) adds a small Vite UI for real sends and live
status. Run `pnpm --filter email-host-example dev` after following its host setup.

To work on this repository, use Node 24.19+ and pnpm 11.18. Local tarballs from
`npm pack` are for testing unreleased changes; consumers should install from npm
using the instructions above.

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
