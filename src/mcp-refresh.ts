// Background refresher for the claude.ai remote-MCP count.
//
// Runs as its own detached process (see env.ts): the statusline cannot afford
// to shell out to `claude mcp list` on every ~300ms tick, so this writes a
// cache file that the tick reads. Kept as a real compiled module rather than a
// generated `node -e` string so the parsing is type-checked and unit-testable,
// and so there is no shell-quoting to get wrong across platforms.
import { exec } from "node:child_process";
import { writeFileSync, unlinkSync } from "node:fs";

const TIMEOUT_MS = 8000;

// `claude mcp list` prints every server — user, plugin and remote. Only the
// claude.ai-prefixed ones are counted here; user and plugin MCPs are counted
// from disk in env.ts, so including them would double-count.
//
// Match on the line's *structure*, not its status icon. A previous version
// looked for "✓" (U+2713) while Claude Code actually prints "✔" (U+2714), so
// every connected server was silently dropped and only the "! Needs
// authentication" ones were counted. Any status counts as a configured server.
const REMOTE_MCP_LINE = /^claude\.ai .+: .+ - \S/;

export function countRemoteMcpLines(stdout: string): number {
  return String(stdout || "")
    .split(/\r?\n/)
    .filter(line => REMOTE_MCP_LINE.test(line))
    .length;
}

function main(cachePath: string, lockPath: string): void {
  // Default shell resolves `claude.cmd` on Windows and `claude` on POSIX.
  exec("claude mcp list", { timeout: TIMEOUT_MS, windowsHide: true }, (_err, stdout) => {
    try {
      const count = countRemoteMcpLines(stdout);
      writeFileSync(cachePath, JSON.stringify({ count, stamp: Date.now() }));
    } catch {
      // A failed refresh just leaves the stale count in place.
    }
    try { unlinkSync(lockPath); } catch {}
  });
}

if (require.main === module) {
  const [cachePath, lockPath] = process.argv.slice(2);
  if (cachePath && lockPath) main(cachePath, lockPath);
}
