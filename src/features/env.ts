import { readFileSync, readdirSync, existsSync, writeFileSync } from "node:fs";
import { dirname, join, parse } from "node:path";
import { homedir, tmpdir } from "node:os";
import { spawn } from "node:child_process";
import { fg, dim } from "../renderers/ansi.js";
import type { Theme } from "../themes/index.js";

export interface EnvCounts {
  mcp: number;
  hooks: number;
  rules: number;
  agents: number;
}

const HOME = homedir();
const MCP_CACHE_PATH = join(tmpdir(), "claude-code-hud-mcp-cache.json");
const MCP_CACHE_TTL_MS = 60_000;        // how long a remote count stays fresh
const MCP_REFRESH_TIMEOUT_MS = 8000;    // kill the background refresh if it hangs

function readJsonSafe(path: string): any | null {
  try { return JSON.parse(readFileSync(path, "utf8")); } catch { return null; }
}

// --- User MCPs: ~/.claude.json + project overrides --------------------------
function userMcpNames(cwd: string): Set<string> {
  const names = new Set<string>();
  const add = (o: unknown) => { if (o && typeof o === "object") for (const k of Object.keys(o)) names.add(k); };
  const userJson = readJsonSafe(join(HOME, ".claude.json"));
  if (userJson) {
    add(userJson.mcpServers);
    add(userJson.projects?.[cwd]?.mcpServers);
  }
  add(readJsonSafe(join(HOME, ".claude", "settings.json"))?.mcpServers);
  add(readJsonSafe(join(cwd, ".mcp.json"))?.mcpServers);
  add(readJsonSafe(join(cwd, ".claude", "settings.json"))?.mcpServers);
  return names;
}

// --- Plugin MCPs: each enabled plugin's .mcp.json ---------------------------
// Claude Code exposes these as "plugin:<plugin>:<server>". We match by
// reading `enabledPlugins` → resolving install paths from
// `~/.claude/plugins/installed_plugins.json` → reading `.mcp.json` in each.
function pluginMcpCount(): number {
  const settings = readJsonSafe(join(HOME, ".claude", "settings.json"));
  const enabled = settings?.enabledPlugins ?? {};
  const installed = readJsonSafe(join(HOME, ".claude", "plugins", "installed_plugins.json"))?.plugins ?? {};
  let count = 0;
  for (const [pluginKey, isEnabled] of Object.entries<boolean>(enabled)) {
    if (!isEnabled) continue;
    const entries = installed[pluginKey];
    if (!Array.isArray(entries) || !entries.length) continue;
    const installPath = entries[0]?.installPath;
    if (!installPath) continue;
    const mcp = readJsonSafe(join(installPath, ".mcp.json"));
    if (mcp?.mcpServers && typeof mcp.mcpServers === "object") {
      count += Object.keys(mcp.mcpServers).length;
    } else if (mcp && typeof mcp === "object" && !mcp.mcpServers) {
      // Some plugins put servers at the top level (e.g. context7's {.mcp.json}).
      count += Object.keys(mcp).filter(k => typeof mcp[k] === "object").length;
    }
  }
  return count;
}

// --- Remote MCPs (claude.ai): cached shell-out to `claude mcp list` ---------
// The statusline cannot afford to shell out on every tick, so we write a
// cache file in $TMPDIR with a TTL. When stale, we fork a detached refresher
// that updates the cache; the current tick returns the stale (or zero) value.
function readRemoteMcpCount(): number {
  const cache = readJsonSafe(MCP_CACHE_PATH) as { count: number; stamp: number } | null;
  const fresh = cache && Date.now() - cache.stamp < MCP_CACHE_TTL_MS;
  if (!fresh) kickRemoteMcpRefresh();
  return cache?.count ?? 0;
}

