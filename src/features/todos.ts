import { fg, dim } from "../renderers/ansi.js";
import type { Theme } from "../themes/index.js";
import type { TranscriptEntry } from "../types.js";

interface Todo {
  content: string;
  status: "pending" | "in_progress" | "completed";
  activeForm: string;
}

// TodoWrite rewrites the full list each call, so the most recent tool_use
// with name === "TodoWrite" is the source of truth.
export function latestTodos(entries: TranscriptEntry[]): Todo[] | null {
  for (let i = entries.length - 1; i >= 0; i--) {
    const content = entries[i].message?.content;
    if (!Array.isArray(content)) continue;
    for (const block of content) {
      if (block.type === "tool_use" && block.name === "TodoWrite") {
        const input = block.input as { todos?: Todo[] } | undefined;
        if (input?.todos) return input.todos;
      }
    }
  }
  return null;
}

export function renderTodos(entries: TranscriptEntry[], theme: Theme): string | null {
  const todos = latestTodos(entries);
  if (!todos || todos.length === 0) return null;

  const done = todos.filter(t => t.status === "completed").length;
  const active = todos.find(t => t.status === "in_progress");
  const total = todos.length;

  if (active) {
    return `${fg(theme.accent, "◐")} ${active.activeForm} ${dim(`(${done}/${total})`)}`;
  }
  const pending = total - done;
  return `${fg(theme.ok, `✓${done}`)} ${dim(`○${pending}`)}`;
}
