const { test } = require("node:test");
const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
const { mkdtempSync, writeFileSync, readFileSync, existsSync, readdirSync, rmSync } = require("node:fs");
const { join } = require("node:path");
const { tmpdir } = require("node:os");

const SCRIPT = join(__dirname, "..", "scripts", "apply-statusline.js");

// Shared by install.sh and install.ps1, so it is the one place the settings
// merge can go wrong on either platform.
function apply(settingsPath, entry) {
  try {
    const stdout = execFileSync(process.execPath, [SCRIPT, settingsPath, entry], { encoding: "utf8" });
    return { code: 0, stdout };
  } catch (e) {
    return { code: e.status, stdout: e.stdout ?? "", stderr: e.stderr ?? "" };
  }
}
const read = p => JSON.parse(readFileSync(p, "utf8"));
const sandbox = () => mkdtempSync(join(tmpdir(), "hud-settings-"));

test("creates settings.json, and any missing parent directories", () => {
  const dir = sandbox();
  try {
    const path = join(dir, "nested", ".claude", "settings.json");
    assert.equal(apply(path, "/repo/dist/index.js").code, 0);
    assert.deepEqual(read(path).statusLine, {
      type: "command",
      command: "node /repo/dist/index.js",
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("preserves unrelated settings, including deeply nested ones", () => {
  // The regression this guards against is PowerShell's ConvertTo-Json -Depth 2
  // flattening hooks/permissions into "System.Object[]".
  const dir = sandbox();
  try {
    const path = join(dir, "settings.json");
    const original = {
      model: "opus",
      permissions: { allow: ["Bash(npm test)"], deny: [] },
      hooks: { Stop: [{ matcher: "*", hooks: [{ type: "command", command: "echo done" }] }] },
      enabledPlugins: { "context7@claude-plugins-official": true },
    };
    writeFileSync(path, JSON.stringify(original));
    apply(path, "/repo/dist/index.js");

    const after = read(path);
    assert.equal(after.model, "opus");
    assert.deepEqual(after.permissions, original.permissions);
    assert.deepEqual(after.hooks, original.hooks, "nested hook handlers survive the round-trip");
    assert.deepEqual(after.enabledPlugins, original.enabledPlugins);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("replaces an existing statusLine rather than appending", () => {
  const dir = sandbox();
  try {
    const path = join(dir, "settings.json");
    writeFileSync(path, JSON.stringify({ statusLine: { type: "command", command: "node /old/index.js" } }));
    const { stdout } = apply(path, "/new/dist/index.js");
    assert.equal(read(path).statusLine.command, "node /new/dist/index.js");
    assert.match(stdout, /replaced: node \/old\/index\.js/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("is idempotent", () => {
  const dir = sandbox();
  try {
    const path = join(dir, "settings.json");
    apply(path, "/repo/dist/index.js");
    const first = readFileSync(path, "utf8");
    apply(path, "/repo/dist/index.js");
    assert.equal(readFileSync(path, "utf8"), first);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("backs up an existing file before rewriting it", () => {
  const dir = sandbox();
  try {
    const path = join(dir, "settings.json");
    writeFileSync(path, JSON.stringify({ model: "opus" }));
    apply(path, "/repo/dist/index.js");
    const backups = readdirSync(dir).filter(f => f.includes(".bak."));
    assert.equal(backups.length, 1);
    assert.deepEqual(read(join(dir, backups[0])), { model: "opus" }, "backup holds the pre-change content");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("does not create a backup when there was no file", () => {
  const dir = sandbox();
  try {
    apply(join(dir, "settings.json"), "/repo/dist/index.js");
    assert.deepEqual(readdirSync(dir).filter(f => f.includes(".bak.")), []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("Windows backslash paths are normalised to forward slashes", () => {
  // Backslashes would otherwise need escaping inside JSON, and a stray \U or \t
  // in a home directory name would corrupt the command.
  const dir = sandbox();
  try {
    const path = join(dir, "settings.json");
    apply(path, "C:\\Users\\example\\claude-code-hud\\dist\\index.js");
    assert.equal(read(path).statusLine.command, "node C:/Users/example/claude-code-hud/dist/index.js");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a path containing a space is quoted", () => {
  // "C:\Users\First Last\..." is common on Windows; unquoted it would reach the
  // shell as two arguments and the statusline would silently never run.
  const dir = sandbox();
  try {
    const path = join(dir, "settings.json");
    apply(path, "C:\\Users\\First Last\\claude-code-hud\\dist\\index.js");
    assert.equal(
      read(path).statusLine.command,
      'node "C:/Users/First Last/claude-code-hud/dist/index.js"',
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("refuses to clobber a settings file that is not valid JSON", () => {
  // That file holds the user's permissions, hooks and plugin state.
  const dir = sandbox();
  try {
    const path = join(dir, "settings.json");
    writeFileSync(path, "{ broken,, }");
    const { code, stderr } = apply(path, "/repo/dist/index.js");
    assert.equal(code, 1);
    assert.match(stderr, /not valid JSON/);
    assert.equal(readFileSync(path, "utf8"), "{ broken,, }", "left untouched");
    assert.deepEqual(readdirSync(dir), ["settings.json"], "and no backup litter");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("refuses a settings file whose top level is not an object", () => {
  const dir = sandbox();
  try {
    const path = join(dir, "settings.json");
    writeFileSync(path, "[1,2,3]");
    assert.equal(apply(path, "/repo/dist/index.js").code, 1);
    assert.equal(readFileSync(path, "utf8"), "[1,2,3]");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("an empty file is treated as an empty object", () => {
  const dir = sandbox();
  try {
    const path = join(dir, "settings.json");
    writeFileSync(path, "   \n");
    assert.equal(apply(path, "/repo/dist/index.js").code, 0);
    assert.equal(read(path).statusLine.type, "command");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("exits 2 when called without arguments", () => {
  try {
    execFileSync(process.execPath, [SCRIPT], { encoding: "utf8", stdio: "pipe" });
    assert.fail("expected a non-zero exit");
  } catch (e) {
    assert.equal(e.status, 2);
    assert.match(e.stderr, /usage:/);
  }
});
