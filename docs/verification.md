# Implementation evidence and remaining gates

Project and FANT-52 through FANT-62 were read before implementation on 2026-10-08.
Both Linear connector and direct CLI confirm that the issue descriptions contain
literal truncation markers, with missing acceptance text; no comments restore it.
No acceptance boxes or Done states are claimed for unseen criteria. The visible
scopes and the complete project description define the implemented contract.

| Ticket  | Implementation and reproducible evidence                                                                                                                                                                                                                                          |
| ------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| FANT-52 | Independent repository (`isFork=false`); exact import commit 380fc8d, upstream SHA in UPSTREAM.md, Apache LICENSE, attribution NOTICE and modification notices; licensing included in pack gate                                                                                   |
| FANT-53 | docs/architecture.md, createFunctionHandle wrapper and secret-free schema; independent consumer codegen, two mounts, real local host callback                                                                                                                                     |
| FANT-54 | Host-only binding/REST contracts, per-call resolver, no token-bearing component config; rotated-credential and sanitized-error tests; component boundary gate                                                                                                                     |
| FANT-55 | Transactional enqueue/scheduler ownership, SHA-256 conflicts, fenced claims, bounded rejection retries, cancellation, expiry, ambiguity recovery/reconciliation; duplicate callback, crash, late completion and stale-attempt fault tests                                         |
| FANT-56 | Version/source-pinned Queue normalization, timestamped HMAC, streaming bounds, per-message ack/retry, DLQ configuration example; authentication/tamper/rotation/skew and Queue fault tests                                                                                        |
| FANT-57 | Per-recipient IDs/outcomes, pending event batches, durable event conflict/dedup, deterministic terminal precedence; early/reordered events, mixed recipients, pending drain, REST ID attachment tests; live local consumer event                                                  |
| FANT-58 | Scoped hashed suppression, claim-time check, hard/soft bounce distinction, sticky complaint, explicit host clearing; pre-acceptance complaint, scope isolation and soft/hard bounce tests                                                                                         |
| FANT-59 | Content expiry/terminal redaction, metadata pruning, dedup tombstones, event/metric horizons and seven-day deadline-checked callbacks; secret-link expiry, early cleanup rejection and horizon tests                                                                              |
| FANT-60 | Operational daily counters, sanitized status, README/examples, actual pack/boundary/export checks, full codegen freshness and independent tarball consumer gates                                                                                                                  |
| FANT-62 | Prepared npm metadata and Conventional Commit/Release Please/App/OIDC/provenance workflow; pinned Actions, frozen lockfile, package/tag/changelog gates and both full checks before publish; docs/releasing.md bootstrap requirements. Publication itself is deliberately pending |
| FANT-61 | docs/adoption.md: separately tracked JIB integration, auth-capacity/expiry checks, canary and rollback. Jib is untouched. Activation follows publication dependency                                                                                                               |

Local gates:

- `pnpm run check`: clean build, package/host/Worker typecheck, component/transport/
  bridge/validation fault tests, release-note gate tests, actual packed files,
  README sample compilation and isolated anonymous codegen comparison.
- `pnpm run check:consumer`: installs the packed tarball outside the workspace with
  only this package and Convex as direct runtime dependencies; anonymous local
  backend codegen/typecheck, real callback plus delivery event, and convex-test
  early/duplicate event and mount-isolation behavior.
- `git diff --check`: whitespace integrity.

These are controlled local sends through stub transport, not live Cloudflare
email delivery. Live Worker/binding/domain/Queue subscription, provider credential
rotation and production capacity require the separately approved staging/rollout
steps in docs/adoption.md and docs/events.md. REST provider-ID correlation cannot
be verified end to end without provider evidence absent from its send response.

Concrete remaining release gates: repository is currently PRIVATE; npm provenance
needs a public repository, and visibility/access changes are outside authorization.
The npm package returned public 404; scope permission, first publication bootstrap,
trusted publisher and organization release App access remain operator setup.
No merge, npm publication, live infrastructure deployment, credential/access change
or Jib change was performed. FANT-62 cannot be Done without publication evidence.
