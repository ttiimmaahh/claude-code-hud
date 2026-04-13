import { execFileSync } from "node:child_process";
import { fg, dim } from "../renderers/ansi.js";
import type { Theme } from "../themes/index.js";

export interface GitStatus {
  branch: string;
  ahead: number;
  behind: number;
  dirty: number;   // count of changed files (staged + unstaged + untracked)
}

// Cache by cwd + HEAD mtime to avoid forking git on every 300ms tick.
const cache = new Map<string, { stamp: string; status: GitStatus | null }>();

function sh(cwd: string, args: string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
}

export function readGitStatus(cwd: string): GitStatus | null {
  try {
    // `git status --porcelain=v2 --branch` gives us everything in one fork.
    const out = sh(cwd, ["status", "--porcelain=v2", "--branch"]);
    let branch = "HEAD";
    let ahead = 0, behind = 0, dirty = 0;
    for (const line of out.split("\n")) {
      if (line.startsWith("# branch.head")) branch = line.split(" ")[2] ?? "HEAD";
      else if (line.startsWith("# branch.ab")) {
        const m = line.match(/\+(\d+) -(\d+)/);
        if (m) { ahead = +m[1]; behind = +m[2]; }
      } else if (line && !line.startsWith("#")) dirty++;
    }
    return { branch, ahead, behind, dirty };
  } catch {
    return null; // not a git repo, or git not installed
  }
}

export function renderGit(cwd: string, theme: Theme): string | null {
  const key = cwd;
  // 2s freshness window — git state rarely changes faster than that.
  const now = Date.now();
  const hit = cache.get(key);
  if (hit && now - Number(hit.stamp) < 2000) return hit.status ? format(hit.status, theme) : null;
  const status = readGitStatus(cwd);
  cache.set(key, { stamp: String(now), status });
  return status ? format(status, theme) : null;
}

function format(s: GitStatus, theme: Theme): string {
  const branchColor = s.dirty > 0 ? theme.gitDirty : theme.accent;
  const parts = [fg(branchColor, ` ${s.branch}`)];
  if (s.ahead) parts.push(dim(`↑${s.ahead}`));
  if (s.behind) parts.push(dim(`↓${s.behind}`));
  if (s.dirty) parts.push(fg(theme.gitDirty, `●${s.dirty}`));
  return parts.join(" ");
}
