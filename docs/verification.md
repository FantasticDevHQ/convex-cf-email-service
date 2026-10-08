# Implementation evidence and remaining gates

Project and FANT-52 through FANT-62 were read before implementation on 2026-10-08.
The initial Linear descriptions contained literal truncation markers. Acceptance
criteria have since been reconstructed from the approved project scope and owner
instructions, recorded in full on FANT-52 through FANT-62, and verified against
source/tests and release evidence. They are not a recovery of the damaged text.

| Ticket  | Implementation and reproducible evidence                                                                                                                                                                                                                                                                                               |
| ------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| FANT-52 | Independent repository (`isFork=false`); exact import commit 380fc8d, upstream SHA in UPSTREAM.md, Apache LICENSE, attribution NOTICE and modification notices; licensing included in pack gate                                                                                                                                        |
| FANT-53 | docs/architecture.md, createFunctionHandle wrapper and secret-free schema; independent consumer codegen, two mounts, real local host callback                                                                                                                                                                                          |
| FANT-54 | Host-only binding/REST contracts, per-call resolver, no token-bearing component config; rotated-credential and sanitized-error tests; component boundary gate                                                                                                                                                                          |
| FANT-55 | Transactional enqueue/scheduler ownership, SHA-256 conflicts, fenced claims, bounded rejection retries, cancellation, expiry, ambiguity recovery/reconciliation; duplicate callback, crash, late completion and stale-attempt fault tests                                                                                              |
| FANT-56 | Version/source-pinned Queue normalization, timestamped HMAC, streaming bounds, per-message ack/retry, DLQ configuration example; authentication/tamper/rotation/skew and Queue fault tests                                                                                                                                             |
| FANT-57 | Per-recipient IDs/outcomes, pending event batches, durable event conflict/dedup, deterministic terminal precedence; early/reordered events, mixed recipients, pending drain, REST ID attachment tests; live local consumer event                                                                                                       |
| FANT-58 | Scoped hashed suppression, claim-time check, hard/soft bounce distinction, sticky complaint, explicit host clearing; pre-acceptance complaint, scope isolation and soft/hard bounce tests                                                                                                                                              |
| FANT-59 | Content expiry/terminal redaction, metadata pruning, dedup tombstones, event/metric horizons and seven-day deadline-checked callbacks; secret-link expiry, early cleanup rejection and horizon tests                                                                                                                                   |
| FANT-60 | Operational daily counters, sanitized status, README/examples, actual pack/boundary/export checks, full codegen freshness and independent tarball consumer gates                                                                                                                                                                       |
| FANT-62 | Prepared npm metadata and Conventional Commit/Release Please/App/OIDC/provenance workflow; pinned Actions, frozen lockfile, package/tag/changelog gates and both full checks before publish; docs/releasing.md bootstrap requirements. 0.2.0 published through OIDC; registry consumer and signed provenance verified (evidence below) |
| FANT-61 | docs/adoption.md: separately tracked JIB integration, auth-capacity/expiry checks, canary and rollback. Jib is untouched. Activation follows publication dependency                                                                                                                                                                    |

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

## Published 0.2.0 verification — 2026-10-08

Owner-authorized bootstrap added this repo to the existing release App secret,
made the independent repo public, and configured the npm trusted publisher for
FantasticDevHQ/convex-cf-email-service, release.yml. No local npm login token was
added to GitHub. The unpublished 0.1.0 bootstrap stage was rejected after release.

- Reviewed release commit: `4dc7684ac568f09d9c48abfe041e1f729333c310` (PR #3).
- Run 37794588228 passed package and packed-consumer gates and published through
  OIDC. Its subsequent GitHub-release creation failed because v0.2.0 already existed.
  The follow-up release helper preserves existing releases; never republish 0.2.0.
- Public npm metadata confirms version 0.2.0, 78 files, Apache-2.0 and provenance.
  Registry tarball retains LICENSE, NOTICE, UPSTREAM.md and modification notices.
- Registry SHA-1: `68708699af62e0a65eb847262ef5f4d551aa4872`.
- Registry SHA-512 (hex): `4d612cff69c158dd4db1abdc2aa0cf7ebfbb22825de347489a13152a899d257cde4baceb07f5e5fd1f6b0544ca3c097bca52653eef5c186b82c29d253f2947e5`.
- A separate minimal npm install followed by `npm audit signatures` passed:
  seven registry signatures and four attestations verified, including this package.
- SLSA attestation subject digest matches that tarball. Its workflow repository,
  `.github/workflows/release.yml`, `refs/tags/v0.2.0`, resolved Git commit and invocation
  URL identify the reviewed release and run above.
- `EMAIL_CONSUMER_SPEC=@fantastic.dev/convex-cf-email-service@0.2.0 pnpm check:consumer`
  passed from an independent temporary npm install: anonymous local backend,
  real codegen/types, stub send and delivery event, early/duplicate event and mount
  isolation test. The exact version came from registry.npmjs.org without workspace links.

Evidence links:

- https://www.npmjs.com/package/@fantastic.dev/convex-cf-email-service/v/0.2.0
- https://github.com/FantasticDevHQ/convex-cf-email-service/releases/tag/v0.2.0
- https://github.com/FantasticDevHQ/convex-cf-email-service/actions/runs/37794588228
- https://search.sigstore.dev/?logIndex=3149794516

## Current release and follow-up audit

Version 0.2.1 is published from reviewed commit
0a0c13d65b22b892bc640cce81657b8ac909ebad. Main CI 37802482669 and OIDC release
run 37802482675 passed. Exact published-version independent consumer passed;
registry signatures/attestations and artifact licensing/provenance were verified.

A subsequent audit reopened FANT-55: exact idempotent replay after the original
send deadline incorrectly failed new-intent expiry admission before consulting
its durable key. Regression tests reproduce this and verify the fix: return the
existing redacted intent without additional schedules or content restoration,
report changed payloads as conflicts, and reject new expired intents. The fix
requires PR review/merge and a subsequent release before consumers receive it.

Separately authorized live infrastructure/provider canary and actual JIB integration
remain rollout work. Missing ticket text is no longer an acceptance blocker.
