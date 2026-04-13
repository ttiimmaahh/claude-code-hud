# claude-code-hud

A customizable statusline HUD for [Claude Code](https://docs.claude.com/en/docs/claude-code). Displays context usage, git state, active todos, in-flight tools/subagents, and session cost — all in the terminal's status line, no separate window.

Inspired by [jarrodwatts/claude-hud](https://github.com/jarrodwatts/claude-hud), rewritten with a config-driven pipeline, per-project overrides, and swappable themes.

```
Opus 4.6 │ ██░░░░░░░░ 25% │  main ●6 │ ◐ Running tests (1/3) │ ⚙ Bash npm test 🤖 Task Explore: Find auth │ $7.42
```

## Features

| Feature   | What it shows                                                                 |
| --------- | ----------------------------------------------------------------------------- |
| `model`   | Current model's display name                                                  |
| `context` | Token usage bar (green → yellow → red) with configurable thresholds           |
| `git`     | Branch, ahead/behind upstream, dirty file count                               |
| `todos`   | Active TodoWrite task + completion counter, or summary when nothing active    |
| `tools`   | In-flight slow tools (Bash, WebFetch, WebSearch, Task/subagents)              |
| `cost`    | Session cost in USD, tinted past warn/danger thresholds                       |
| `env`     | Environment counts: ⚡MCP servers, 🪝hooks, 📋CLAUDE.md rules, 🤖agents       |

All seven features are on by default. Each feature returns nothing when it has no data (e.g. `git` hides outside a repo, `todos` hides when no TodoWrite has run).

## Install

```bash
npm install
npm run build
```

Then point Claude Code at `dist/index.js` in `~/.claude/settings.json`:

```json
{
  "statusLine": {
    "type": "command",
    "command": "node /absolute/path/to/claude-code-hud/dist/index.js"
  }
}
```

Restart Claude Code. The statusline appears at the bottom of the terminal.

### Requirements

- Node.js 18+ (uses ES2022, native `node:test` for test runner)
- A terminal that supports ANSI truecolor (most modern terminals do)
- `git` on PATH (optional — the `git` feature no-ops without it)

## Configuration

Configuration is layered: **project-local → global → defaults**. First file found wins per key, with `context` and `cost` objects merged key-by-key.

### Lookup order

1. `.claude-hud.json` in the project root or any parent directory up to (but not past) `~`
2. `~/.config/claude-hud/config.json`
3. Built-in defaults

### Example `.claude-hud.json`

```json
{
  "theme": "nord",
  "features": ["context", "git", "todos", "cost"],
  "context": { "warnAt": 0.5, "dangerAt": 0.75, "segments": 15 },
  "cost":    { "warnAt": 1,   "dangerAt": 10 }
}
```

### All options

| Key                  | Type               | Default                       | Notes                                                               |
| -------------------- | ------------------ | ----------------------------- | ------------------------------------------------------------------- |
| `theme`              | `string`           | `"default"`                   | One of `default`, `nord`, `dracula` (add more in `src/themes/`)     |
| `features`           | `FeatureId[]`      | all seven, in listed order    | Omit a feature to hide it; reorder to rearrange the statusline      |
| `context.warnAt`     | `number` (0–1)     | `0.6`                         | Ratio of context used before bar turns yellow                       |
| `context.dangerAt`   | `number` (0–1)     | `0.8`                         | Ratio before bar turns red (Claude auto-compacts around 0.85–0.92)  |
| `context.segments`   | `integer`          | `10`                          | Width of the bar in characters                                      |
| `cost.warnAt`        | `number` (USD)     | `5`                           | Cost threshold for yellow tint                                      |
| `cost.dangerAt`      | `number` (USD)     | `20`                          | Cost threshold for red tint                                         |

### Themes

Built-in: `default`, `nord`, `dracula`. Add your own by appending to `src/themes/index.ts` — each theme is a flat object with hex colors for `fg`, `dim`, `accent`, `ok`, `warn`, `danger`, `gitDirty`.

## How it works

Claude Code fires your statusline command every ~300ms, piping a JSON payload to stdin. The HUD:

1. Reads stdin, parses the payload (`transcript_path`, `cwd`, `model`, `cost`, …).
2. Loads per-project config via walk-up lookup.
3. mtime-caches the transcript JSONL so re-parsing a multi-MB session is cheap.
4. Runs each enabled feature's renderer, joining non-null results with `│` separators.
5. Writes the result to stdout.

No API calls, no daemons, no auth. Everything is derived from the statusline payload and the transcript Claude Code already writes locally.

## Development

```bash
npm run dev    # tsc --watch
npm run build  # one-shot compile to dist/
npm test       # node --test
```

**Smoke-test a render without launching Claude Code:**

```bash
echo '{"hook_event_name":"Status","session_id":"x","transcript_path":"/tmp/nope.jsonl","cwd":"'$PWD'","model":{"id":"claude-opus-4-6","display_name":"Opus 4.6"},"workspace":{"current_dir":"'$PWD'","project_dir":"'$PWD'"}}' \
  | node dist/index.js; echo
```

See `CLAUDE.md` for architecture details and the extension playbook.

## Project structure

```
src/
  index.ts               entrypoint — stdin → config → feature pipeline → stdout
  types.ts               StatusLineInput + TranscriptEntry shapes
  config/index.ts        walk-up JSON loader, defaults, merge semantics
  parsers/transcript.ts  mtime-cached JSONL reader + latestUsage()
  renderers/ansi.ts      truecolor helpers (no chalk dep)
  themes/index.ts        color palettes
  features/
    context.ts           token bar
    git.ts               branch + ahead/behind + dirty
    todos.ts             TodoWrite extraction + rendering
    tools.ts             in-flight slow-tool detection
    cost.ts              $ usage with thresholds
    env.ts               MCP / hooks / rules / agents counts
```

## License

MIT — do whatever you want.
