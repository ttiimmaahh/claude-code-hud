# CLAUDE.md

Guidance for Claude Code (and future me) working on this repo.

## What this is

A Node.js CLI that Claude Code invokes every ~300ms via its `statusLine` hook. stdin = a JSON payload describing the session; stdout = a single line of ANSI-colored text rendered at the bottom of the terminal.

Zero runtime dependencies by design. The only `dependencies` should ever be `typescript` + `@types/node` in `devDependencies`. Adding `chalk`, `zod`, etc. is a regression — they bloat cold-start on a script that reruns thousands of times per session.

## Architecture

### Invocation lifecycle (one tick)

1. Claude Code spawns `node dist/index.js` and writes the statusline payload to its stdin.
2. `src/index.ts` slurps stdin, `JSON.parse`s it → `StatusLineInput` (`src/types.ts`).
3. `loadConfig(input.cwd)` walks up from cwd looking for `.claude-hud.json`, falls back to `~/.config/claude-hud/config.json`, then built-in `defaults`.
4. `readTranscript(input.transcript_path)` reads the JSONL. Results cached by `(mtime, size)` in a module-level `Map` — the Node process exits after each tick, so the cache is effectively per-invocation, BUT the cache code still matters because Bun/long-lived runs could reuse it. Keep it correct.
5. Each feature id in `config.features` maps to a render function in `src/index.ts`'s `renderers` record. Features return `string | null`. Nulls drop out.
6. Survivors are joined with ` │ ` and written to stdout.

### The feature contract

Every feature module in `src/features/` exports:
- A `render<Name>(…) → string | null` function. Returns `null` when there's nothing useful to show (no git repo, no todos yet, cost is zero, etc.). **Never throw from a renderer.** The `main()` catch block writes `hud error: …` to stdout, which clutters the terminal.
- Optionally, helper functions for parsing (`latestTodos`, `activeTools`, …) — keep these pure and testable.
- Optionally, an `Opts` interface if the feature is configurable (`ContextOpts`, `CostOpts`). Thread it through config.

### Transcript parsing

`TranscriptEntry` in `src/types.ts` is intentionally a partial shape. Claude Code writes heterogeneous records (`user`, `assistant`, `system`, `summary`); we only type the fields we read. When adding a new feature that reads a new field, extend the type — don't cast.

Key facts about the transcript:
- `usage` on assistant messages reports **running totals**, not per-turn deltas. `latestUsage()` scans from the tail for this reason.
- `tool_use` / `tool_result` blocks are paired by `id` ↔ `tool_use_id`. An unpaired `tool_use` at the tail = in-flight. `activeTools()` in `src/features/tools.ts` implements this pairing.
- `TodoWrite` rewrites the full todo list each call. The latest `tool_use` with `name === "TodoWrite"` is the source of truth — no need to reconcile across entries.

## Extending

### Adding a new feature

1. Create `src/features/<name>.ts`. Export `render<Name>(…): string | null`.
2. Add `"<name>"` to the `FeatureId` union in `src/config/index.ts` and to the `defaults.features` array.
3. Wire it into the `renderers` record in `src/index.ts`. Pass whatever inputs it needs (`entries`, `input.cwd`, `config.<name>`, `theme`).
4. If it's configurable, add a `<name>: { … }` block to `HudConfig` + `defaults` and merge it in `loadConfig`.

**Rule of thumb:** if the feature reads the transcript, pass `entries` (already cached). If it reads the filesystem or shells out, consider caching inside the feature module (see `src/features/git.ts` for the pattern — a 2s freshness window keyed by cwd).

### Adding a new theme

Append to `themes` in `src/themes/index.ts`. Required keys: `name`, `fg`, `dim`, `accent`, `ok`, `warn`, `danger`, `gitDirty`. Hex strings; `ansi.ts` converts to truecolor escape sequences. Invalid theme names silently fall back to `default` in `index.ts`.

### Adding a config knob

1. Extend `HudConfig` in `src/config/index.ts`.
2. Extend `defaults` with the default value.
3. Merge it in `loadConfig` — shallow merge for top-level keys, `{ ...defaults.x, ...global.x, ...project.x }` for nested objects.
4. Document it in `README.md`'s options table.

### Adding a tool to the "slow tools" set

