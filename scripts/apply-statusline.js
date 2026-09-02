#!/usr/bin/env node
// Point Claude Code's statusLine at this clone.
//
// Shared by install.sh and install.ps1 so the merge rules live in exactly one
// place. Doing this in node rather than in each shell also avoids PowerShell's
// ConvertTo-Json defaulting to -Depth 2, which would silently flatten nested
// settings (hooks, permissions, enabledPlugins) into "System.Object[]".
//
// Usage: node apply-statusline.js <settings.json> <absolute/path/to/dist/index.js>

const { readFileSync, writeFileSync, mkdirSync, existsSync, copyFileSync } = require("node:fs");
const { dirname } = require("node:path");

const [settingsPath, entryPath] = process.argv.slice(2);
if (!settingsPath || !entryPath) {
  console.error("usage: apply-statusline.js <settings.json> <entry.js>");
  process.exit(2);
}

// Forward slashes work on every platform node runs on, and sidestep having to
// escape backslashes inside JSON. Quote the path so a home directory with a
// space in it (common on Windows: C:/Users/First Last) still parses as one
// argument when Claude Code runs the command through a shell.
const normalized = entryPath.replace(/\\/g, "/");
const command = `node ${normalized.includes(" ") ? `"${normalized}"` : normalized}`;

mkdirSync(dirname(settingsPath), { recursive: true });

let settings = {};
if (existsSync(settingsPath)) {
  const raw = readFileSync(settingsPath, "utf8").trim();
  if (raw) {
    try {
      settings = JSON.parse(raw);
    } catch (e) {
      // Never clobber a file we cannot understand — it holds the user's
      // permissions, hooks and plugin state.
      console.error(`Refusing to overwrite ${settingsPath}: it is not valid JSON (${e.message})`);
      console.error("Fix or move the file, then re-run.");
      process.exit(1);
    }
  }
  const backup = `${settingsPath}.bak.${new Date().toISOString().replace(/[:.]/g, "").replace("T", "-").slice(0, 15)}`;
  copyFileSync(settingsPath, backup);
  console.log(`    backup: ${backup}`);
}

if (settings === null || typeof settings !== "object" || Array.isArray(settings)) {
  console.error(`Refusing to overwrite ${settingsPath}: expected a JSON object at the top level.`);
  process.exit(1);
}

const previous = settings.statusLine && settings.statusLine.command;
settings.statusLine = { type: "command", command };
writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + "\n");

if (previous && previous !== command) console.log(`    replaced: ${previous}`);
console.log(`    statusLine -> ${command}`);
