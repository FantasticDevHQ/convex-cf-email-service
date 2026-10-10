# Isolated delivery and Queue canary

This run is limited to the example at `cf-email.fantastic.dev`, the existing
`prestigious-lemur-549` Convex deployment, and the `convex-cf-email-demo` Worker.
Do not onboard the `fantastic.dev` apex or change existing mail records, other
domains, repositories, or credentials. The zone ID identifies the containing
zone; the sending domain and event subscription must remain the exact subdomain.

## Preparation

1. Review and activate Email Sending for **only** `cf-email.fantastic.dev`.
   All proposed MX, SPF, DKIM, and DMARC records must be beneath that name.
2. Create `convex-cf-email-canary-events` and
   `convex-cf-email-canary-events-dlq`. Subscribe the delivery Queue to Email
   Sending lifecycle events for **only** `cf-email.fantastic.dev`.
3. Replace `PENDING_ISOLATED_SUBSCRIPTION` in
   `example/wrangler.canary.jsonc` with the subscription ID. Do not deploy
   that placeholder. Verify account, zone, domain, and subscription match the
   provider's event envelope.
4. Generate independent send and event HMAC keys in the password manager.
   Inject `SEND_BRIDGE_SECRET` and `EVENT_BRIDGE_SECRET` into the Worker;
   inject their matching values as `EMAIL_SEND_BRIDGE_SECRET` and
   `EMAIL_BRIDGE_SECRET` into Convex. Never place secrets in browser code,
   tracked configuration, command arguments, or diagnostic output.
5. Set Convex `EMAIL_DEMO_FROM=demo@cf-email.fantastic.dev`,
   `EMAIL_DEMO_TRANSPORT=worker`, and
   `EMAIL_WORKER_SEND_URL=https://cf-email.fantastic.dev/send`.
   Retain the server-only demo access code and admission limits. No provider
   API token is needed with the binding. The binding restricts the sender.
6. Build, typecheck, and dry-run the canary configuration. Deploy the backend
   using `example/deployment.env`, then deploy the Worker with
   `pnpm run deploy:canary` from `example` (it rejects an unconfigured subscription).
   It serves both static assets and `/send` and consumes the delivery Queue.
   `deploy:site` also uses the guarded canary configuration. A direct
   static-only deployment with `wrangler.jsonc` would remove the handler and
   Queue consumer; do not use that command for the active example.

## Verification

- Confirm the site still loads and anonymous `/send` requests return 401.
  Incorrect demo passwords must deny both submission and status lookup.
- Submit **one** authorized message to an operator-controlled inbox with a
  unique subject and fixed UUID request ID. Record the ID before submission.
  Reuse that same ID for any idempotency check; do not create another send.
- Verify the binding acceptance's provider message ID matches the Queue event
  and Convex recipient record. Recipient or subject similarity is insufficient.
- Check the inbox read-only and record Message-ID, arrival time, and SPF/DKIM/
  DMARC results. `delivered` means the recipient SMTP server accepted the email;
  the inbox check provides separate receipt evidence.
- Replay the observed event through the isolated Queue. Verify one component
  event and stable recipient state, with no additional provider send. Preserve
  the original envelope when available. If only the normalized durable event
  remains, explicitly label a reconstructed envelope and assert that its
  normalization exactly equals the observed event before publishing it.
- Use a clearly labeled synthetic event to exercise failed forwarding and
  recovery. Verify retry without acknowledgement, successful ingestion after
  recovery, and acknowledgement afterward. Exercise bounded exhaustion into
  the isolated DLQ and recover its test fixture. Restore normal configuration.
- Test bounce, complaint, and out-of-order transitions with fixtures, without
  sending to nonexistent addresses or marking the real canary as spam.

## Evidence status

### Live run — 2026-10-09

- Sending enabled and DNS configured for **only** `cf-email.fantastic.dev`.
  The 21 DNS records outside this subtree match the pre-activation snapshot.
- Dedicated event/DLQ queues and enabled subscription
  `687b1b24c10e4f3c92052beec357628e` are configured for all six Email Sending
  event types and the exact subdomain. Both bridge keys live only in the
  password manager and server environments. The binding needs no provider token.