`SLOW_TOOLS` in `src/features/tools.ts`. Add a case to `summarize()` if the tool's `input` shape needs a custom one-liner. Example: a hypothetical `SqlQuery` tool would want `summarize("SqlQuery", { sql }) → truncate(sql, 40)`.

## Conventions

- **No runtime deps.** Hand-roll ANSI, JSON parsing, and date formatting. If you feel the urge to `npm install` something, first check if a 5-line helper in `src/renderers/` or a small utility suffices.
- **Every feature returns `string | null`.** Never `undefined`, never empty string as a sentinel — it makes the `filter` in `index.ts` wrong.
- **Fail silent.** A statusline that crashes or prints an error is worse than one that's blank. `main()` catches everything; individual features should too (e.g. `git.ts` try/catches around `execFileSync`).
- **No comments explaining what obvious code does.** Comments exist only to explain a non-obvious *why* (e.g. "cache by mtime because the script reruns every 300ms").
- **Colors live in themes, thresholds live in config.** If you find yourself hardcoding `#ff0000` or `0.85` inside a feature, hoist it.

## The `env` feature — where counts come from

`src/features/env.ts` reads Claude Code's config layout. Each count is the union of multiple sources, deduped where relevant:

MCP counting is the most involved — it has **three sources**:

1. **User MCPs** (disk, sync): keys of `mcpServers` from `~/.claude.json` top-level, `~/.claude.json → projects[cwd]`, `~/.claude/settings.json`, `<cwd>/.mcp.json`, `<cwd>/.claude/settings.json`. Deduped by server name.
2. **Plugin MCPs** (disk, sync): for each plugin set to `true` in `~/.claude/settings.json → enabledPlugins`, look up the install path in `~/.claude/plugins/installed_plugins.json`, then read `<installPath>/.mcp.json`. Some plugins put servers under `mcpServers`, others at top level — handle both.
3. **claude.ai remote MCPs** (async, cached): these are OAuth-connected servers (Gmail, Notion, etc.) fetched by Claude Code at runtime — they're NOT on disk. `readRemoteMcpCount()` reads a JSON cache file in `os.tmpdir()` (⚠️ that's `/var/folders/…` on macOS, not `/tmp`). If the cache is stale (>60s), `kickRemoteMcpRefresh()` spawns a **detached** `sh -c "claude mcp list | node -e '…'"` that parses the output and rewrites the cache. The refresh's node one-liner filters for lines matching `/^claude\.ai .+: .+ - (✓|!)/` — this is critical, because `claude mcp list` prints ALL servers including user/plugin ones, and we'd double-count if we included them.

The detached child uses `spawn(..., { detached: true, stdio: "ignore" }); child.unref();` so the statusline process exits immediately. A lock file (`<cache>.lock`) prevents concurrent refreshes from piling up within `MCP_REFRESH_TIMEOUT_MS`.

**Other counts:**

- **Hooks:** sum of individual hook handlers (flattening `hooks.<Event>[].hooks[]`) across `~/.claude/settings.json`, `<cwd>/.claude/settings.json`, `<cwd>/.claude/settings.local.json`.
- **Rules:** `~/.claude/CLAUDE.md` + walk-up of `CLAUDE.md` from cwd, stopping at `$HOME`'s parent. Mirrors how Claude Code itself discovers memory files.
- **Agents:** count of `.md` files in `~/.claude/agents/` + `<cwd>/.claude/agents/`.

Cache is 5s per cwd. These files rarely change mid-session, and even if they do, the user has to restart Claude Code for most changes to take effect anyway.

**When adding a new count** (e.g. slash commands, skills), follow the same pattern: a private `countX(cwd)` that reads all plausible locations, surfaced through `readEnvCounts` and optionally into `renderEnv`. Skip rendering when the count is 0 — zeros are noise.

## Gotchas

