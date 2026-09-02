#!/usr/bin/env bash
# Build the HUD and wire it into Claude Code's settings on this machine.
# Idempotent: re-running updates the path in place and leaves other settings alone.
# Windows equivalent: install.ps1
set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SETTINGS="${CLAUDE_SETTINGS:-$HOME/.claude/settings.json}"
ENTRY="$REPO_DIR/dist/index.js"

echo "==> Building $REPO_DIR"
cd "$REPO_DIR"
npm install --silent
npm run build --silent

[ -f "$ENTRY" ] || { echo "Build produced no $ENTRY" >&2; exit 1; }

echo "==> Verifying the HUD runs"
printf '%s' "{\"hook_event_name\":\"Status\",\"session_id\":\"install-check\",\"transcript_path\":\"/nonexistent.jsonl\",\"cwd\":\"$REPO_DIR\",\"model\":{\"id\":\"claude-opus-4-6\",\"display_name\":\"Opus 4.6\"},\"workspace\":{\"current_dir\":\"$REPO_DIR\",\"project_dir\":\"$REPO_DIR\"}}" \
  | node "$ENTRY" > /dev/null

echo "==> Wiring statusLine into $SETTINGS"
node "$REPO_DIR/scripts/apply-statusline.js" "$SETTINGS" "$ENTRY"

echo
echo "Done. Restart Claude Code to see the HUD."
echo "Tweak $REPO_DIR/.claude-hud.json to change theme, features, or thresholds."
