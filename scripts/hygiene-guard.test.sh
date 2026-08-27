#!/usr/bin/env bash
# Exercises hygiene-guard.sh on fixtures: a clean tree is green, each class of
# forbidden file (instruction doc, .env, updater key, embedded private key) turns
# it red regardless of case, and it fails closed outside a git repo.
# See tech-gui.md §0.0.
set -e -o pipefail

guard="$(cd "$(dirname "$0")" && pwd)/hygiene-guard.sh"
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
repo="$work/repo"

setup_repo() {
  rm -rf "$repo"
  mkdir -p "$repo"
  git -C "$repo" init -q
  git -C "$repo" config user.email t@example.com
  git -C "$repo" config user.name t
  : >"$repo/README.md"
  git -C "$repo" add README.md
}

run_guard() { (cd "$repo" && bash "$guard" >/dev/null 2>&1); }

expect_pass() {
  if run_guard; then echo "ok: $1"; else echo "FAIL: $1 should pass"; exit 1; fi
}

expect_fail() {
  if run_guard; then echo "FAIL: $1 should fail"; exit 1; else echo "ok: $1 rejected"; fi
}

setup_repo
expect_pass "clean tree"

: >"$repo/CLAUDE.md" && git -C "$repo" add -f CLAUDE.md && expect_fail "tracked CLAUDE.md"

setup_repo
mkdir -p "$repo/sub"
: >"$repo/sub/tech-gui.md" && git -C "$repo" add -f sub/tech-gui.md && expect_fail "nested tech-gui.md"

setup_repo
: >"$repo/Claude.md" && git -C "$repo" add -f Claude.md && expect_fail "case-variant Claude.md"

setup_repo
printf 'SECRET=1\n' >"$repo/.env" && git -C "$repo" add -f .env && expect_fail "tracked .env"

setup_repo
printf 'X=1\n' >"$repo/.ENV" && git -C "$repo" add -f .ENV && expect_fail "case-variant .ENV"

setup_repo
: >"$repo/omnyssh.tauri.key" && git -C "$repo" add -f omnyssh.tauri.key && expect_fail "tracked *.tauri.key"

setup_repo
printf -- '-----BEGIN OPENSSH PRIVATE KEY-----\nx\n-----END OPENSSH PRIVATE KEY-----\n' >"$repo/id_ed25519"
git -C "$repo" add -f id_ed25519 && expect_fail "embedded SSH private key"

setup_repo
printf -- '-----BEGIN PGP PRIVATE KEY BLOCK-----\nx\n-----END PGP PRIVATE KEY BLOCK-----\n' >"$repo/secret.asc"
git -C "$repo" add -f secret.asc && expect_fail "embedded PGP private key"

# Fails closed when run outside a git repo (never green by scanning nothing).
nonrepo="$work/nonrepo"
mkdir -p "$nonrepo"
if (cd "$nonrepo" && bash "$guard" >/dev/null 2>&1); then
  echo "FAIL: guard should fail outside a git repo"
  exit 1
else
  echo "ok: fails closed outside a git repo"
fi

echo "All hygiene guard cases passed."
