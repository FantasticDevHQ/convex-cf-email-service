# Repository development

This pnpm component library has its host backend in example/convex, selected by root convex.json, and a Vite frontend in example/. It is not a Turborepo. Preserve the pinned packageManager, frozen lockfile, Apache-2.0 license and both installed email components.

Follow docs/pull-request-standard.md. Use pnpm test:pr-standard and pnpm test:worktree with one worker. Full pnpm check and check:consumer belong in UbiCloud CI on constrained hosts. Set NODE_OPTIONS=--max-old-space-size=512 for focused local checks. Serialize installs, codegen and real backend integration with flock -w 3600 /home/cloudagent/.cache/fantastic-heavy.lock. Never replace shared runtimes.

Use the setup/start/stop/teardown/cleanup/prune package scripts documented in docs/worktrees.md. Editor/agent setup hooks invoke setup; teardown hooks invoke teardown before removing the checkout. Never copy cloud credentials, reset/stash user work, merge to main automatically or kill by port/name. Stop only verified owned processes. Keep toolkit modules/tests under scripts/worktree/ and retain its LICENSE. Test probe fixtures must remain local to disposable integration checkouts.

PR evidence belongs in the PR. State skipped checks and provider/platform limitations honestly. Do not merge automatically.
