const { test } = require("node:test");
const assert = require("node:assert/strict");

const { latestTodos } = require("../dist/features/todos.js");

const todo = (content, status) => ({ content, status, activeForm: `${content}ing` });
const write = (...todos) => ({
  type: "assistant",
  message: { role: "assistant", content: [{ type: "tool_use", name: "TodoWrite", id: "t", input: { todos } }] },
});

test("returns the todo list from a TodoWrite call", () => {
  const todos = latestTodos([write(todo("Write tests", "in_progress"))]);
  assert.equal(todos.length, 1);
  assert.equal(todos[0].status, "in_progress");
});

test("the most recent TodoWrite wins", () => {
  // TodoWrite rewrites the whole list every call, so there is nothing to
  // reconcile — the last write is the truth.
  const entries = [
    write(todo("A", "pending"), todo("B", "pending")),
    write(todo("A", "completed"), todo("B", "in_progress")),
  ];
  assert.deepEqual(
    latestTodos(entries).map(t => t.status),
    ["completed", "in_progress"],
  );
});

test("a later non-TodoWrite tool does not hide the todo list", () => {
  const entries = [
    write(todo("A", "in_progress")),
    { type: "assistant", message: { content: [{ type: "tool_use", name: "Bash", id: "b", input: {} }] } },
  ];
  assert.equal(latestTodos(entries)[0].content, "A");
});

test("returns null when TodoWrite has never run", () => {
  assert.equal(latestTodos([]), null);
  assert.equal(latestTodos([{ type: "user", message: { content: [{ type: "text", text: "hi" }] } }]), null);
});

test("an explicitly empty todo list is returned, not treated as absent", () => {
  // renderTodos distinguishes these: [] means "list cleared", null means
  // "never used". Both hide the feature, but only [] is a real state.
  assert.deepEqual(latestTodos([write()]), []);
});

test("entries without array content are skipped", () => {
  const entries = [write(todo("A", "pending")), { type: "summary" }, { type: "user", message: { content: null } }];
  assert.equal(latestTodos(entries).length, 1);
});
