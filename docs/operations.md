# Privacy, suppression and operations

| Data                                                     | Retention                                                               |
| -------------------------------------------------------- | ----------------------------------------------------------------------- |
| Subject, bodies, HTML links, base64 attachments, headers | Until absolute expiry; after terminal outcome, earliest of expiry or 1h |
| Recipient rows and attempt audit rows                    | metadataDays, default 30, range 1–90                                    |
| Pending/applied delivery events including recipient      | Fixed 30 days from ingestion                                            |
| Dedup tombstone (scope/key/digest/state, no content)     | dedupDays, default 90, range metadataDays–365                           |
| Operational daily metric counters                        | 91 days; queries limited to the last 90 days                            |
| Scoped suppression recipient hash                        | Until an authorized host explicitly clears it                           |

Retention uses durable callbacks and seven-day checkpoints that recheck deadlines.
Expiry redacts stored payload regardless of send state. In-flight host actions may
already hold a copy; redaction cannot recall external content. Metadata pruning
removes all at-most-50 recipient and at-most-8 attempt rows. Dedup tombstones
survive content pruning and prevent logical resubmission. Event retention is a
separate fixed policy; lowering metadataDays does not shorten event retention.
Cloudflare/provider retention, Queue/DLQ retention and Convex backups are outside
this component and need an operator privacy policy. This component stores content
in one bounded document and does not create storage blobs/orphan attachments.

Permanent-bounce/complaint suppression is scoped by mount and opaque host scope;
recipients are SHA-256 hashed without raw addresses in the suppression table.
Hashes can still be personal data and can be dictionary guessed; they are not
anonymization. Suppression is checked at claim, not just at enqueue, so a queued
send sees new complaints. A suppression arriving after claim cannot recall that
submission. Every recipient is checked; any match blocks the whole intent. There
is no blanket authentication/transactional bypass. The host's audited recovery
workflow may invoke clearSuppression only after correcting the cause and obtaining
appropriate recipient consent. Its scope/address are validated by the host. The
component records a suppression-cleared operational counter. Do not expire
complaints automatically merely to make an authentication send succeed.

`status({id})` returns state, attempt count, timestamps, cancellation flag and
aggregate recipient-state counts. It omits recipient addresses, message content,
provider responses, function handles and credentials. Component code never logs
raw payloads/errors. Attempts store only numbers, timing, outcome and enum error
codes. Enqueue/event validation errors use fixed messages without echoing input.
The host must authorize status, reconciliation and suppression functions; component
API functions are accessible to trusted parent functions, not arbitrary browser
clients. Never directly expose them through a public unauthenticated host wrapper.

`metrics({scope, since})` returns daily count/sum buckets: enqueued, attempts,
queue_wait_ms, retries, accepted, acceptance_ms, cancelled, expired, failed,
ambiguous, suppressed, pending_events, duplicate_events, reconciliations,
suppression_cleared, and event_KIND when an event applies to a recipient. Counters
are transactional. Pending replay contributes applied lifecycle metrics exactly
once, while duplicate ingestion increments only duplicate_events. State transition
counters are cumulative transitions, not gauges. queue_wait_ms is summed age at
each attempt, not only first attempt; acceptance_ms is time to request completion.
Consumers compute means/rates with matching attempt/acceptance counters. Query
output is bounded at 3000 rows, enough for supported daily names across 90 days.
These counters are operational delivery health, not product conversions.

Runbook:

1. Monitor ambiguity, expiry, retries/rate throttling, permanent-bounce/complaint
   rates, pending correlations and Queue/DLQ backlog. Alert on any stuck ambiguity,
   auth expiry growth, sustained bridge failure or DLQ entry. Consumers can use
   a host-approved count query on their own intent references for current backlog;
   cumulative component counters are not queue-depth gauges.
2. Confirm provider/account quota and verified sender configuration before rollout.
   Resolve current credentials in the host. On validation rejection fix content
   or configuration before enqueueing a distinct corrected logical send.
3. On safe throttling, let the component retry within expiry/attempt limits; reduce
   host admission. Do not add a second retry owner in the host or Worker.
4. On ambiguity, gather provider acceptance and per-recipient IDs. Reconcile current
   attempt accepted, proven not_sent, or abandon. Missing events are not proof of
   non-acceptance. Fencing prevents a stale resolution from finishing a new attempt.
5. On unknown pending events, verify scope/source mapping and REST correlation
   capability. Never attach a guessed message ID. Replay DLQ only after root-cause
   repair, within dedup retention where possible.
6. Verify retention on a local deployment using fake time/fault tests and inspect
   sanitized status/counters. Monitor cleanup failures from Convex scheduler logs
   without payload logging. Provider retention needs its own checks.
