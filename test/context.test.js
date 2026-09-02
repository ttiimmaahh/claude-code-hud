const { test } = require("node:test");
const assert = require("node:assert/strict");

const { usedTokens, resolveContextWindow, contextWindow } = require("../dist/features/context.js");

const input = over => ({
  inputTokens: 0,
  cacheReadTokens: 0,
  cacheCreationTokens: 0,
  outputTokens: 0,
  modelId: "claude-opus-5",
  exceeds200k: false,
  ...over,
});

test("usedTokens sums every kind of token that occupies context", () => {
  // Cached tokens still take up window space — counting only fresh input
  // would under-report a long session by an order of magnitude.
  const used = usedTokens(
    input({ inputTokens: 1_000, cacheReadTokens: 50_000, cacheCreationTokens: 4_000, outputTokens: 500 }),
  );
  assert.equal(used, 55_500);
});

test("usedTokens is 0 for a fresh session", () => {
  assert.equal(usedTokens(input()), 0);
});

test("known model families get the 200k window", () => {
  for (const id of ["claude-opus-5", "claude-sonnet-5", "claude-haiku-4-5-20251001"]) {
    assert.equal(resolveContextWindow(id, false), 200_000, id);
  }
});

test("an unrecognised model id falls back to 200k", () => {
  assert.equal(resolveContextWindow("some-future-model", false), 200_000);
  assert.equal(resolveContextWindow("", false), 200_000);
});

test("the [1m] suffix selects the 1M beta window", () => {
  // Don't hardcode 200k: the 1M beta changes the denominator, and a bar
  // computed against the wrong window reads ~5x too full.
  assert.equal(resolveContextWindow("claude-sonnet-5[1m]", false), 1_000_000);
  assert.equal(resolveContextWindow("claude-sonnet-5[1M]", false), 1_000_000);
});

test("the exceeds_200k_tokens payload flag also selects 1M", () => {
  // Claude Code may signal the beta via the flag without the id suffix.
  assert.equal(resolveContextWindow("claude-opus-5", true), 1_000_000);
});

test("an explicit suffix wins over the payload flag", () => {
  assert.equal(resolveContextWindow("claude-sonnet-5[1m]", false), 1_000_000);
  assert.equal(resolveContextWindow("claude-opus-5", true), 1_000_000);
});

test("contextWindow reads the model id and flag off the input", () => {
  assert.equal(contextWindow(input()), 200_000);
  assert.equal(contextWindow(input({ exceeds200k: true })), 1_000_000);
  assert.equal(contextWindow(input({ modelId: "claude-sonnet-5[1m]" })), 1_000_000);
});