- **`execFileSync` stderr → `"ignore"`.** Otherwise `git` prints "not a git repo" warnings straight to the terminal when the HUD runs outside a repo.
- **`exceeds_200k_tokens`** in the payload signals Claude's 1M-context beta is active — the context bar uses it to pick the right denominator. Don't hardcode 200000.
- **`cost.total_cost_usd` is authoritative.** Don't sum tokens × pricing yourself; Claude Code already did the math, handles cache-read/cache-create rate differences, and stays correct across model price changes.
- **Module-level `Map` caches survive within a single invocation only** (the Node process exits per tick). They're there to protect against Bun/long-running scenarios, not as a real cache — don't rely on cross-tick state.
- **No POSIX-only shell-outs.** The HUD runs on Windows too. `sh`, `2>/dev/null`, and single-quoted `node -e '…'` do not exist there. Shell out via `execFile`/`spawn` with an explicit binary, or run a compiled sibling module with `process.execPath` (see `mcp-refresh.ts`). Always attach a `child.on("error", …)` to a spawn — an unhandled `error` event takes down the whole tick.
- **Don't parse CLI output by its status icon.** `claude mcp list` prints `✔` (U+2714), not `✓` (U+2713); an earlier regex used the latter and silently counted almost nothing. Match on line structure and let the icon vary.
- **Feature ordering is user-controlled via `config.features`.** If you add a feature that only makes sense in a specific position, that's a smell — redesign so it composes anywhere.

## Installers

`install.sh` (POSIX) and `install.ps1` (Windows) are thin wrappers. All the logic
that can corrupt something lives in `scripts/apply-statusline.js`, which both call:

- It is the single implementation of the settings merge, so the two installers
  cannot drift apart.
- Doing the JSON edit in node avoids PowerShell's `ConvertTo-Json`, whose default
  `-Depth 2` would silently flatten nested `hooks`/`permissions`/`enabledPlugins`
  into `System.Object[]`.
- It normalises `\` to `/` and quotes paths containing spaces — `C:\Users\First Last\…`
  is common on Windows and would otherwise reach the shell as two arguments.
- It refuses to write when the existing file is not valid JSON, or is not an
  object at the top level, and backs up before every write.

Keep new install logic in that script rather than in either shell wrapper.

## Testing

`npm test` builds first (`pretest`) then runs `node --test 'test/**/*.test.js'` (native runner, no extra deps). **Keep the glob quoted** — `**` is not expanded by default in bash/sh, so an unquoted pattern reaches node as a literal path and it tries to `require` it. Node expands the pattern itself.

Tests target pure helpers, never render functions (ANSI snapshots are fragile):

| File | Covers |
| ---- | ------ |
| `test/transcript.test.js` | `readTranscript` (malformed lines, missing file, cache invalidation), `latestUsage` |
| `test/tools.test.js`      | `activeTools` id-pairing, slow-tool filtering, `summarize` labels |
| `test/todos.test.js`      | `latestTodos` — last write wins, `[]` vs `null` |
| `test/context.test.js`    | `usedTokens`, `resolveContextWindow` (family defaults, `[1m]`, payload flag) |
| `test/git.test.js`        | `readGitStatus` against real throwaway repos |
| `test/config.test.js`     | `loadConfig` layering, nested merge, walk-up bounds, malformed JSON |

Two things make these deterministic on any machine:

- **`loadConfig` tests sandbox `$HOME`.** `GLOBAL_PATH` is derived from `homedir()` at module load, and `os.homedir()` honours `$HOME` on POSIX — so the test sets `$HOME` to a temp dir and re-`require`s the module (clearing `require.cache`). Without this the suite would read the contributor's real `~/.config/claude-hud/config.json` and pass or fail depending on whose machine it ran on.
- **`git` tests pin `user.email`/`user.name`/`commit.gpgsign` per throwaway repo**, so they don't inherit global git config or fail where commit signing is enabled.

Tests assert the **documented** contract, not the code's comments: `~/.claude-hud.json` *is* honoured (README: "up to (but not past) `~`"), and the walk stops above `~`.

Smoke-test a render end-to-end by piping a hand-crafted payload to `dist/index.js` — see README's "Smoke-test a render" block. Build a fake transcript JSONL under `/tmp/` to exercise features like todos/tools without running a real Claude session.

## What NOT to do

- Don't add persistent daemons, sockets, file watchers, or background workers. The HUD must be stateless.
- Don't read Claude Code's OAuth tokens or any `~/.claude` internals beyond what's in the statusline payload.
- Don't make network calls. Context7, Anthropic pricing APIs, whatever — offline-only.
- Don't widen the statusline past ~1 terminal row of meaningful content. If a feature output gets long, truncate (see `tools.ts::truncate`).
- Don't assume the transcript is well-formed. Malformed JSONL lines should be skipped (`readTranscript` already does this).
