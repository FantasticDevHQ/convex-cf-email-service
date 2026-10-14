# Routing one subscription to multiple mounts

A Cloudflare event identifies the sending source and provider Message-ID, not a
Convex mount or application tenant. Do not broadcast it to every mount. An
unrelated mount can successfully persist a pending event, including suppression,
without owning the send. Requiring all mounts to succeed also makes an unrelated
outage block the owner.

Use `routeDeliveryEvent` from the package's `/bridge` export with a **host-owned,
durable receipt directory**. The helper performs one lookup by the exact provider
Message-ID and invokes only the selected route. It does not query other mounts,
inspect message content, infer ownership, persist credentials, or send email.
`example/routing/shared.ts` is a typechecked host utility selecting two mount/scope
pairs from a server-owned map. `example/routing.test.ts` exercises both real
component mounts. The directory in that test is a fixture, not production storage.

## Receipt contract

Store receipts in a private, indexed host table. Include only:

| Field                | Meaning                                                             |
| -------------------- | ------------------------------------------------------------------- |
| sourceNamespace      | Server-owned account + sending-domain namespace                     |
| messageId            | Exact provider-returned Message-ID, preserving case and punctuation |
| kind                 | `component` or an explicitly recorded `legacy` send                 |
| route                | Opaque server-owned mount/scope route, for component sends only     |
| intentId, attempt    | Opaque acceptance/reconciliation references, if applicable          |
| createdAt, expiresAt | Fixed admission time and finite deletion/routing deadline           |

Use an index on `(sourceNamespace, messageId)`. A trusted host mutation reads the
unique row before insert. Repeated acceptance writes must match the original
kind, route, intent and attempt; conflicts fail closed. Do not refresh expiry on
duplicate writes. Convex transaction conflict detection serializes concurrent
inserts through this indexed read. Lookup must reject conflicting/multiple rows
rather than choosing one. Never implement the directory as a process-local Map,
a scan over component tables, or a browser-accessible ownership API.

The lookup callback returns `EventOwnershipReceipt`: `{kind: "component", route,
expiresAt}`, `{kind: "legacy", expiresAt}`, or `null`. Bind its namespace in trusted
server code after authenticating ingress and checking the configured source. It
receives only Message-ID, not recipient, subject or caller-selected scope. A
shared ingress scope such as `shared-email` is an authentication namespace, not
the target component scope. Ignore mount/route fields supplied by an event.

Route names resolve to an allowlisted mount and scope in host code. Unknown route
names fail closed. Keep route assignments stable across rollouts/rollback; do not
retarget existing receipts when traffic flags change. Status by intent ID is not
an ownership probe. Recipient and time, even together, never establish ownership.

Key provider IDs within the trusted source namespace. Validate each
Cloudflare envelope before stripping it, forward the reduced event using the
existing HMAC bridge, and pin that bridge endpoint to the same namespace. For
multiple domains/accounts, use separate pinned ingress mappings or endpoints.

## Acceptance ordering and crash boundaries

1. Host enqueue chooses the mount/scope and a stable logical send key in server
   code. Record the admission owner atomically with the host business transaction
   if rollout/rollback must preserve ownership before provider acceptance.
2. The host transport makes one provider submission. After native binding
   acceptance, it obtains the returned provider Message-ID.
3. **Before returning the send response**, the Worker writes the immutable receipt
   to the authenticated host receipt endpoint and waits for its committed result.
   Use a separate, server-only acceptance capability. The host verifies source,
   selected route, intent and attempt against the admission record; a signed
   caller must not select an arbitrary owner. Persist neither payload nor secrets.
4. The Convex host transport may idempotently record the same receipt when it
   receives acceptance, then return the accepted result to the component. This
   fallback helps older adapters but cannot replace step 3 when HTTP replies can
   be lost. Persist every distinct provider ID for a multi-recipient acceptance.
5. Component completion attaches IDs and reconciles pending events. This can
   happen after event ingestion and after content redaction.

The subscription can emit an event before step 3 commits. Unknown lookup returns
`unknown_owner`; return HTTP 503 and let the Queue retry later. Once the receipt
exists, a race before step 5 routes to the correct mount and `pending` is a safe
committed ingestion result. Component completion/accepted reconciliation drains
that mount's pending events.

If the Worker response is lost **after** receipt persistence, the event still
routes correctly while the intent is sending or ambiguous. An event or receipt
does not itself finish an ambiguous attempt. An authorized operator can reconcile
accepted using trusted per-recipient provider evidence and the current attempt.
Routing never calls `reconcile`, `enqueue`, or the send adapter.

If the Worker crashes after provider acceptance **before** durable receipt
persistence, ownership may remain unknown. There is no atomic transaction across
Cloudflare's send and the host directory. Receipt-write failures after acceptance
must yield `ambiguous`, never `not_sent`. Retry only the same receipt write when
acceptance evidence is retained durably, never the provider submission. Missing
receipt/event evidence does not prove non-acceptance. Hold the intent and send
unknown events to bounded retry/DLQ review until authoritative evidence permits
backfill or explicit disposition. Do not invent a provider lookup or guess an ID.

