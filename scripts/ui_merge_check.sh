#!/usr/bin/env bash
# UI branch merge safety check (owned by feat/ui-demo).
#
# Proves this branch is mergeable alongside feat/runtime and feat/certification:
#   1. every changed file is UI-owned (docs/HANDOFF.md §1), or a declared shared exception
#   2. a trial merge with each sibling branch produces no conflicts
#   3. the shared offline baseline (npm test) still passes
#
# Usage: bash scripts/ui_merge_check.sh [base-ref]   (default: origin/main)
set -uo pipefail

BASE="${1:-origin/main}"
SIBLINGS=(origin/main origin/feat/runtime origin/feat/certification)
fail=0

echo "== fetching =="
git fetch origin --quiet || echo "  (fetch failed; using local refs)"

echo
echo "== 1. ownership of changed files (vs $BASE) =="
# bash 3.2 (macOS) has no mapfile, so collect the file list in a temp file.
listfile=$(mktemp)
trap 'rm -f "$listfile"' EXIT
{
  git diff --name-only "$(git merge-base HEAD "$BASE")" HEAD
  git status --porcelain | sed -n 's/^?? //p' | while read -r p; do
    if [ -d "$p" ]; then git ls-files -o --exclude-standard "$p"; else printf '%s\n' "$p"; fi
  done
} | sort -u > "$listfile"

# Shared files the UI scaffold PR is explicitly allowed to touch, once (HANDOFF §1).
shared_exceptions="package.json package-lock.json .gitignore"

# Files outside UI ownership that the repo owner directed the UI branch to change: the swarmem
# rename, which retires the "Freshman #N" student naming. Display strings only, no behaviour.
# Remove these once the rename has merged.
rename_exceptions="lib/swarm.ts scripts/swarm.ts tests/swarm.test.ts tests/tournament.test.ts tests/certification.test.ts \
demo/fixtures/events.json demo/fixtures/skill-observed.json demo/fixtures/skill-certified.json \
demo/fixtures/transfer-result.json demo/fixtures/transfer-result-failed.json \
demo/fixtures/certification-record.json demo/fixtures/certification-record-failed.json"

while IFS= read -r f; do
  [ -n "$f" ] || continue
  case "$f" in
    app/api/*)
      echo "  VIOLATION  $f  (app/api/** belongs to runtime/certification)"; fail=1 ;;
    app/*|components/*|public/*|next.config.*|tsconfig.json|next-env.d.ts|demo/fallback-artifacts/*|demo/ui/*|docs/UI.md|docs/DESIGN.md|scripts/ui_merge_check.sh)
      echo "  ui         $f" ;;
    *)
      matched=0
      for s in $shared_exceptions; do [ "$f" = "$s" ] && matched=1; done
      renamed=0
      for s in $rename_exceptions; do [ "$f" = "$s" ] && renamed=1; done
      if [ "$matched" = 1 ]; then
        echo "  shared*    $f  (scaffold PR exception: dependencies / ignore rules)"
      elif [ "$renamed" = 1 ]; then
        echo "  rename*    $f  (owner-directed swarmem rename; display strings only)"
      else
        echo "  VIOLATION  $f  (not UI-owned; ask its owner before changing it)"; fail=1
      fi ;;
  esac
done < "$listfile"

echo
echo "== 2. trial merges =="
for ref in "${SIBLINGS[@]}"; do
  if ! git rev-parse --verify --quiet "$ref" >/dev/null; then
    echo "  skip       $ref (no such ref)"; continue
  fi
  short=$(git rev-parse --short "$ref")
  if out=$(git merge-tree --write-tree HEAD "$ref" 2>&1); then
    echo "  clean      $ref @ $short"
    continue
  fi
  conflicted=$(printf '%s\n' "$out" | sed -n 's/^CONFLICT ([^)]*): [Mm]erge conflict in \(.*\)$/\1/p' | sort -u)
  unexpected=""
  for c in $conflicted; do
    known=0
    for s in $shared_exceptions; do [ "$c" = "$s" ] && known=1; done
    [ "$known" = 0 ] && unexpected="$unexpected $c"
  done
  if [ -n "$unexpected" ]; then
    echo "  CONFLICT   $ref @ $short"
    for c in $unexpected; do echo "             $c  (unexpected: coordinate with its owner)"; done
    fail=1
  else
    echo "  WARN       $ref @ $short: conflicts only in shared files:"
    for c in $conflicted; do echo "             $c"; done
    echo "             expected while the scaffold PR is open. Resolution is recorded in docs/UI.md"
    echo "             (\"Merge safety\"): keep both sides' scripts, keep the UI deps."
  fi
done

echo
echo "== 3. shared baseline (npm test) =="
if npm test >/tmp/ui-merge-check-npm-test.log 2>&1; then
  echo "  pass"
else
  echo "  FAIL (see /tmp/ui-merge-check-npm-test.log)"; tail -20 /tmp/ui-merge-check-npm-test.log; fail=1
fi

echo
if [ "$fail" = 0 ]; then
  echo "OK: branch is UI-scoped and merges cleanly with every sibling."
else
  echo "NOT MERGE-SAFE: fix the items above before opening the PR."
fi
exit "$fail"
