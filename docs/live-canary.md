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
   A later static-only deployment with `wrangler.jsonc` would remove this
   Worker handler and Queue consumer; keep using the canary configuration
   while this verification is active.

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

The local host/Worker fault tests cover authentication, transport selection,
provider ID return, ambiguous sends, signed and sanitized Queue forwarding,
failure/recovery, and source isolation. Live sending-domain activation,
subscription creation, deployment, inbox receipt, and Queue retry/DLQ evidence
are still pending. Do not treat passing local tests as live verification.

Package `0.3.0` is published; its successful release run is
[37946970162](https://github.com/FantasticDevHQ/convex-cf-email-service/actions/runs/37946970162).
