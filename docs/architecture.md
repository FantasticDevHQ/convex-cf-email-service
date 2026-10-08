# Component and host contract

Component functions operate inside an isolated Convex component. Consumers own
schema, authentication, templates, sender authorization, account/domain scope,
secret lookup and product metrics. The wrapper uses `createFunctionHandle` on an
internal host action. Convex validates callback arguments and return values; the
host receives `{emailId, attempt, scope, transport, idempotencyKey, expiresAt,
payload}`. Persisting a function handle is permitted by Convex component boundaries.
A handle is a callable capability: expose enqueue only through authorized host
functions and choose handles in server code, never from untrusted client input.

The component persists an opaque alias, never provider tokens or secret-store
values. The host resolves a current token or Worker bridge credential immediately
before submission. Worker binding uses `env.EMAIL.send` and no Cloudflare API token.
Two independent mounts can reserve application authentication traffic separately
from receipts. A shared provider/account quota still needs host admission control.

| Transport result | Required evidence                                                 | Component behavior                                            |
| ---------------- | ----------------------------------------------------------------- | ------------------------------------------------------------- |
| accepted         | Exactly one outcome per requested recipient, optional provider ID | Stop submission retries; attach IDs and replay pending events |
| not_sent         | Proof that provider submission was rejected or never started      | Retry only when retryable, under attempt and expiry limits    |
| ambiguous        | Unknown acceptance, exception, crash, timeout, malformed response | Hold; no automatic external resubmission                      |

Binding rate/daily quota and documented validation failures are classified as
pre-submission rejections. Unknown/internal/delivery binding errors are ambiguous.
REST resolves credentials per call, has a 30s timeout, rejects redirects, treats
429 as safe throttling and 400/401/403/422 as terminal rejection. REST 5xx remains
ambiguous even when common retry advice suggests retrying. Other REST errors,
partial/unrecognized responses and connection failures also remain ambiguous.
The host must disable retries in any HTTP client/proxy wrapping either adapter.

The component is the sole owner of submission scheduling. Transactional enqueue
creates the intent, recipient rows, expiry/retention callbacks and one dispatch
callback. Duplicate keys never create another callback. Claim atomically transitions
queued/retrying to sending and adds one numbered attempt. Concurrent claims lose
via Convex's transaction conflict detection. A durable 60s lease callback moves a
still-sending attempt to ambiguous; it never submits the message again. After
claim there can be a crash before network I/O, during I/O, or after acceptance
before completion. All three are intentionally held for reconciliation.

Attempt-number fencing ignores duplicate/stale completions. A late accepted
completion may resolve the same ambiguous attempt. A failure committing completion
leaves sending intact until lease recovery. Adapter returns must cover every
recipient, including mixed REST accepted/delivered/permanent-bounce outcomes;
validation failure rolls back all acceptance writes and leaves the lease authoritative.

Safe rejection retries use 1s exponential delays capped at 5 minutes, at most 4
attempts by default, configurable from 1 to 8. A retry that would reach expiry
expires instead. Provider deferral/delivery retries never cause resubmission.
Enqueue expiry is absolute, required, and at most 24h away. Current adapters check
it before submission, including after REST credential resolution. The host must
apply the same deadline inside custom transport actions.

`cancel({id})` returns true only for queued/retrying intent. In-flight cancellation
sets cancelRequested and returns false; acceptance is still recorded. A proven
not-sent completion after cancellation ends cancelled. Cancellation does not recall
a message already accepted by a recipient server.

An authorized operator uses `reconcile({id, attempt, decision})` only for the
current ambiguous attempt. Accepted decisions need per-recipient provider evidence;
not_sent decisions need proof of non-acceptance, not the absence of a delivery event.
An abandon decision ends failed without resubmission. Stale decisions reject.
If evidence cannot resolve ambiguity, leave the intent held or abandon it. There
is no documented provider lookup that this package can safely invent.

The durable unique key is `(scope, key)` within a mount. SHA-256 covers the canonical
payload and transport alias. Reuse with different content/transport rejects;
reuse with the same content returns the original ID and original policy. Changing
expiry, attempt limits, retention or callback does not resurrect an old intent.
After the dedup horizon a key may be reused; callers must choose a horizon matching
their business replay window. Keys must be opaque identifiers, not email links,
access tokens or sensitive subjects. There are no process-local dedup caches.
