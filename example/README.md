# Email Studio

A small Vite + TypeScript app that sends plain-text email through the example
Convex host and shows live component state. The host owns admission rules,
sender identity and Cloudflare credentials. The reusable component stays unchanged.

## Run locally

Use the repository's Node and pnpm versions (`.nvmrc` and `packageManager`). From
the repository root:

```sh
pnpm install --frozen-lockfile
pnpm run build
cd example
CONVEX_AGENT_MODE=anonymous pnpm exec convex dev
```

Keep that terminal running. This starts an anonymous **local** Convex backend,
installs both example component mounts and generates the host API. For an existing
development deployment, use your normal `convex dev` workflow instead. Do not
point this example at a production deployment without reviewing its host APIs.

Copy the backend URL printed by Convex into `example/.env.local` (Vite reads this
file from the example directory):

```dotenv
VITE_CONVEX_URL=http://127.0.0.1:3210
```

Use the actual printed URL if the local backend chooses another port. In another
terminal, from the repository root:

```sh
pnpm --filter email-host-example dev
```

Open the Vite URL (normally `http://127.0.0.1:5173`). Without a backend URL the app
shows setup instructions and disables sending. It never simulates success.

## Enable real sends

Configure these **server-side Convex environment variables** for the selected
local or development backend using its dashboard or `convex env set` workflow:

| Variable                 | Value                                                                |
| ------------------------ | -------------------------------------------------------------------- |
| `CLOUDFLARE_ACCOUNT_ID`  | Account with Cloudflare Email Service enabled                        |
| `CLOUDFLARE_EMAIL_TOKEN` | Cloudflare token authorized for that account's email sending         |
| `EMAIL_DEMO_FROM`        | Verified sender address                                              |
| `EMAIL_DEMO_RECIPIENTS`  | Comma-separated recipients, or `*` for password-authorized operators |
| `EMAIL_DEMO_ACCESS_CODE` | Random operator access code, at least 32 characters                  |

Use your secret manager; avoid placing secret values in shell history. Do not
prefix any secret with `VITE_`: Vite exposes those variables in browser bundles.
The frontend needs only `VITE_CONVEX_URL`. Enter the host-issued access code in
the password field; the app keeps it in memory and sends it to the authenticated
host endpoints, without browser storage. Use HTTPS for any remote backend.

Fill in a permitted recipient, a subject and a plain-text message, then click
**Send email**. These are real emails and may consume Cloudflare usage. The demo
allows six new sends per minute across all operators, with three attempts and a
five-minute expiry. A failed submission retry with unchanged content reuses its
request ID; a successful submission followed by another click creates a new send.
Changing content after an error creates a new intent, so reconcile uncertain
results before creating a replacement. The UI watches the latest successful send.

A shared access code is suitable for controlled demonstrations. Replace it with
your product's user authentication and authorization before offering a public UI.
The UI is not the security boundary: the host enforces access, allowlisting,
message size and rate limits, including direct API calls. Demo references retain
only request ID, email ID and creation time and are removed after 24 hours.
Message content follows the component's retention policy; credentials are not
persisted in either table.

## Observe delivery

`accepted` means the provider accepted the send request, not that the email reached
the inbox. The UI shows recipient delivery counts only when authenticated events
reach the component. Follow [event setup](../docs/events.md) to connect Cloudflare
Queues through the signed forwarding Worker to `example/convex/http.ts`. The demo
uses the existing `store` scope and `transactionalEmail` mount. REST provider IDs
require trusted host-side correlation as described in that guide; do not infer
correlation from recipient or subject. An `ambiguous` send requires reconciliation,
not an automatic replacement message.

The deployed demo uses `EMAIL_DEMO_RECIPIENTS=*` by explicit operator choice, so
password-authorized operators can send to any valid address. An unset or incorrect
`EMAIL_DEMO_ACCESS_CODE` still denies both sends and status reads. To restrict
recipients again, replace `*` with a comma-separated list. The application never
sends test emails automatically.

## Verification

```sh
# From the repository root:
pnpm --filter email-host-example build
pnpm exec vitest run example/demo.test.ts
pnpm run check
pnpm run check:consumer
```

CI includes the Vite production build and host fault tests. Tests cover missing
access configuration, unauthorized reads, recipient admission, conflicting and
duplicate requests, the send limit, and host reference cleanup. The example is
workspace-only and is not included in the published npm tarball.

## Existing host and Worker integrations

`convex/` mounts separate transactional and auth email components. Receipt enqueue
writes a host-owned order record atomically, and an internal host REST action
resolves the current token. `http.ts` verifies signed event bytes, pins the store
scope and commits ingestion before returning success. The host controls auth,
schema and template logic. The internal receipt helper is not a public API.

`worker/` uses the native EMAIL binding for signed send requests and consumes
Queue messages. The host `workerTransport` action resolves its bridge secret per
call. Do not retry a lost send response; reconcile ambiguity. Use different
credentials for sending and delivery-event forwarding. The config contains
placeholders and five Queue retries plus a DLQ. These files are typechecked but
not deployed. Replace scope/source/endpoint mapping in host code for your app;
do not expose source configuration or callback handles to browsers.

## Hosted example and redeployment

The example is hosted at https://cf-email.fantastic.dev. Its backend belongs to
[Fantastic Dev / convex-cf-email-service](https://dashboard.convex.dev/t/fantastic-dev/convex-cf-email-service),
with production URL `https://prestigious-lemur-549.convex.cloud`.
`deployment.env` contains only the public deployment selector; it contains no secrets.

The public page can be viewed by anyone, but sending and status access require
its **Demo password**. The backend reads `EMAIL_DEMO_ACCESS_CODE`; the password
is never embedded in frontend assets or saved in browser storage. The operator
password is saved in 1Password as **cf-email.fantastic.dev demo password**. A
64-character random password makes guessing impractical; retain the six-send rate
limit even for authenticated operators. Do not use the email provider token as
the demo password.

Sending setup remains separate from website deployment. The current account has
`mail.fantastic.dev` enabled for sending; `cf-email@fantastic.dev` requires its
own verified sending domain or an operator-approved sender change. Configure a
dedicated Email Sending token in the backend before testing real email delivery.

From the repository root, with an authenticated Convex CLI:

```sh
pnpm install --frozen-lockfile
pnpm run build
pnpm --filter email-host-example deploy:backend
```

This deploys the example host and both component mounts, then builds the Vite
frontend using the target Convex URL. To publish the built frontend, inject the
existing Cloudflare Workers deployment token and account ID from your secret
manager into `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`, then run:

```sh
pnpm --filter email-host-example deploy:site
```

`wrangler.jsonc` serves only the compiled static assets and attaches the
`cf-email.fantastic.dev` custom domain. It disables alternate workers.dev and
preview URLs. Deploy this configuration independently of `worker/wrangler.jsonc`,
which is the email send/event bridge example and requires separate setup.
Cloudflare creates the custom-domain DNS record and HTTPS certificate.

`pnpm --filter email-host-example check:deployment` validates deployment packaging
without publishing. This dry run is also part of the normal package CI checks.
Always build through `deploy:backend` before publishing the site so the frontend
uses the intended production backend. No provider tokens belong in Vite variables,
`deployment.env`, Wrangler configuration, or the npm component.
