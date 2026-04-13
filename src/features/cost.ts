import { fg } from "../renderers/ansi.js";
import type { Theme } from "../themes/index.js";

export interface CostOpts { warnAt: number; dangerAt: number }

export function renderCost(totalUsd: number | undefined, theme: Theme, opts: CostOpts): string | null {
  if (!totalUsd || totalUsd <= 0) return null;
  const color = totalUsd >= opts.dangerAt ? theme.danger : totalUsd >= opts.warnAt ? theme.warn : theme.dim;
  return fg(color, `$${totalUsd.toFixed(2)}`);
}
