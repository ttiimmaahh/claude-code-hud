const { test } = require("node:test");
const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
const { mkdtempSync, writeFileSync, rmSync } = require("node:fs");
const { join } = require("node:path");
const { tmpdir } = require("node:os");

const { readGitStatus } = require("../dist/features/git.js");

const git = (cwd, ...args) =>
  execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();

// A repo with local identity/signing pinned, so the suite does not inherit the
// contributor's global git config (or fail on a machine with commit signing on).
function repo() {
  const dir = mkdtempSync(join(tmpdir(), "hud-git-"));
  git(dir, "init", "-q", "-b", "main", ".");
  git(dir, "config", "user.email", "test@example.com");
  git(dir, "config", "user.name", "Test");
  git(dir, "config", "commit.gpgsign", "false");
  return dir;
}
const commit = (dir, name, body = "x") => {
  writeFileSync(join(dir, name), body);
  git(dir, "add", name);
  git(dir, "commit", "-qm", `add ${name}`);
};
const cleanup = dirs => dirs.forEach(d => rmSync(d, { recursive: true, force: true }));

test("returns null outside a git repo", () => {
  // The git feature must disappear rather than crash the statusline.
  const dir = mkdtempSync(join(tmpdir(), "hud-nogit-"));
  try {
    assert.equal(readGitStatus(dir), null);
  } finally {
    cleanup([dir]);
  }
});

test("returns null for a nonexistent directory", () => {
  assert.equal(readGitStatus("/nonexistent/dir/anywhere"), null);
});

test("reads the branch name of a clean repo", () => {
  const dir = repo();
  try {
    commit(dir, "a.txt");
    assert.deepEqual(readGitStatus(dir), { branch: "main", ahead: 0, behind: 0, dirty: 0 });
  } finally {
    cleanup([dir]);
  }
});

test("reads a non-default branch name", () => {
  const dir = repo();
  try {
    commit(dir, "a.txt");
    git(dir, "checkout", "-q", "-b", "feature/some-work");
    assert.equal(readGitStatus(dir).branch, "feature/some-work");
  } finally {
    cleanup([dir]);
  }
});

test("counts staged, unstaged and untracked files together", () => {
  const dir = repo();
  try {
    commit(dir, "a.txt", "one");
    writeFileSync(join(dir, "a.txt"), "modified");  // unstaged
    writeFileSync(join(dir, "b.txt"), "new");
    git(dir, "add", "b.txt");                        // staged
    writeFileSync(join(dir, "c.txt"), "untracked");  // untracked
    assert.equal(readGitStatus(dir).dirty, 3);
  } finally {
    cleanup([dir]);
  }
});

test("a file both staged and modified again counts once", () => {
  // porcelain v2 emits one line per path, not one per change type.
  const dir = repo();
  try {
    commit(dir, "a.txt", "one");
    writeFileSync(join(dir, "a.txt"), "staged");
    git(dir, "add", "a.txt");
    writeFileSync(join(dir, "a.txt"), "and modified again");
    assert.equal(readGitStatus(dir).dirty, 1);
  } finally {
    cleanup([dir]);
  }
});

test("ahead and behind are read from the upstream", () => {
  const remote = mkdtempSync(join(tmpdir(), "hud-remote-"));
  git(remote, "init", "-q", "--bare", "-b", "main", ".");
  const dir = repo();
  try {
    commit(dir, "a.txt");
    git(dir, "remote", "add", "origin", remote);
    git(dir, "push", "-q", "-u", "origin", "main");
    assert.deepEqual(readGitStatus(dir), { branch: "main", ahead: 0, behind: 0, dirty: 0 });

    commit(dir, "b.txt");
    commit(dir, "c.txt");
    const ahead = readGitStatus(dir);
    assert.equal(ahead.ahead, 2, "two unpushed commits");
    assert.equal(ahead.behind, 0);

    // Move the remote forward from a second clone, then fetch to fall behind.
    const other = mkdtempSync(join(tmpdir(), "hud-clone-"));
    git(other, "clone", "-q", remote, ".");
    git(other, "config", "user.email", "test@example.com");
    git(other, "config", "user.name", "Test");
    git(other, "config", "commit.gpgsign", "false");
    commit(other, "d.txt");
    git(other, "push", "-q", "origin", "main");

    git(dir, "fetch", "-q", "origin");
    const both = readGitStatus(dir);
    assert.equal(both.ahead, 2);
    assert.equal(both.behind, 1, "one commit landed upstream");
    cleanup([other]);
  } finally {
    cleanup([dir, remote]);
  }
});

test("no upstream means ahead/behind stay 0", () => {
  const dir = repo();
  try {
    commit(dir, "a.txt");
    commit(dir, "b.txt");
    const s = readGitStatus(dir);
    assert.equal(s.ahead, 0);
    assert.equal(s.behind, 0);
  } finally {
    cleanup([dir]);
  }
});

test("a detached HEAD reports git's own '(detached)' marker", () => {
  const dir = repo();
  try {
    commit(dir, "a.txt");
    git(dir, "checkout", "-q", "--detach", "HEAD");
    assert.equal(readGitStatus(dir).branch, "(detached)");
  } finally {
    cleanup([dir]);
  }
});

test("a repo with no commits yet still reports its branch", () => {
  // Freshly `git init`ed projects are a normal state to open Claude Code in.
  const dir = repo();
  try {
    assert.deepEqual(readGitStatus(dir), { branch: "main", ahead: 0, behind: 0, dirty: 0 });
    writeFileSync(join(dir, "a.txt"), "x");
    assert.equal(readGitStatus(dir).dirty, 1);
  } finally {
    cleanup([dir]);
  }
});
