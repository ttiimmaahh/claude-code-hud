import { readFileSync, existsSync } from "node:fs";
import { dirname, join, parse } from "node:path";
import { homedir } from "node:os";

export type FeatureId = "model" | "context" | "git" | "todos" | "tools" | "cost" | "env";

export interface HudConfig {
  theme: string;
  features: FeatureId[];
  context: { warnAt: number; dangerAt: number; segments: number };
  cost: { warnAt: number; dangerAt: number };
}

export const defaults: HudConfig = {
  theme: "default",
  features: ["model", "context", "git", "todos", "tools", "cost", "env"],
  context: { warnAt: 0.6, dangerAt: 0.8, segments: 10 },
  cost: { warnAt: 5, dangerAt: 20 },
};

const FILENAME = ".claude-hud.json";
const GLOBAL_PATH = join(homedir(), ".config", "claude-hud", "config.json");

// Walk up from cwd looking for a project-level config. Stop at filesystem
// root or home dir (so we don't accidentally pick up a config from a
// sibling project that happens to share an ancestor).
function findProjectConfig(cwd: string): string | null {
  const { root } = parse(cwd);
  const home = homedir();
  let dir = cwd;
  while (dir !== root && dir !== dirname(home)) {
    const candidate = join(dir, FILENAME);
    if (existsSync(candidate)) return candidate;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

function readJson(path: string): Partial<HudConfig> {
  try {
    return JSON.parse(readFileSync(path, "utf8")) as Partial<HudConfig>;
  } catch {
    return {};
  }
}

// Shallow merge per top-level key, with nested merge for `context` and `cost`.
// Project config wins over global, global wins over defaults.
export function loadConfig(cwd: string): HudConfig {
  const global = existsSync(GLOBAL_PATH) ? readJson(GLOBAL_PATH) : {};
  const projectPath = findProjectConfig(cwd);
  const project = projectPath ? readJson(projectPath) : {};
  return {
    theme: project.theme ?? global.theme ?? defaults.theme,
    features: project.features ?? global.features ?? defaults.features,
    context: { ...defaults.context, ...global.context, ...project.context },
    cost: { ...defaults.cost, ...global.cost, ...project.cost },
  };
}
