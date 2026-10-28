#!/bin/sh
# GitHub administration only: intentionally runs on the host, without Docker.
set -eu
umask 077

dry_run=false
case "${1:-}" in
  --dry-run) dry_run=true; shift ;;
  --help|-h)
    printf 'Usage: ./scripts/release.sh [--dry-run]\nCreates a dated GitHub release from checked main. Requires gh, jq, git and a signed-in GitHub account.\n'
    exit 0 ;;
esac
if [ "$#" -ne 0 ]; then
  printf 'Unknown argument. Use --help.\n' >&2
  exit 1
fi
command -v gh >/dev/null 2>&1 || { printf 'Install GitHub CLI (gh) and run gh auth login first.\n' >&2; exit 1; }
# Require the native aggregation used below, rather than silently weakening checks.
if ! gh api --help | grep -q -- '--slurp'; then
  printf 'Update GitHub CLI (gh): this script requires gh api --slurp support.\n' >&2
  exit 1
fi
command -v jq >/dev/null 2>&1 || { printf 'Install jq before creating a release.\n' >&2; exit 1; }
repo=$(gh repo view --json nameWithOwner --jq .nameWithOwner)
revision=$(gh api "repos/$repo/branches/main" --jq .commit.sha)
case "$revision" in ''|*[!0-9a-f]*) printf 'Cannot resolve main commit.\n' >&2; exit 1 ;; esac
[ "${#revision}" -eq 40 ] || exit 1

# Match the publication workflow: check the exact main commit, never only its PR.
checked=$(gh api --method GET "repos/$repo/actions/workflows/checks.yml/runs" \
  -f branch=main -f event=push -f head_sha="$revision" -f per_page=100 \
  --jq '[.workflow_runs[]] | sort_by(.id) | last | if .status == "completed" and .conclusion == "success" then .head_sha else empty end')
if [ "$checked" != "$revision" ]; then
  printf 'Main has not passed CI yet. Wait for successful checks, then repeat this command.\n' >&2
  exit 1
fi
runtime=$(mktemp -d)
trap 'rm -rf "$runtime"' EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
# Aggregate all pages before choosing the newest trusted run for each check.
# A failed page makes gh fail, so incomplete results can never approve a release.
gh api --paginate --slurp "repos/$repo/commits/$revision/check-runs?per_page=100" > "$runtime/checks.json"
analyses=$(jq -r '[.[].check_runs[] | select(.app.slug == "github-actions") | select(.name == "Analyze (actions)" or .name == "Analyze (javascript-typescript)")]
    | group_by(.name)
    | map(max_by(.id))
    | map(select(.status == "completed" and .conclusion == "success"))
    | length' "$runtime/checks.json")
if [ "$analyses" != 2 ]; then
  printf 'Both CodeQL analyses for main must pass before releasing. Repeat after they finish.\n' >&2
  exit 1
fi

day=$(TZ=Europe/Moscow date +%Y.%m.%d)
prefix="v$day"
attempt=0
while [ "$attempt" -lt 5 ]; do
  attempt=$((attempt + 1))
  # Both endpoints are paginated; include standalone tags and draft releases.
  gh api --paginate "repos/$repo/tags?per_page=100" --jq '.[].name' > "$runtime/names"
  gh api --paginate "repos/$repo/releases?per_page=100" --jq '.[].tag_name' >> "$runtime/names"
  tag=$(awk -v prefix="$prefix" '
    $0 == prefix { used=1 }
    index($0, prefix "-patch") == 1 {
      patch=substr($0,length(prefix)+7)
      if (patch ~ /^[1-9][0-9]*$/) {
        if (length(patch)>9) { invalid=1; next }
        used=1; if (patch+0>maximum) maximum=patch+0
      }
    }
    END {
      if (invalid) exit 1
      if (used) printf "%s-patch%.0f\n",prefix,maximum+1
      else print prefix
    }' "$runtime/names") || { printf 'Patch number is too large; refusing to choose a conflicting tag.\n' >&2; exit 1; }
  printf 'Repository: %s\nMain commit: %s\nRelease: %s\n' "$repo" "$revision" "$tag"
  if [ "$dry_run" = true ]; then
    printf 'Dry run: no tag or release created.\n'
    exit 0
  fi
  # Reserve the name atomically and pin it to the checked commit. gh release
  # create alone could reuse a concurrently created tag pointing elsewhere.
  if gh api --method POST "repos/$repo/git/refs" -f "ref=refs/tags/$tag" -f "sha=$revision" > /dev/null 2> "$runtime/error"; then
    if gh release create "$tag" --repo "$repo" --verify-tag --target "$revision" --title "$tag" --generate-notes; then
      printf 'Release published. GitHub Actions will now build its image.\n'
      exit 0
    fi
    printf 'Release publication failed after reserving tag %s. The tag was kept. Check GitHub before retrying; this command does not delete tags or releases.\n' "$tag" >&2
    exit 1
  fi
  # Only retry an explicitly occupied name. A permission/network failure must
  # not be mistaken for a successful reservation or a reason to skip versions.
  if grep -Eq 'HTTP 422|HTTP 409' "$runtime/error" && gh api "repos/$repo/git/ref/tags/$tag" > /dev/null 2>&1; then
    printf 'Tag %s was occupied concurrently; checking the next patch.\n' "$tag" >&2
  else
    cat "$runtime/error" >&2
    exit 1
  fi
done
printf 'Could not reserve a release tag after five concurrent conflicts. Try again later.\n' >&2
exit 1
