# Provenance

Upstream: https://github.com/ezyyeah/cloudflare-email-sending
Pinned revision: ecd56ba4e6da0cb528c44fb45c63bd8ada2fa3b7
License: Apache-2.0. No NOTICE file is present at this revision.
Original author/package attribution: ezyyeah, @ezyyeah/cloudflare-email-sending.

This is an independent FantasticDevHQ repository, not a GitHub fork.
The import commit retains the upstream snapshot in Git history. Subsequent
Fantastic Dev HQ modifications replace token persistence and isolate-local caches
with host-owned transport, transactional intent, delivery events and retention.
Modified source files carry modification notices; LICENSE remains applicable.

Release standard reference: FantasticDevHQ/convex-tinybird at
bfe0395c148f80b723fc21729643d04ab6f17392 (inspected 2026-10-08).

API modification notice: this independent package deliberately replaces upstream
send/config/workpool APIs, including token-bearing runtimeConfig, with enqueue and
host-owned transport contracts. It does not promise drop-in upstream API compatibility.
The upstream demo UI is replaced by host/Worker integration examples; full original
source and demo remain preserved in the import commit.

Release-check scripts are adapted from FantasticDevHQ/convex-tinybird at the revision
above, also Apache-2.0. This repository uses the same Fantastic Dev HQ ownership.