- Convex production backend deployed; combined assets/send/Queue Worker version
  `8bf0bcd3-aa25-49ab-92e4-b91552dde30d` deployed. Anonymous `/send` returns 401;
  incorrect demo passwords deny submission and status lookup.
- Exactly one real message submitted with request UUID
  `a9191b14-80ed-49be-b1a9-d73cb07140c9` at `2026-10-09T16:13:20Z`.
  Binding acceptance and read-only Gmail metadata have the same Message-ID:
  `<S9jJxG1FTrjVeJ57BZQ13e5qA7xeqLngQgCF@cf-email.fantastic.dev>`.
  Gmail confirms SPF, DKIM (including the isolated sender domain), and DMARC pass.
- A synthetic fixture exposed a real runtime bug: Workers rejects
  `redirect: "error"` before fetch. Its six Queue attempts exhausted the initial
  delivery plus five retries into the isolated DLQ. The fix uses `manual` and
  rejects non-2xx, preserving redirect protection. A workerd regression test
  reproduces the old failure and verifies 503 retry, 302 rejection without
  following, and 204 acknowledgement after recovery.
- After deploying the fix, a fresh synthetic event
  `synthetic-canary-recovery-c23c7508-1109-4a72-94b8-7c410d81407f` traversed the
  actual Queue/Worker/HMAC/Convex path at `2026-10-09T16:32:47Z`:
  `forwarded=1`, `retried=0`, `responseCounts={"204":1}`. Its normalized event
  is durable in the transactionalEmail mount. It is intentionally unmatched to
  any send and cannot change the real canary's recipient state.
- Four DLQ copies of the original synthetic fixture were re-enqueued after the
  fix and acknowledged from the DLQ only after the source Queue accepted them.
  Convex retains exactly one normalized record for that event and counts four
  duplicate ingestions; a fresh DLQ pull reports backlog zero. The second fresh
  fixture also has exactly one record. Both stay unmatched, separate from the
  one real email/one accepted attempt.

At the end of this first run, no provider-origin event had been observed and
its recipient remained `accepted`. Synthetic forwarding alone did not satisfy
real delivery correlation. The separately authorized follow-up below resolves
that observation for a recipient outside the account's verified destinations.
Bounce/complaint and reordered transitions remain verified with local fixtures;
no actual bounce or complaint was induced against the live inbox.

