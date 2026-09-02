#!/usr/bin/env bash
# Build the HUD and wire it into ~/.claude/settings.json on this machine.
# Idempotent: re-running updates the path in place and leaves other settings alone.
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

mkdir -p "$(dirname "$SETTINGS")"
[ -f "$SETTINGS" ] || echo '{}' > "$SETTINGS"

# Back up before touching a file we did not write.
BACKUP="$SETTINGS.bak.$(date +%Y%m%d%H%M%S)"
cp "$SETTINGS" "$BACKUP"

echo "==> Wiring statusLine into $SETTINGS (backup: $BACKUP)"
SETTINGS="$SETTINGS" ENTRY="$ENTRY" node -e '
  const fs = require("node:fs");
  const file = process.env.SETTINGS;
  let settings;
  try {
    settings = JSON.parse(fs.readFileSync(file, "utf8") || "{}");
  } catch (e) {
    console.error(`Refusing to overwrite ${file}: it is not valid JSON (${e.message})`);
    process.exit(1);
  }
  const previous = settings.statusLine?.command;
  settings.statusLine = { type: "command", command: `node ${process.env.ENTRY}` };
  fs.writeFileSync(file, JSON.stringify(settings, null, 2) + "\n");
  if (previous && previous !== settings.statusLine.command) {
    console.log(`    replaced previous statusLine: ${previous}`);
  }
  console.log(`    statusLine -> ${settings.statusLine.command}`);
'

echo
echo "Done. Restart Claude Code (or run /statusline) to see the HUD."
echo "Tweak $REPO_DIR/.claude-hud.json to change theme, features, or thresholds."
