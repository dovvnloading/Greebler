#!/usr/bin/env bash
# Print one GitHub Actions output. Missing history or an unknown event runs
# Chromium rather than silently dropping browser coverage.
set -euo pipefail

case "${1:-}" in
  workflow_dispatch)
    if [[ "${2:-}" == true ]]; then
      echo 'browser=true'
    else
      echo 'browser=false'
    fi
    exit 0
    ;;
  pull_request)
    # Checkout uses GitHub's synthetic merge commit; compare its first parent.
    base=$(git rev-parse --verify HEAD^1 2>/dev/null) || { echo 'browser=true'; exit 0; }
    ;;
  push)
    base=${3:-}
    if [[ ! "$base" =~ ^[0-9a-f]{40}$ || "$base" == 0000000000000000000000000000000000000000 ]]; then
      echo 'browser=true'
      exit 0
    fi
    if ! git cat-file -e "$base^{commit}" 2>/dev/null; then
      git fetch --no-tags --depth=1 origin "$base" >&2 || { echo 'browser=true'; exit 0; }
    fi
    ;;
  *)
    echo 'browser=true'
    exit 0
    ;;
esac

# Empty diffs and failed comparisons are deliberately conservative. Disable
# rename detection so moving a source file into docs still counts as a change.
if git diff --quiet --no-renames "$base" HEAD --; then
  echo 'browser=true'
  exit 0
else
  status=$?
  if [[ "$status" != 1 ]]; then
    echo 'browser=true'
    exit 0
  fi
fi

if git diff --quiet --no-renames "$base" HEAD -- . \
  ':(exclude,top)docs/**' ':(exclude,top,literal)README.md' ':(exclude,top,literal)LICENSE'; then
  echo 'browser=false'
else
  echo 'browser=true'
fi
