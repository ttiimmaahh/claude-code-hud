// Tiny hand-rolled ANSI helper — avoids pulling in `chalk` (and its startup cost).
const ESC = "\x1b[";
export const reset = `${ESC}0m`;
export const bold = (s: string) => `${ESC}1m${s}${reset}`;
export const dim = (s: string) => `${ESC}2m${s}${reset}`;
export const fg = (hex: string, s: string) => {
  const { r, g, b } = hexToRgb(hex);
  return `${ESC}38;2;${r};${g};${b}m${s}${reset}`;
};
export const bg = (hex: string, s: string) => {
  const { r, g, b } = hexToRgb(hex);
  return `${ESC}48;2;${r};${g};${b}m${s}${reset}`;
};

function hexToRgb(hex: string) {
  const h = hex.replace("#", "");
  return {
    r: parseInt(h.slice(0, 2), 16),
    g: parseInt(h.slice(2, 4), 16),
    b: parseInt(h.slice(4, 6), 16),
  };
}
