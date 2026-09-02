const { test } = require("node:test");
const assert = require("node:assert/strict");

const { activeTools } = require("../dist/features/tools.js");

const use = (name, id, input = {}) => ({
  type: "assistant",
  message: { role: "assistant", content: [{ type: "tool_use", name, id, input }] },
});
const result = id => ({
  type: "user",
  message: { role: "user", content: [{ type: "tool_result", tool_use_id: id, content: "ok" }] },
});
const names = entries => activeTools(entries).map(t => t.name);
const labels = entries => activeTools(entries).map(t => t.label);

test("a tool_use with no matching tool_result is in flight", () => {
  assert.deepEqual(names([use("Bash", "t1", { command: "npm test" })]), ["Bash"]);
});

test("a tool_use is cleared once its result arrives", () => {
  assert.deepEqual(activeTools([use("Bash", "t1"), result("t1")]), []);
});

test("results are paired by id, not by position", () => {
  // Two tools run concurrently and the second finishes first.
  const entries = [use("Bash", "a", { command: "sleep 30" }), use("WebSearch", "b", { query: "x" }), result("b")];
  assert.deepEqual(names(entries), ["Bash"], "only the unresolved id stays pending");
});

test("an unrelated tool_result does not clear a pending tool", () => {
  assert.deepEqual(names([use("Bash", "a"), result("zzz")]), ["Bash"]);
});

test("only slow tools are tracked", () => {
  // Read/Edit/Grep finish instantly — showing them would just flicker.
  const entries = [use("Read", "r1"), use("Edit", "e1"), use("Grep", "g1"), use("Bash", "b1")];
  assert.deepEqual(names(entries), ["Bash"]);
});

test("Agent and Task both count as subagents", () => {
  // The tool was renamed; the HUD must recognise it under either name.
  assert.deepEqual(names([use("Agent", "1"), use("Task", "2")]), ["Agent", "Task"]);
});

test("multiple in-flight tools are returned in start order", () => {
  const entries = [use("Bash", "1"), use("WebFetch", "2", { url: "https://x.dev" }), use("WebSearch", "3")];
  assert.deepEqual(names(entries), ["Bash", "WebFetch", "WebSearch"]);
});

test("blocks in a single message are handled together", () => {
  const entry = {
    type: "assistant",
    message: {
      role: "assistant",
      content: [
        { type: "text", text: "running two things" },
        { type: "tool_use", name: "Bash", id: "a", input: { command: "ls" } },
        { type: "tool_use", name: "Bash", id: "b", input: { command: "pwd" } },
      ],
    },
  };
  assert.deepEqual(labels([entry]), ["ls", "pwd"]);
});

test("entries without array content are ignored", () => {
  const entries = [{ type: "summary" }, { type: "user", message: { content: "plain string" } }, use("Bash", "x")];
  assert.deepEqual(names(entries), ["Bash"]);
});

test("Bash is labelled with its command, truncated at 40 chars", () => {
  assert.deepEqual(labels([use("Bash", "1", { command: "npm run build" })]), ["npm run build"]);

  const long = "x".repeat(60);
  const [label] = labels([use("Bash", "2", { command: long })]);
  assert.equal(label.length, 40, "39 chars + ellipsis");
  assert.ok(label.endsWith("…"));
});

test("WebFetch is labelled with the hostname, not the full URL", () => {
  assert.deepEqual(
    labels([use("WebFetch", "1", { url: "https://docs.claude.com/en/docs/very/long/path?q=1" })]),
    ["docs.claude.com"],
  );
});

test("WebFetch falls back to 'fetch' on an unparseable URL", () => {
  assert.deepEqual(labels([use("WebFetch", "1", { url: "not a url" })]), ["fetch"]);
});

test("a subagent is labelled 'type: description'", () => {
  assert.deepEqual(
    labels([use("Task", "1", { subagent_type: "Explore", description: "Find auth code" })]),
    ["Explore: Find auth code"],
  );
});

test("a subagent with no description shows just its type", () => {
  assert.deepEqual(labels([use("Task", "1", { subagent_type: "Explore" })]), ["Explore"]);
});

test("a subagent with no type falls back to 'agent'", () => {
  assert.deepEqual(labels([use("Task", "1", {})]), ["agent"]);
});

test("a tool restarted under a new id is tracked again", () => {
  // Same command, fresh id — the completed first run must not mask the second.
  const entries = [use("Bash", "a", { command: "npm test" }), result("a"), use("Bash", "b", { command: "npm test" })];
  assert.deepEqual(names(entries), ["Bash"]);
});
