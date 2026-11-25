#!/usr/bin/env bash
set -euo pipefail

policy=$(cd "$(dirname "$0")" && pwd)/ci-browser-policy.sh
scratch=$(mktemp -d)
trap 'rm -rf "$scratch"' EXIT
cd "$scratch"
git init -q -b main
git config user.name 'CI policy test'
git config user.email 'ci-policy@example.invalid'

expect() {
  local expected=$1 actual
  shift
  actual=$(bash "$policy" "$@")
  if [[ "$actual" != "browser=$expected" ]]; then
    printf 'Expected browser=%s for %s, got %s\n' "$expected" "$*" "$actual" >&2
    exit 1
  fi
  printf 'PASS: %s -> %s\n' "$*" "$actual"
}

commit() {
  git add -A
  git commit -qm "$1"
}

mkdir -p src docs .github/workflows
printf 'initial\n' > src/app.ts
commit initial
initial=$(git rev-parse HEAD)
expect true pull_request
expect true workflow_dispatch true
expect false workflow_dispatch false
expect false workflow_dispatch
expect true unknown
expect true push false 0000000000000000000000000000000000000000
expect true push false "$initial"
expect true push false invalid

printf 'readme\n' > README.md
printf 'guide\n' > docs/guide.md
printf 'image\n' > docs/image.webp
commit docs
docs=$(git rev-parse HEAD)
expect false pull_request
expect false push false "$initial"

printf 'changed\n' >> src/app.ts
commit code
code=$(git rev-parse HEAD)
expect true pull_request
expect true push false "$docs"
expect true push false "$initial"

printf 'more docs\n' >> README.md
commit more-docs
expect false pull_request
# A push may contain multiple commits; use the full before-to-HEAD range.
expect true push false "$docs"
expect false push false "$code"

printf 'workflow\n' > .github/workflows/ci.yml
commit workflow
expect true pull_request

# Renaming code to a documentation path is still a source deletion.
git mv src/app.ts docs/old-app.ts
commit rename
expect true pull_request

# A synthetic PR merge ignores unrelated changes already present on its base.
git checkout -qb docs-pr
printf 'feature\n' >> docs/guide.md
commit feature-docs
git checkout -q main
printf 'base code\n' > src/base.ts
commit base-code
git merge -q --no-ff docs-pr -m merge-docs
expect false pull_request
merge_base=$(git rev-parse HEAD^1)

# A shallow push checkout can fetch its exact previous revision when needed.
cd "$scratch"
git clone -q --depth=1 "file://$scratch" "$scratch/shallow"
cd "$scratch/shallow"
expect false push false "$merge_base"
expect true push false "$initial"
expect true push false "$(git rev-parse HEAD)"
expect true push false 1111111111111111111111111111111111111111
