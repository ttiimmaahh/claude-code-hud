#!/usr/bin/env bash
# Dependency-free scan for the leak classes this repo actually risks:
# machine-specific home paths, personal emails, and credential-shaped strings.
#
# Runs in CI on every push to main, and locally via `npm run check:leaks`.
# Scans git-tracked files only — ignored files never reach the remote.
# Kept POSIX-ish (no mapfile/associative arrays) so it works on macOS bash 3.2.
set -uo pipefail

cd "$(git rev-parse --show-toplevel)"

# This script necessarily contains every pattern it looks for, so exclude it
# from its own scan via a git pathspec rather than post-filtering.
SELF=':(exclude)scripts/check-leaks.sh'
FAIL=0

# scan <label> <pattern> [allowlist-regex]
scan() {
  label="$1"; pattern="$2"; allow="${3:-}"
  hits=$(git grep -nIE -e "$pattern" -- . "$SELF" 2>/dev/null || true)
  if [ -n "$allow" ] && [ -n "$hits" ]; then
    hits=$(printf '%s\n' "$hits" | grep -vE "$allow" || true)
  fi
  if [ -n "$hits" ]; then
    echo "::error::$label"
    printf '%s\n' "$hits" | sed 's/^/    /'
    echo
    FAIL=1
  else
    echo "  ok  $label"
  fi
}

echo "Scanning $(git ls-files | wc -l | tr -d ' ') tracked files"
echo

# Absolute home directories in committed files leak the author's username and
# make the repo unusable on another machine.
scan "Absolute home path" \
     '/(Users|home)/[A-Za-z0-9._-]+' \
     '/home/runner|/absolute/path'

scan "Email address" \
     '[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}' \
     'noreply@|example\.com'

scan "API key / token" \
     '(sk-[A-Za-z0-9]{16}|ghp_[A-Za-z0-9]{20}|gho_[A-Za-z0-9]{20}|github_pat_[A-Za-z0-9_]{20}|AKIA[0-9A-Z]{16}|xox[baprs]-[A-Za-z0-9-]{10})'

scan "Private key block" \
     'BEGIN [A-Z ]*PRIVATE KEY'

scan "Hardcoded secret assignment" \
     '(api[_-]?key|secret|password|passwd)["'\'']?[[:space:]]*[:=][[:space:]]*["'\''][^"'\'']{12,}'

# The HUD must never touch Claude Code credentials (see CLAUDE.md).
scan "Claude Code credential access" \
     '\.credentials\.json|oauthAccount|accessToken|refreshToken'

echo
if [ "$FAIL" -ne 0 ]; then
  echo "FAILED — remove the findings above before pushing."
  exit 1
fi
echo "PASSED — no leaks found."