For REST transports, record IDs only when supplied by authoritative provider
acceptance/evidence. If a supported response contains no usable ID, document that
limitation and leave unknown ownership unresolved until trusted reconciliation.

## Ingress and acknowledgement

Inside an authenticated host mutation, call the helper with the pinned directory
lookup and an ingest callback that invokes exactly the owning component's
`email.ingest({scope, event})`. The host utility in `example/routing/shared.ts`
shows that dispatch. In one Convex mutation, receipt lookup and component ingestion
share the transaction. External implementations must wait for ingestion commit.

| Helper result                                                        | Host HTTP result                                         | Queue action                    |
| -------------------------------------------------------------------- | -------------------------------------------------------- | ------------------------------- |
| `applied`, `pending`, `duplicate`                                    | 204 after committed owner ingestion                      | Acknowledge                     |
| `legacy`                                                             | 204 after authoritative, unexpired legacy receipt lookup | Acknowledge, no component write |
| `unknown_owner`                                                      | 503                                                      | Retry with delay                |
| Lookup, ownership conflict, unknown route, or owner ingestion throws | 503 with no raw error/body                               | Retry with delay                |

An explicit legacy receipt means this provider ID belongs to the old transport;
its existing pipeline remains responsible for that delivery. Absence is not
legacy ownership. Unknown historical messages need audited backfill from actual
acceptance records, or an operator disposition. Do not broadly discard events
because they precede a rollout date.

The non-owning mount is never invoked, so its outage cannot affect acknowledgement.
The shared directory and owning mount remain required dependencies. Never return
2xx based on the first successful mount, a pending row in another mount, an
in-memory receipt, or an uncommitted asynchronous task.

## Delayed retry, DLQ and retention

For a new shared-subscription consumer, configure a retry delay, bounded attempts,
concurrency and a DLQ, for example:

```jsonc
{
  "queues": {
    "consumers": [
      {
        "queue": "shared-email-events",
        "dead_letter_queue": "shared-email-events-dlq",
        "max_retries": 8,
        "retry_delay": 60,
        "max_concurrency": 4,
        "max_batch_size": 10,
      },
    ],
  },
}
```

`forwardEvents` calls `retry()` on non-2xx responses; the consumer retry delay
applies to those calls. Choose retry count/window from measured acceptance-write
latency and your outage budget. Delivery attempts can exhaust before a long
outage ends; DLQ recovery is part of the design. These are proposed operator
settings, not a change to the deployed example or existing mail domains.

On recovery, repair the directory/owning endpoint first. Re-enqueue the original
provider envelope into the same source-pinned Queue, preserving event ID, provider
ID and lifecycle timestamp. The bridge signs a fresh forwarding request. Delete
or acknowledge the DLQ copy only after re-enqueue is confirmed. A lost re-enqueue
reply may produce duplicates; component event-ID/digest dedup handles them within
its retention horizon. Never recover an event by submitting another email.

Set a finite receipt TTL and a bounded indexed cleanup job. Lookup treats an
expired row as unknown even if cleanup is delayed. Retain receipts through the
supported Queue + DLQ recovery window, but stop automatic routing/replay before
the owning intent's recipient metadata is pruned. Component event dedup lasts
30 days from ingestion; metadata retention is independently configurable at
1–90 days. The safe replay window must fit **both** policies and the receipt TTL.
Ownership receipt expiry does not extend component retention or prove that an
old event was never applied. After a horizon expires, perform explicit audited
reconciliation/disposition rather than replaying as if dedup were still available.

Receipt TTL applies to legacy records too. Do not turn expired or unknown records
into legacy acknowledgements. Provider IDs/intent references are operational data;
keep them private and retain no subjects, bodies, recipient lists, raw provider
errors, authentication tokens or signing secrets in the directory. Monitor only
aggregate unknown-owner, conflict, owner-outage and DLQ counts in diagnostics.

## Verification

- Routing unit tests cover a non-owning outage, owner/directory outages, unknown
  ownership recovery, expired receipts including expiry during lookup, explicit
  legacy sends, malformed input, content reduction and Queue 503-to-204 recovery.
- The two-mount integration test persists an early event only in the owner, loses
  the transport response, observes ambiguity with exactly one attempt, replays the
  same event as a duplicate, and reconciles accepted evidence to delivered.
- The helper remains host-owned routing glue. Consumer schemas/auth/rollout
  controls, receipt persistence and product metrics remain outside the component.

References checked 2026-10-14:

- [Cloudflare Email Sending event source contract](https://developers.cloudflare.com/email-service/platform/event-subscriptions/)
- [Queue retry delays and acknowledgement](https://developers.cloudflare.com/queues/configuration/batching-retries/)
- [Component privacy and retention](./operations.md)
