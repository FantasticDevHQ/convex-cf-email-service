#!/usr/bin/env bash
set -euo pipefail
: "${RELEASE_TAG:?RELEASE_TAG is required}"
: "${RUNNER_TEMP:?RUNNER_TEMP is required}"
if gh release view "$RELEASE_TAG" >/dev/null 2>&1; then
  echo "GitHub release $RELEASE_TAG already exists; preserving its notes and assets."
  exit 0
fi
# Lookup failure is not success: creation must still succeed, or fail visibly.
gh release create "$RELEASE_TAG" --verify-tag --title "$RELEASE_TAG" --notes-file "${RUNNER_TEMP}/release-notes.md"
