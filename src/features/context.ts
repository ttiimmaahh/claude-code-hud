import { fg } from "../renderers/ansi.js";
import type { Theme } from "../themes/index.js";

// Claude's effective context window. 200k for most models; the statusline
// payload tells us when the session exceeds that (extended context).
const DEFAULT_WINDOW = 200_000;

export interface ContextInput {
  inputTokens: number;        // non-cached input on latest turn
  cacheReadTokens: number;
  cacheCreationTokens: number;
  outputTokens: number;
  exceeds200k: boolean;
}

export function usedTokens(c: ContextInput): number {
  // Cache reads + cache creation + fresh input all occupy context. Output
  // tokens from the current turn are already reflected in the next turn's
  // input, so we don't double-count — but the most recent turn's output
  // *is* in context until compaction, so we add it.
  return c.inputTokens + c.cacheReadTokens + c.cacheCreationTokens + c.outputTokens;
}

export function contextWindow(c: ContextInput): number {
  return c.exceeds200k ? 1_000_000 : DEFAULT_WINDOW;
}

export interface ContextOpts { warnAt: number; dangerAt: number; segments: number }

export function renderContextBar(c: ContextInput, theme: Theme, opts: ContextOpts): string {
  const ratio = Math.min(1, usedTokens(c) / contextWindow(c));
  const color = ratio >= opts.dangerAt ? theme.danger : ratio >= opts.warnAt ? theme.warn : theme.ok;
  const filled = Math.round(ratio * opts.segments);
  const bar = "█".repeat(filled) + "░".repeat(opts.segments - filled);
  const pct = `${Math.round(ratio * 100)}%`;
  return fg(color, `${bar} ${pct}`);
}
