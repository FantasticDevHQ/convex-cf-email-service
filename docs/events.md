# Cloudflare Queues bridge

Cloudflare Email Sending emits lifecycle events through domain-scoped Event
Subscriptions to Cloudflare Queues, not a direct email webhook. Event schema version
1 includes type, source (zone/domain), metadata (account/subscription/timestamp),
and a payload containing event/message ID, recipient and delivery details.
The bridge validates account, zone, domain, subscription, version, type, terminal
flag, delivery status and timestamp. It forwards only event ID, message ID,
recipient, normalized kind/time and permanent-bounce indicator. Subject, sender,
SMTP responses and raw provider errors are discarded.

After separate deployment approval, configure a sending domain, its subscription
for delivered/deferred/bounced/failed/rejected/complained events, an event queue,
a Worker consumer and a DLQ. `example/worker/wrangler.jsonc` shows placeholders,
batch size 10, five retries and the DLQ. Domain verification, binding permissions,
subscription IDs, Queue resources and deployment are operator setup; none are
created by this implementation. Add supported event types explicitly to the
subscription. Cloudflare's docs are the authoritative setup reference below.

The Worker pins source configuration and maps it to an opaque host scope. The
host HTTP endpoint independently pins the scope and target component mount;
never accept arbitrary account/scope mapping from the request. Use a separate
secret for each trust domain and for the optional Worker send endpoint.

Each forwarded POST uses HMAC-SHA256 over `timestamp + '.' + exact JSON bytes`,
with x-email-timestamp and x-email-signature headers. Use HTTPS, a random secret
of at least 32 characters, and supported Worker/Convex environment secret storage.
Timestamp skew is limited to five minutes; body reading is limited to 16 KiB.
The signature comparison consumes all 64 hex characters. A replay within the
window reaches transactional event-ID deduplication; conflict reuse rejects.
Keep clocks synchronized and never log signatures/bodies or expose the endpoint's
secret to browsers. The host verifies before invoking the component. A compromised
bridge key has ingestion authority; rotate it through the operator workflow.

For rotation, configure new and previous event keys in the host, update the
Worker's current signing key, wait out Queue retry/DLQ replay expectations, then
remove the old key. Changing secrets/access is outside this implementation's
scope. The sample supports two accepted host keys; don't persist them in component
configuration. The send bridge uses a different key; coordinate its host/Worker
rotation and treat an uncertain submission response as ambiguous.

Each Queue message is acknowledged only after the host responds 2xx following
a committed ingestion mutation. Network failure, host 401/503, unsupported schema
or malformed event is retried. Poison messages eventually enter the configured
DLQ, where an operator reviews sanitized failure counts and replays after fixing
source configuration/schema. Duplicate replay is safe. Do not acknowledge before
persistence. DLQ replay after the 30-day event dedup horizon is a new event; keep
replay within that horizon or perform explicit reconciliation.

Outbound forwarding uses `redirect: "manual"` and rejects non-2xx responses,
including redirects. Workers rejects `redirect: "error"` before sending; Node
tests alone do not detect that runtime difference. The package check includes
an actual workerd regression test for 503 retry, redirect rejection without
following the destination, and recovery to 204 acknowledgement.
`forwardEvents` accepts an optional failure callback with only `invalid_event`,
`signing_failed`, or `forward_failed`; diagnostic failures cannot interrupt the
batch. The example logs aggregate response/failure counts without event bodies,
addresses, signatures or keys.

Correlation uses `(scope, provider message ID, normalized recipient)`, never email
address alone. Pending events are stored for acceptance/event races, up to 100
unmatched events per correlation tuple. Recipient updates and applied flags commit
with acceptance or ingestion. Acceptance replays up to five pending events per
recipient inline; the remainder drains in scheduled batches of 25 to bound
transaction work. Those callbacks re-read current state, so newer event evidence
cannot be undone by delayed drain work. The same provider ID/recipient cannot be assigned
to two intents in one scope. REST lacks documented response IDs: obtain an ID from
trusted provider evidence, then call attachMessageId on an accepted intent.
Do not infer it using subject, timing or shared recipient address.

Recipient states start queued. Provider acceptance creates accepted/delivered/
bounced outcomes. Deferred events are provider-owned retry notifications.
Delivered is recipient mail-server acceptance. Terminal evidence cannot be
reversed by a later deferral. Contradictory terminal evidence uses deterministic
severity: complained > bounced > rejected > failed > delivered; equal-state updates
keep the latest timestamp. This conservative policy is independent of arrival
order; complaint always remains sticky. Soft/exhausted retry bounces are terminal
but do not create permanent suppression. Hard bounces and complaints do, even if
the event arrived before the send-completion write.

Sources checked 2026-10-08:

- https://developers.cloudflare.com/email-service/platform/event-subscriptions/
- https://developers.cloudflare.com/email-service/api/send-emails/workers-api/
- https://developers.cloudflare.com/email-service/api/send-emails/rest-api/
- https://docs.convex.dev/components/authoring
