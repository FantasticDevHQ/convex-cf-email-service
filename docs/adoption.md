# Jib and future consumer adoption plan (FANT-61)

This document is the deliverable. No Jib checkout, schema, auth, templates, metrics
or deployment has been changed. Jib integration must use separately authorized
JIB-team tickets, after npm release readiness/publication (FANT-62). This plan can
be reviewed before release; activation remains blocked on that dependency.

Proposed separately tracked JIB work:

1. Inventory Jib's current authentication sender, token/link expiry, cancellation,
   tenant ownership rules, traffic peaks, provider quota and existing fallback.
   Measure baseline latency, bounce/complaint rate and successful auth completions.
   Assign owners; do not infer the present Jib implementation from this package.
2. Pin the published component version and mount isolated authEmail and
   transactionalEmail instances. Host auth/scope checks, templates, recipient
   permission, provider sender/account selection and domain metrics remain in Jib.
   Create internal host transport actions with supported secret storage/binding.
3. Add host admission control/reserved capacity for authentication ahead of
   receipts. Two mounts isolate state/suppression/dispatch ownership but do not
   partition a shared Cloudflare quota or Convex action capacity. Establish actual
   provider limits and a host concurrency/rate policy before enabling traffic.
4. Make magic-link intent expiry no later than the auth token expiry minus a
   delivery safety margin. Default auth canary: <=60 seconds time to submission,
   no submission after expiry, no retry after provider acceptance. Reissuing a
   token creates a new logical key; cancel old queued intent. Never reuse an old
   key to reset expiry. Bound attempts to fit token lifetime; do not retry ambiguity.
5. Route one authorized internal auth cohort through the component behind a host
   feature flag. Keep other traffic on the incumbent route. Do not double-send
   during shadowing; compare metadata with a non-sending stub before the canary.
   Subscribe/bridge events with source/scope checks, HMAC, DLQ and retention policy.
6. Add JIB-owned auth-success and conversion metrics to the host; component metrics
   remain queue/transport/delivery health. Verify recipient-server delivery does
   not imply inbox placement, reading or a successful login.
7. Load/fault test concurrent auth and receipts, credential rotation at dispatch,
   expiry during lookup, suppression, Queue outages, crashes around acceptance,
   out-of-order/duplicate events, multi-tenant scope and retention. Run the exact
   published artifact through independent codegen/typecheck and actual staging
   provider/binding/event tests using controlled recipients after approval.

Canary gates proposed for the JIB owner to approve against the measured baseline:
no unexpected duplicate submission; no expired magic link submitted; no suppression
bypass; no unauthorized tenant correlation; submission p95 below 60s or the stricter
existing auth SLO; no unresolved ambiguity for the canary; no sustained Queue/DLQ
failure; auth completion rate and bounce/complaint rates within approved baseline
limits. Start at an internal cohort, then 1%, 10%, 50%, 100% only after a full event
window and owner sign-off. Receipts may expand independently after auth capacity
is proven. Avoid a canary during traffic peaks.

Rollback: disable enqueueing new component intents through the host feature flag.
Cancel queued/retrying canary intents and keep event ingestion/reconciliation
running for accepted or ambiguous sends. Never replay accepted/ambiguous intents
through the old provider. Resume only definitively unsent logical operations via
the incumbent route with host deduplication. Existing tokens may expire and require
a fresh user-requested link rather than a duplicate fallback send. Reconcile held
attempts, preserve suppression, collect sanitized fault evidence and schedule
separate JIB fixes before expanding again. Package downgrade alone does not roll
back component data/schema; review migration compatibility and retain previous
host release artifacts.
