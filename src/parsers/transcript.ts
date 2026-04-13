import { readFileSync, statSync } from "node:fs";
import type { TranscriptEntry } from "../types.js";

// Cache parsed entries keyed by transcript path. Invalidate when mtime/size
// changes. The statusline reruns every ~300ms, so re-parsing a multi-MB
// transcript every tick would be wasteful.
interface CacheSlot {
  mtimeMs: number;
  size: number;
  entries: TranscriptEntry[];
}
const cache = new Map<string, CacheSlot>();

export function readTranscript(path: string): TranscriptEntry[] {
  let stat;
  try {
    stat = statSync(path);
  } catch {
    return [];
  }
  const hit = cache.get(path);
  if (hit && hit.mtimeMs === stat.mtimeMs && hit.size === stat.size) {
    return hit.entries;
  }
  const raw = readFileSync(path, "utf8");
  const entries: TranscriptEntry[] = [];
  for (const line of raw.split("\n")) {
    if (!line) continue;
    try {
      entries.push(JSON.parse(line));
    } catch {
      // ignore malformed line
    }
  }
  cache.set(path, { mtimeMs: stat.mtimeMs, size: stat.size, entries });
  return entries;
}

// Derive the "latest usage" — Claude reports running totals on each assistant
// message, so the last assistant message's usage is the session total.
export function latestUsage(entries: TranscriptEntry[]) {
  for (let i = entries.length - 1; i >= 0; i--) {
    const u = entries[i].message?.usage;
    if (u) return u;
  }
  return undefined;
}
