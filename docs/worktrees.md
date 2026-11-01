# Anonymous local worktrees

Installed using the Node installer from FantasticDevHQ/convex-worktrees commit 52c0b76d960a98afedd48607d6737bc14a954c1e. Exported modules/tests and the upstream MIT notice live under scripts/worktree/. The application remains Apache-2.0. scripts/worktree.mjs is the upstream compatibility wrapper.

The layout adapter targets the root convex.json, deploying example/convex and both email components. Vite runs from example/ using its reserved port with strictPort enabled. Setup supplies VITE_CONVEX_URL and generates a checkout-local EMAIL_BRIDGE_SECRET. No cloud login, production credentials or real email provider is needed for schema/component deployment.

Install with pnpm install --frozen-lockfile. The library must be built before provisioning because the host imports its dist exports. Commit source changes, then run pnpm worktree:setup and pnpm worktree:start. Add --frontend to start for Vite. Setup fetches the configured origin/main and refuses dirty/divergent work. After adoption reaches the selected remote base, create new checkouts with node scripts/worktree/cli.mjs setup --path ../email-feature --branch feature/my-change. Do not merge a topic to main as part of setup.

pnpm worktree:stop retains ports/data. pnpm worktree:teardown releases ports and retains data. pnpm worktree:cleanup --yes deletes only owned state. pnpm worktree:prune removes only eligible missing-checkout reservations with free ports. Keep the registry shared across checkouts. Never upload .worktree/, .convex/ or generated environment files. Ownership verification and SIGINT forwarding protect sibling services.

Use pnpm test:worktree for unit/freshness checks and pnpm test:worktree:integration for two real backends. Integration builds the library and installs a local-only probe in disposable detached worktrees, using the existing orders table and actual components. It checks distinct rows, stable restart, persistence, occupied ports and sibling-safe teardown/cleanup. No unauthenticated probe enters the deployed application. Full checks and integration run on UbiCloud Linux; local Mac compatibility is separately unverified. External provider delivery requires independent credentials/tests.

Upgrade by inspecting upstream changes and Quick start, running node scripts/check.mjs in the toolkit, then reconciling its exports/tests and updating provenance. Local adaptations are the Vite command/environment adapter and component-library integration fixture. Compare future monorepo changes against the qualified LaunchHunt packages/backend reference; this single-package repository does not establish that qualification.

The PR metadata workflow executes only trusted base code and activates after landing on base. Workflow installation does not establish required-status branch protection or plan support; verify those separately.

PR files were reconciled from JibHQ/jib-factory commit fae094712705fc1baba55fb4b3cfaaef78041b3a. Preserve trusted-base execution when updating them.
