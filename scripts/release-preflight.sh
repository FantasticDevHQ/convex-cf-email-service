#!/usr/bin/env bash
set -euo pipefail
if [[ -z "${RELEASE_APP_CLIENT_ID:-}" ]]; then
  echo 'Release bootstrap required: make RELEASE_APP_CLIENT_ID available to this repository. See docs/releasing.md.' >&2
  exit 1
fi
if [[ -z "${RELEASE_APP_PRIVATE_KEY:-}" ]]; then
  echo 'Release bootstrap required: enable this repository in the organization RELEASE_APP_PRIVATE_KEY secret selected repositories. See docs/releasing.md. This workflow does not change access settings.' >&2
  exit 1
fi
