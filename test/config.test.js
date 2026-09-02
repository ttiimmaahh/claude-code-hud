const { test } = require("node:test");
const assert = require("node:assert/strict");
const { mkdtempSync, mkdirSync, writeFileSync, rmSync } = require("node:fs");
const { join } = require("node:path");
const { tmpdir } = require("node:os");

const MODULE = require.resolve("../dist/config/index.js");

// loadConfig resolves the global config path from homedir() at module load, and
// os.homedir() honours $HOME on POSIX. Point HOME at a sandbox and re-require so
// the suite never reads (or depends on) the contributor's real ~/.config.
function withHome(home, fn) {
  const previous = process.env.HOME;
  process.env.HOME = home;
  delete require.cache[MODULE];
  try {
    return fn(require(MODULE));
  } finally {
    if (previous === undefined) delete process.env.HOME;
    else process.env.HOME = previous;
    delete require.cache[MODULE];
  }
}

// A sandbox home plus a project dir nested inside it, mirroring a real layout
// (the walk-up deliberately stops at the home boundary).
function sandbox() {
  const home = mkdtempSync(join(tmpdir(), "hud-home-"));
  const project = join(home, "code", "project");
  mkdirSync(project, { recursive: true });
  return { home, project, cleanup: () => rmSync(home, { recursive: true, force: true }) };
}
const writeGlobal = (home, cfg) => {
  const dir = join(home, ".config", "claude-hud");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "config.json"), JSON.stringify(cfg));
};
const writeProject = (dir, cfg) => writeFileSync(join(dir, ".claude-hud.json"), JSON.stringify(cfg));

test("falls back to defaults when no config exists anywhere", () => {
  const { home, project, cleanup } = sandbox();
  try {
    withHome(home, ({ loadConfig, defaults }) => {
      assert.deepEqual(loadConfig(project), defaults);
    });
  } finally {
    cleanup();
  }
});

test("a global config overrides defaults", () => {
  const { home, project, cleanup } = sandbox();
  try {
    writeGlobal(home, { theme: "nord", features: ["git"] });
    withHome(home, ({ loadConfig, defaults }) => {
      const cfg = loadConfig(project);
      assert.equal(cfg.theme, "nord");
      assert.deepEqual(cfg.features, ["git"]);
      assert.deepEqual(cfg.cost, defaults.cost, "untouched keys keep their defaults");
    });
  } finally {
    cleanup();
  }
});

test("a project config overrides the global one", () => {
  const { home, project, cleanup } = sandbox();
  try {
    writeGlobal(home, { theme: "nord", features: ["git"] });
    writeProject(project, { theme: "dracula" });
    withHome(home, ({ loadConfig }) => {
      const cfg = loadConfig(project);
      assert.equal(cfg.theme, "dracula", "project wins");
      assert.deepEqual(cfg.features, ["git"], "global still supplies unset keys");
    });
  } finally {
    cleanup();
  }
});

test("nested context/cost objects merge key-by-key rather than replacing", () => {
  // This is the subtle one: setting a single threshold must not wipe out the
  // sibling keys, or the bar silently loses its segments/thresholds.
  const { home, project, cleanup } = sandbox();
  try {
    writeGlobal(home, { context: { segments: 20 } });
    writeProject(project, { context: { warnAt: 0.5 } });
    withHome(home, ({ loadConfig, defaults }) => {
      const cfg = loadConfig(project);
      assert.equal(cfg.context.warnAt, 0.5, "from project");
      assert.equal(cfg.context.segments, 20, "from global");
      assert.equal(cfg.context.dangerAt, defaults.context.dangerAt, "from defaults");
    });
  } finally {
    cleanup();
  }
});

test("features is replaced wholesale, not merged element-wise", () => {
  // Ordering is user-controlled, so a project listing two features must get
  // exactly those two — not its list appended to the defaults.
  const { home, project, cleanup } = sandbox();
  try {
    writeProject(project, { features: ["cost", "git"] });
    withHome(home, ({ loadConfig }) => {
      assert.deepEqual(loadConfig(project).features, ["cost", "git"]);
    });
  } finally {
    cleanup();
  }
});

test("an empty features array hides every feature", () => {
  const { home, project, cleanup } = sandbox();
  try {
    writeProject(project, { features: [] });
    withHome(home, ({ loadConfig }) => {
      assert.deepEqual(loadConfig(project).features, [], "[] must not be treated as unset");
    });
  } finally {
    cleanup();
  }
});

test("the project config is found by walking up from a subdirectory", () => {
  const { home, project, cleanup } = sandbox();
  try {
    writeProject(project, { theme: "dracula" });
    const nested = join(project, "src", "features");
    mkdirSync(nested, { recursive: true });
    withHome(home, ({ loadConfig }) => {
      assert.equal(loadConfig(nested).theme, "dracula");
    });
  } finally {
    cleanup();
  }
});

test("the nearest config wins during walk-up", () => {
  const { home, project, cleanup } = sandbox();
  try {
    writeProject(join(home, "code"), { theme: "nord" });
    writeProject(project, { theme: "dracula" });
    withHome(home, ({ loadConfig }) => {
      assert.equal(loadConfig(project).theme, "dracula");
    });
  } finally {
    cleanup();
  }
});

test("a config in ~ applies, as the documented 'up to but not past ~' boundary", () => {
  const { home, project, cleanup } = sandbox();
  try {
    writeProject(home, { theme: "nord" });
    withHome(home, ({ loadConfig }) => {
      assert.equal(loadConfig(project).theme, "nord");
    });
  } finally {
    cleanup();
  }
});

test("walk-up stops above ~ and ignores a config in its parent", () => {
  // Without this bound, a stray dotfile in /tmp (or /Users) would leak into
  // every project underneath it.
  const { home, project, cleanup } = sandbox();
  const above = join(home, "..", ".claude-hud.json");
  try {
    writeFileSync(above, JSON.stringify({ theme: "nord" }));
    withHome(home, ({ loadConfig, defaults }) => {
      assert.equal(loadConfig(project).theme, defaults.theme);
    });
  } finally {
    rmSync(above, { force: true });
    cleanup();
  }
});

test("a malformed config file is ignored instead of crashing", () => {
  // A statusline that throws on a stray comma is worse than one using defaults.
  const { home, project, cleanup } = sandbox();
  try {
    writeFileSync(join(project, ".claude-hud.json"), "{ not valid json,, }");
    withHome(home, ({ loadConfig, defaults }) => {
      assert.deepEqual(loadConfig(project), defaults);
    });
  } finally {
    cleanup();
  }
});

test("a malformed global config still lets the project config apply", () => {
  const { home, project, cleanup } = sandbox();
  try {
    const dir = join(home, ".config", "claude-hud");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "config.json"), "]]broken[[");
    writeProject(project, { theme: "dracula" });
    withHome(home, ({ loadConfig }) => {
      assert.equal(loadConfig(project).theme, "dracula");
    });
  } finally {
    cleanup();
  }
});
