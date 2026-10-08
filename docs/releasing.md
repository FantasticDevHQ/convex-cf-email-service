# Release readiness and bootstrap

Prepared package is @fantastic.dev/convex-cf-email-service, version 0.1.0.
Public npm lookup returned 404 on 2026-10-08; this establishes absence, not scope
ownership or permission to publish. No package has been published by this work.
GitHub currently reports this repository as PRIVATE and isFork=false (2026-10-08).
Public visibility is a concrete provenance prerequisite still requiring a separate
owner-approved access change; this implementation does not change visibility.
The repository is independent, retains Apache-2.0 and upstream attribution, and
includes modified-source notices and provenance in packed artifacts.

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
because the verified dist is already built. A manual tag also creates a GitHub
release with extracted version notes. If npm already has the version, publishing
fails rather than rewriting immutable history; inspect the prior run before retry.

Required operator bootstrap, intentionally not configured here:

1. Confirm public repository visibility, package-name/scope ownership, npm org
   permission and package metadata URL. npm provenance requires supported public
   source/repository conditions. Choose the first authorized release version.
2. Grant the existing organization release GitHub App access to this repository
   with contents, pull-requests and issues write. Make RELEASE_APP_CLIENT_ID
   available as an organization variable and RELEASE_APP_PRIVATE_KEY as an
   organization secret restricted to this repository. Do not create personal
   npm tokens or grant excess organization access.
3. For a new npm package, perform npm's supported first-package bootstrap as an
   explicit publication action, then configure its trusted publisher with owner
   FantasticDevHQ, repository convex-cf-email-service and workflow release.yml.
   Follow npm's current trusted-publisher setup for new packages; this task does
   not publish a bootstrap artifact or change access. If npm requires an existing
   package before publisher setup, that first publication is separately approved.
4. Require Package checks and Independent consumer on main, ensure the release
   App's PRs run CI, and enforce Conventional Commit squash titles. Configure any
   organization/environment review policy deliberately before a release decision.
5. Confirm all gates green on the reviewed release commit. Approve and merge the
   release PR only in a later release session. Inspect npm version, provenance,
   license/NOTICE/provenance artifacts, and run EMAIL_CONSUMER_SPEC with the exact
   published version to verify registry installation after publication.
6. Separately approve domain/Queue/Worker/Convex live deployment and provider
   credentials. Use the adoption canary and rollback criteria before production.

The publishing ticket FANT-62 remains incomplete until actual authorized npm
publication/provenance and independent registry consumer verification. Release
workflow preparation alone cannot satisfy its publication scope. Missing Linear
acceptance text is separately recorded in docs/verification.md.

Primary npm references:

- https://docs.npmjs.com/trusted-publishers/
- https://docs.npmjs.com/generating-provenance-statements/

## Post-merge bootstrap diagnosis

PR #1 merged as 777f518b68a12f23af81d1b509ddb1b3010b4652 on 2026-10-08.
Both main-branch CI jobs passed. Release run 37778664206 failed because the
release App private-key input was empty. Read-only organization metadata confirms
RELEASE_APP_PRIVATE_KEY exists with selected-repository visibility, and this
repository is not selected. RELEASE_APP_CLIENT_ID is available. An owner must
explicitly authorize and enable this repository for that existing secret, and
confirm the App installation includes this repository. No key should be copied
into source or a plaintext cache.

The workflow now checks bootstrap before creating tags and obtains the App token
before its GITHUB_TOKEN release-only pass. A failed release job cannot enter the
normal publisher path; the manual-tag path remains available when that job is
skipped. Tests cover missing inputs, no credential output, ordering and publishing
failure gating. This makes missing setup explicit without bypassing it or silently
reporting a successful release. Repository visibility remains PRIVATE, and no npm
publication or live deployment has been authorized.

Failed run: https://github.com/FantasticDevHQ/convex-cf-email-service/actions/runs/37778664206
