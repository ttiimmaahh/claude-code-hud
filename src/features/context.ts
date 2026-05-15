import { fg, dim } from "../renderers/ansi.js";
import type { Theme } from "../themes/index.js";

const DEFAULT_WINDOW = 200_000;

export interface ContextInput {
  inputTokens: number;        // non-cached input on latest turn
  cacheReadTokens: number;
  cacheCreationTokens: number;
  outputTokens: number;
  modelId: string;            // e.g. "claude-opus-4-7" or "claude-opus-4-7[1m]"
  exceeds200k: boolean;       // fallback signal from the statusline payload
}

export function usedTokens(c: ContextInput): number {
  // Cache reads + cache creation + fresh input all occupy context. Output
  // tokens from the current turn are already reflected in the next turn's
  // input, so we don't double-count — but the most recent turn's output
  // *is* in context until compaction, so we add it.
  return c.inputTokens + c.cacheReadTokens + c.cacheCreationTokens + c.outputTokens;
}

// Base context window per latest Claude family. The 1M beta variant is
// handled separately via the "[1m]" suffix in the model id.
const MODEL_FAMILY_WINDOWS: Record<"opus" | "sonnet" | "haiku", number> = {
  opus: 200_000,
  sonnet: 200_000,
  haiku: 200_000,
};

function extractFamily(modelId: string): "opus" | "sonnet" | "haiku" | null {
  if (modelId.includes("opus")) return "opus";
  if (modelId.includes("sonnet")) return "sonnet";
  if (modelId.includes("haiku")) return "haiku";
  return null;
}

export function resolveContextWindow(modelId: string, exceeds200k: boolean): number {
  // 1. Explicit beta suffix in the model id (e.g. "[1m]" → 1_000_000).
  const betaMatch = modelId.match(/\[(\d+)m\]/i);
  if (betaMatch) return Number(betaMatch[1]) * 1_000_000;

  // 2. Payload flag — Claude Code may set this when the 1M beta is active
  //    without the suffix being present.
  if (exceeds200k) return 1_000_000;

  // 3. Known family default.
  const family = extractFamily(modelId);
  if (family && MODEL_FAMILY_WINDOWS[family] > 0) return MODEL_FAMILY_WINDOWS[family];

  return DEFAULT_WINDOW;
}

export function contextWindow(c: ContextInput): number {
  return resolveContextWindow(c.modelId, c.exceeds200k);
}

export interface ContextOpts { warnAt: number; dangerAt: number; segments: number }

function formatWindow(n: number): string {
  if (n >= 1_000_000) return `${n / 1_000_000}M`;
  if (n >= 1_000) return `${Math.round(n / 1_000)}k`;
  return String(n);
}

export function renderContextBar(c: ContextInput, theme: Theme, opts: ContextOpts): string {
  const window = contextWindow(c);
  const ratio = Math.min(1, usedTokens(c) / window);
  const color = ratio >= opts.dangerAt ? theme.danger : ratio >= opts.warnAt ? theme.warn : theme.ok;
  const filled = Math.round(ratio * opts.segments);
  const bar = "█".repeat(filled) + "░".repeat(opts.segments - filled);
  const pct = `${Math.round(ratio * 100)}%`;
  return `${fg(color, `${bar} ${pct}`)} ${dim(`(${formatWindow(window)})`)}`;
}
