const { test } = require("node:test");
const assert = require("node:assert/strict");
const { mkdtempSync, writeFileSync, utimesSync, rmSync } = require("node:fs");
const { join } = require("node:path");
const { tmpdir } = require("node:os");

const { readTranscript, latestUsage } = require("../dist/parsers/transcript.js");

function tmpTranscript(lines) {
  const dir = mkdtempSync(join(tmpdir(), "hud-transcript-"));
  const path = join(dir, "session.jsonl");
  writeFileSync(path, lines.map(l => (typeof l === "string" ? l : JSON.stringify(l))).join("\n"));
  return { path, dir };
}

const assistant = usage => ({ type: "assistant", message: { role: "assistant", usage } });

test("readTranscript parses one entry per JSONL line", () => {
  const { path, dir } = tmpTranscript([
    { type: "user", message: { role: "user" } },
    assistant({ input_tokens: 10 }),
  ]);
  try {
    const entries = readTranscript(path);
    assert.equal(entries.length, 2);
    assert.equal(entries[0].type, "user");
    assert.equal(entries[1].message.usage.input_tokens, 10);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("readTranscript skips malformed lines instead of throwing", () => {
  // Claude Code can leave a torn final line if it is killed mid-write; one bad
  // line must not cost us the whole transcript.
  const { path, dir } = tmpTranscript([
    { type: "user" },
    "{ this is not json",
    "",
    { type: "assistant", message: { usage: { output_tokens: 7 } } },
    '{"type":"assistant","message":{"usage":', // truncated tail
  ]);
  try {
    const entries = readTranscript(path);
    assert.equal(entries.length, 2, "only the two well-formed lines survive");
    assert.equal(latestUsage(entries).output_tokens, 7);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("readTranscript returns [] for a missing file rather than throwing", () => {
  // A brand-new session has no transcript yet; renderers must still run.
  assert.deepEqual(readTranscript("/nonexistent/path/session.jsonl"), []);
});

test("readTranscript re-reads when the file changes", () => {
  const { path, dir } = tmpTranscript([assistant({ input_tokens: 1 })]);
  try {
    assert.equal(latestUsage(readTranscript(path)).input_tokens, 1);

    // Rewrite with different content AND a different size, so the
    // (mtime, size) cache key is guaranteed to differ.
    writeFileSync(path, JSON.stringify(assistant({ input_tokens: 4242 })) + "\n");
    assert.equal(
      latestUsage(readTranscript(path)).input_tokens,
      4242,
      "cache must invalidate when the transcript grows",
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("latestUsage reads from the tail because usage is a running total", () => {
  // Each assistant message carries cumulative totals, so an earlier, larger
  // number must never win over the most recent one.
  const entries = [
    assistant({ input_tokens: 500, output_tokens: 900 }),
    assistant({ input_tokens: 20, output_tokens: 5 }),
  ];
  assert.deepEqual(latestUsage(entries), { input_tokens: 20, output_tokens: 5 });
});

test("latestUsage skips trailing entries that carry no usage", () => {
  const entries = [
    assistant({ input_tokens: 11 }),
    { type: "user", message: { role: "user", content: [{ type: "text", text: "hi" }] } },
    { type: "summary" },
  ];
  assert.equal(latestUsage(entries).input_tokens, 11);
});

test("latestUsage returns undefined when nothing has usage", () => {
  assert.equal(latestUsage([]), undefined);
  assert.equal(latestUsage([{ type: "user" }, { type: "summary" }]), undefined);
});
