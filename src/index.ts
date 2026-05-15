#!/usr/bin/env node
import { readTranscript, latestUsage } from "./parsers/transcript.js";
import { themes } from "./themes/index.js";
import { fg, dim } from "./renderers/ansi.js";
import { renderContextBar, type ContextInput } from "./features/context.js";
import { renderGit } from "./features/git.js";
import { renderTodos } from "./features/todos.js";
import { renderTools } from "./features/tools.js";
import { renderCost } from "./features/cost.js";
import { renderEnv } from "./features/env.js";
import { loadConfig, type FeatureId } from "./config/index.js";
import type { StatusLineInput } from "./types.js";

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString("utf8");
}

async function main() {
  const raw = await readStdin();
  const input: StatusLineInput = JSON.parse(raw);
  const config = loadConfig(input.cwd);
  const theme = themes[config.theme] ?? themes.default;

  const entries = readTranscript(input.transcript_path);
  const usage = latestUsage(entries);
  const ctx: ContextInput = {
    inputTokens: usage?.input_tokens ?? 0,
    cacheReadTokens: usage?.cache_read_input_tokens ?? 0,
    cacheCreationTokens: usage?.cache_creation_input_tokens ?? 0,
    outputTokens: usage?.output_tokens ?? 0,
    modelId: input.model.id,
    exceeds200k: input.exceeds_200k_tokens ?? false,
  };

  const renderers: Record<FeatureId, () => string | null> = {
    model: () => fg(theme.accent, input.model.display_name),
    context: () => renderContextBar(ctx, theme, config.context),
    git: () => renderGit(input.cwd, theme),
    todos: () => renderTodos(entries, theme),
    tools: () => renderTools(entries, theme),
    cost: () => renderCost(input.cost?.total_cost_usd, theme, config.cost),
    env: () => renderEnv(input.cwd, theme),
  };

  const rendered = config.features
    .map(id => renderers[id]?.())
    .filter((s): s is string => Boolean(s));

  process.stdout.write(rendered.join(` ${dim("│")} `));
}

main().catch((err) => {
  process.stdout.write(`hud error: ${(err as Error).message}`);
  process.exit(0);
});