Package `0.4.1` is published from release PR #13 and includes the Workers runtime
fix from PR #12. [Main CI](https://github.com/FantasticDevHQ/convex-cf-email-service/actions/runs/38019833522)
and [OIDC release/pre-publication checks](https://github.com/FantasticDevHQ/convex-cf-email-service/actions/runs/38019833870)
passed. npm latest and the published gitHead match
`472ec27e929d14dda14c2507501f8b12ec7af249`, with SLSA provenance.

## Recipient-dependent event investigation — 2026-10-10

Two separately authorized sends to an existing, verified Email Routing destination
arrived at Gmail with matching binding Message-IDs and passing SPF/DKIM/DMARC,
but neither appeared in the sending subdomain's Activity log or durable events.
The first message was subsequently found in Trash; the second had no Inbox label.
Mailbox receipt, inbox placement and provider event publication are separate checks.

The enabled subscription predates both sends. Read-only inspection confirmed the
exact account/zone/subdomain, six event types, correct Queue/Worker consumer,
five retries and isolated DLQ. A narrow Queue metrics window around the first
send had zero ingestion. Existing API credentials lack Analytics Read, so the
`emailSendingAdaptive` API query could not independently verify historical logs;
permissions were not expanded. Other domains' visible logs contained unrelated
messages, not either canary.

The deployed Worker source and binding settings confirm structured native
`EMAIL.send(payload)` with the sender restricted to `demo@cf-email.fantastic.dev`.
There is no external provider or fallback in this path. The returned binding
Message-ID matches the received message. See Cloudflare's
[Workers send API](https://developers.cloudflare.com/email-service/api/send-emails/workers-api/).

Cloudflare documents that sending to verified destination addresses is free,
including accounts configured only for Email Routing, and excluded from sending
quota ([pricing](https://developers.cloudflare.com/email-service/platform/pricing/)).
Its [event subscription contract](https://developers.cloudflare.com/email-service/platform/event-subscriptions/)
distinguishes Email Sending events from Email Routing events. Neither statement
promises that verified-destination sends appear in Email Sending telemetry.
An independent [Mailda experiment](https://mailda.site/docs/receipts/email-sending-events/)
reported the same recipient-dependent pattern. This is a troubleshooting clue,
not a documented guarantee about Cloudflare's internal implementation.

### Successful provider-origin delivery

The owner authorized one additional canary to an operator-controlled mailbox
that is **not** a verified Routing destination. No domain, Routing destination,
subscription, credentials or Worker settings changed between these tests.

| Evidence                           | Observed value                                                     |
| ---------------------------------- | ------------------------------------------------------------------ |
| Request UUID                       | `8fdae68f-701c-422f-9b92-8a0a94a9892f`                             |
| Intent                             | `j971e022memdqm72aw104jnvt58g14v5`                                 |
| Submitted                          | `2026-10-10T03:59:42.366Z`                                         |
| Binding / Gmail / event Message-ID | `<ltBUBW1jljrl0zIdNxr2ustpjB59wpOtXTaV@cf-email.fantastic.dev>`    |
| Provider event ID                  | `01a123f7-9022-7f82-85ed-f41889ad5d53`                             |
| Delivered event timestamp          | `2026-10-10T03:59:50.009Z`                                         |
| Durable event ingestion            | `2026-10-10T03:59:55.556Z`                                         |
| Component event row                | `jd7771aex0eqs4cdqxx01d16158g0cr1`                                 |
| Canonical event digest             | `8099754206209b261fb00f4efa50f67507404b6d6b48833db177e48942955311` |

Before any operator replay, the event existed with `applied=true` and the matching
recipient was `delivered`. The configured Queue/Worker/HMAC path therefore
correlated a real provider-origin event with the accepted send. Gmail showed the
message in Inbox with SPF, both sender-domain and Cloudflare DKIM, and DMARC
passing. The subdomain's Activity log independently showed **Delivered** for the
same subject, recipient and Message-ID after a short dashboard delay.
The intent remains `accepted`; recipient delivery is tracked separately.

This controlled recipient change supports verified-destination handling as the
explanation for the earlier missing telemetry. The provider's internal routing
mechanism is still an inference. Keep a non-verified, operator-controlled
recipient for lifecycle canaries; do not remove existing Routing destinations
or alter mail settings to obtain logs.

### Queue replay and deduplication

At `2026-10-10T04:06:35.968Z`, the operator replayed the already observed event
through the same isolated delivery Queue. The original acknowledged provider
envelope was not retained. The replay envelope was reconstructed from the durable
event plus the existing source/subscription metadata. Before enqueueing,
`normalizeCloudflareEvent(reconstructed, config)` was asserted deeply equal to
the stored event, including its original ID, Message-ID, recipient, timestamp,
kind and permanence. This verifies exact **normalized event** replay, not
byte-for-byte replay of the original provider envelope.

Read-only before/after comparisons found all event and recipient rows unchanged:
exactly one applied row for this real event, with the same digest, and the
recipient still `delivered`. Today's `duplicate_events` increased from 0 to 1;
`event_delivered` stayed 1 and `attempts` stayed 2 (the two authorized sends
that day). The successful canary still has exactly one accepted attempt.
Thus replay traversed Queue normalization and authenticated ingestion without
adding an event, applying delivery twice, or causing another send.

No new email was sent for replay. The two unmatched synthetic fixtures remain
separate from the real provider event. The earlier retry exhaustion and DLQ
recovery evidence above remains applicable; real duplicate replay verifies the
successful path against an actual observed event identity.

No Cloudflare Support request was submitted. The owner requested manual
troubleshooting and prohibited contacting Support. This investigation changed
no domain, DNS, mail routing, access or credential settings.