function kickRemoteMcpRefresh(): void {
  // A lock-ish check: if a refresh started very recently, skip. We use the
  // cache file's mtime-with-future-stamp as a crude mutex by writing a
  // "refresh in progress" marker first.
  const lockPath = MCP_CACHE_PATH + ".lock";
  const lock = readJsonSafe(lockPath) as { stamp: number } | null;
  if (lock && Date.now() - lock.stamp < MCP_REFRESH_TIMEOUT_MS) return;
  try { writeFileSync(lockPath, JSON.stringify({ stamp: Date.now() })); } catch { return; }

  // Spawn detached. We only count claude.ai-prefixed servers — user/plugin
  // MCPs are already counted from disk, so including them here would double.
  const script = `
    claude mcp list 2>/dev/null | node -e '
      let s = "";
      process.stdin.on("data", c => s += c);
      process.stdin.on("end", () => {
        const count = s.split("\\n").filter(l => /^claude\\.ai .+: .+ - (✓|!)/.test(l)).length;
        require("fs").writeFileSync(${JSON.stringify(MCP_CACHE_PATH)}, JSON.stringify({count, stamp: Date.now()}));
        try { require("fs").unlinkSync(${JSON.stringify(lockPath)}); } catch {}
      });
    '
  `;
  const child = spawn("sh", ["-c", script], { detached: true, stdio: "ignore" });
  child.unref();
}

// --- Hooks / rules / agents (unchanged) -------------------------------------
function countHooksIn(settings: any): number {
  if (!settings?.hooks || typeof settings.hooks !== "object") return 0;
  let n = 0;
  for (const matchers of Object.values<any>(settings.hooks)) {
    if (!Array.isArray(matchers)) continue;
    for (const m of matchers) n += Array.isArray(m?.hooks) ? m.hooks.length : 0;
  }
  return n;
}
function countHooks(cwd: string): number {
  return (
    countHooksIn(readJsonSafe(join(HOME, ".claude", "settings.json"))) +
    countHooksIn(readJsonSafe(join(cwd, ".claude", "settings.json"))) +
    countHooksIn(readJsonSafe(join(cwd, ".claude", "settings.local.json")))
  );
}
function countRules(cwd: string): number {
  let n = 0;
  if (existsSync(join(HOME, ".claude", "CLAUDE.md"))) n++;
  const { root } = parse(cwd);
  let dir = cwd;
  while (dir !== root && dir !== dirname(HOME)) {
    if (existsSync(join(dir, "CLAUDE.md"))) n++;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return n;
}
function countMdIn(dir: string): number {
  try { return readdirSync(dir).filter(f => f.endsWith(".md")).length; } catch { return 0; }
}
function countAgents(cwd: string): number {
  return countMdIn(join(HOME, ".claude", "agents")) + countMdIn(join(cwd, ".claude", "agents"));
}

// --- Public API -------------------------------------------------------------
interface CacheSlot { stamp: number; counts: EnvCounts }
const memCache = new Map<string, CacheSlot>();

export function readEnvCounts(cwd: string): EnvCounts {
  const hit = memCache.get(cwd);
  const now = Date.now();
  if (hit && now - hit.stamp < 5000) return hit.counts;
  const counts: EnvCounts = {
    mcp: userMcpNames(cwd).size + pluginMcpCount() + readRemoteMcpCount(),
    hooks: countHooks(cwd),
    rules: countRules(cwd),
    agents: countAgents(cwd),
  };
  memCache.set(cwd, { stamp: now, counts });
  return counts;
}

export function renderEnv(cwd: string, theme: Theme): string | null {
  const c = readEnvCounts(cwd);
  const parts: string[] = [];
  if (c.mcp)    parts.push(`${fg(theme.accent, "⚡")}${c.mcp}`);
  if (c.hooks)  parts.push(`${fg(theme.accent, "🪝")}${c.hooks}`);
  if (c.rules)  parts.push(`${fg(theme.accent, "📋")}${c.rules}`);
  if (c.agents) parts.push(`${fg(theme.accent, "🤖")}${c.agents}`);
  return parts.length ? parts.join(dim(" ")) : null;
}
