# Release readiness and bootstrap

Version 0.2.0 of @fantastic.dev/convex-cf-email-service was published through
GitHub Actions OIDC on 2026-10-08, from reviewed release commit
4dc7684ac568f09d9c48abfe041e1f729333c310. The repository is public and independent
(`isFork=false`), retains Apache-2.0, NOTICE and upstream modification notices.
See docs/verification.md for registry and provenance verification evidence.

The reference is FantasticDevHQ/convex-tinybird at
bfe0395c148f80b723fc21729643d04ab6f17392. CI, release.yml, Release Please config,
manifest, package metadata and clean-consumer implementation were inspected.
Actions are pinned to its full revisions. pnpm and Node are pinned; installation
uses the committed frozen lockfile. Release uses Conventional Commit-driven
version/changelog PRs and pre-major minor version bumps. The bootstrap SHA is the
independent repository's initial baseline; the import is retained as its own commit.

The organization release App creates the release PR so required CI runs. A
GITHUB_TOKEN release-only pass creates the tag/release; the App-token PR-only pass
creates/updates the version PR. Merging the version PR is the release decision.
Publishing runs in that same workflow because GITHUB_TOKEN-created tags do not
trigger another workflow. Manually pushed v* tags use the same publisher only when
the release job was skipped, avoiding the second publisher path. Workflow
concurrency serializes releases. Never merge a release PR during this task.

Before publication the workflow checks package/tag agreement, exact changelog
version, npm >=11.5.1, frozen install, package build/typecheck/fault tests, examples,
README sample compilation, pack/licensing/exports checks, fresh isolated codegen
and a separate packed consumer. It uses OIDC trusted publishing with provenance,
public access and no long-lived npm token. Publish ignores lifecycle scripts
because the verified dist is already built. A manual tag preserves an existing GitHub release or creates a missing one
with extracted version notes and a verified tag. If npm already has the version, publishing
fails rather than rewriting immutable history; inspect the prior run before retry.

Bootstrap requirements for future repositories (completed here with owner authorization):

1. Confirm public repository visibility, package-name/scope ownership, npm org
   permission and package metadata URL. npm provenance requires supported public
   source/repository conditions. Choose the first authorized release version.
2. Grant the existing organization release GitHub App access to this repository
   with contents, pull-requests and issues write. Make RELEASE_APP_CLIENT_ID
   available as an organization variable and RELEASE_APP_PRIVATE_KEY as an
   organization secret restricted to this repository. Do not create personal
   npm tokens or grant excess organization access.
3. For a new npm package, npm >=11.15 supports `npm stage publish` to create an
   unpublished bootstrap stage, then `npm trust github` with repository
   FantasticDevHQ/convex-cf-email-service, file release.yml and `--allow-publish`.
   Owner login and 2FA are required. Keep the bootstrap version distinct from the
   first public version; reject the unpublished stage after verified OIDC release.
   Never approve the bootstrap stage or put the local npm login token in CI.
4. Require Package checks and Independent consumer on main, ensure the release
   App's PRs run CI, and enforce Conventional Commit squash titles. Configure any
   organization/environment review policy deliberately before a release decision.
5. Confirm all gates green on the reviewed release commit. Approve and merge the
   release PR only in a later release session. Inspect npm version, provenance,
   license/NOTICE/provenance artifacts, and run EMAIL_CONSUMER_SPEC with the exact
   published version to verify registry installation after publication.
6. Separately approve domain/Queue/Worker/Convex live deployment and provider
   credentials. Use the adoption canary and rollback criteria before production.

Publication and provenance are verified below. Linear acceptance criteria were
reconstructed from the approved scope; current follow-up verification is recorded
in docs/verification.md. Live rollout remains separately authorized.

Primary npm references:

- https://docs.npmjs.com/trusted-publishers/
- https://docs.npmjs.com/generating-provenance-statements/

## First publication and recovery

The initial release App key failure was resolved by the owner-authorized addition
of this repository to the existing organization secret's selected repositories.
The owner also authorized public visibility and npm bootstrap/publication.
Release Please PR #3 created v0.2.0. A fresh tag workflow dispatch ran after public
visibility and trusted-publisher setup; rerunning the original private-repository
push would retain its private event metadata.

Run 37794588228 passed both pre-publication gates and published 0.2.0 with OIDC and
signed provenance. Its final step failed with HTTP 422 because Release Please had
already created the GitHub release. Do not rerun npm publication against 0.2.0:
versions are immutable. The release helper now preserves an existing release,
creates a missing manual release with `--verify-tag`, and propagates creation
failures. Regression tests cover those three cases.

- Publish run: https://github.com/FantasticDevHQ/convex-cf-email-service/actions/runs/37794588228
- GitHub release: https://github.com/FantasticDevHQ/convex-cf-email-service/releases/tag/v0.2.0
- npm package: https://www.npmjs.com/package/@fantastic.dev/convex-cf-email-service/v/0.2.0
- Transparency record: https://search.sigstore.dev/?logIndex=3149794516
