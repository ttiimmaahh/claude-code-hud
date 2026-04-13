import { fg, dim } from "../renderers/ansi.js";
import type { Theme } from "../themes/index.js";
import type { TranscriptEntry } from "../types.js";

// Slow / blocking tools — the ones where "what's running?" is interesting.
const SLOW_TOOLS = new Set(["Bash", "WebFetch", "WebSearch", "Task"]);

interface ActiveTool {
  name: string;
  label: string; // human-friendly summary of what it's doing
}

// A tool_use is "active" if its id has no matching tool_result yet.
// Walk the whole transcript (cheap — already cached), pair them up.
export function activeTools(entries: TranscriptEntry[]): ActiveTool[] {
  const pending = new Map<string, ActiveTool>();
  for (const entry of entries) {
    const content = entry.message?.content;
    if (!Array.isArray(content)) continue;
    for (const block of content) {
      if (block.type === "tool_use" && SLOW_TOOLS.has(block.name)) {
        pending.set(block.id, { name: block.name, label: summarize(block.name, block.input) });
      } else if (block.type === "tool_result") {
        pending.delete(block.tool_use_id);
      }
    }
  }
  return [...pending.values()];
}

function summarize(name: string, input: unknown): string {
  const i = input as Record<string, unknown> | undefined;
  if (!i) return name;
  if (name === "Bash") return truncate(String(i.command ?? ""), 40);
  if (name === "WebFetch") {
    try { return new URL(String(i.url)).hostname; } catch { return "fetch"; }
  }
  if (name === "WebSearch") return truncate(String(i.query ?? ""), 30);
  if (name === "Task") {
    const agent = String(i.subagent_type ?? "agent");
    const desc = String(i.description ?? "");
    return desc ? `${agent}: ${truncate(desc, 30)}` : agent;
  }
  return name;
}

function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n - 1) + "…" : s;
}

export function renderTools(entries: TranscriptEntry[], theme: Theme): string | null {
  const active = activeTools(entries);
  if (active.length === 0) return null;
  // Show up to 2 to keep the statusline compact; append " +N" overflow marker.
  const shown = active.slice(0, 2).map(t => {
    const icon = t.name === "Task" ? "🤖" : "⚙";
    return `${icon} ${fg(theme.accent, t.name)} ${dim(t.label)}`;
  });
  const extra = active.length - shown.length;
  return shown.join(" ") + (extra > 0 ? dim(` +${extra}`) : "");
}
