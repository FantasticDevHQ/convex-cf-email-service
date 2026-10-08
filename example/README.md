# Host and Worker examples

`convex/` mounts separate transactional and auth email components. Receipt enqueue
writes a host-owned order record atomically, and an internal host REST action resolves
the current token. `http.ts` verifies signed event bytes, pins the store scope and
commits ingestion before returning success. The host controls all auth, schema and
template logic. The internal receipt helper is not a public API.

`worker/` uses the native EMAIL binding for signed send requests and consumes delivery
Queue messages. The host workerTransport action resolves its bridge secret per call.
Do not retry a lost send response; reconcile ambiguity. Use different credentials for
sending and delivery-event forwarding. The config contains placeholders and five
Queue retries plus a DLQ. These files are typechecked but not deployed.

Read ../docs/events.md before separately authorized domain, Queue, subscription,
secret and infrastructure setup. Replace scope/source/endpoint mapping in host code
for your app; do not expose source configuration or callback handles to browsers.
