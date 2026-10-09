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
- Replay the exact event through the isolated Queue. Verify one component
  event and stable recipient state, with no additional provider send.
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

**Remaining gate:** no provider-origin lifecycle event for the real canary has
been observed. Its Convex recipient remains `accepted`, even though Gmail receipt
is verified. Synthetic ingestion is not proof of provider event publication,
real-ID delivery correlation, or replay of that provider event. Investigate the
enabled subscription with Cloudflare before claiming full live event verification;
do not send another real message or fabricate a delivery event for this ID.
Bounce/complaint and reordered recipient transitions are verified with local
fixtures; no actual bounce or complaint was induced against the live inbox.

Package `0.4.0` is published; its successful release run is
[37961851943](https://github.com/FantasticDevHQ/convex-cf-email-service/actions/runs/37961851943).
That release predates the runtime fix in PR #12. The isolated live Worker has
the fix, but npm consumers need the next release after PR #12 merges.
