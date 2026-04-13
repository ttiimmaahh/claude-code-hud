export interface Theme {
  name: string;
  fg: string;
  dim: string;
  accent: string;
  ok: string;       // e.g. context < warn threshold
  warn: string;     // e.g. context > warn threshold
  danger: string;   // e.g. context > danger threshold
  gitDirty: string;
}

export const themes: Record<string, Theme> = {
  default: {
    name: "default",
    fg: "#e6e6e6",
    dim: "#7a7a7a",
    accent: "#8ab4f8",
    ok: "#5fd97a",
    warn: "#f5c542",
    danger: "#ff5c5c",
    gitDirty: "#f5c542",
  },
  nord: {
    name: "nord",
    fg: "#eceff4",
    dim: "#4c566a",
    accent: "#88c0d0",
    ok: "#a3be8c",
    warn: "#ebcb8b",
    danger: "#bf616a",
    gitDirty: "#ebcb8b",
  },
  dracula: {
    name: "dracula",
    fg: "#f8f8f2",
    dim: "#6272a4",
    accent: "#bd93f9",
    ok: "#50fa7b",
    warn: "#f1fa8c",
    danger: "#ff5555",
    gitDirty: "#ffb86c",
  },
};
