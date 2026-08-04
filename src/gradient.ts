/**
 * Colour, and how to get it onto the screen.
 *
 * Gradients interpolate hue, not RGB. A straight RGB lerp from red to green
 * sags through a muddy olive at the midpoint; walking the hue wheel at fixed
 * saturation and lightness stays vivid the whole way across.
 */

import type { PhaseKind } from './session.ts';

export type Rgb = readonly [number, number, number];
export type ColorMode = 'truecolor' | 'ansi256' | 'none';

const SATURATION = 0.72;
const LIGHTNESS = 0.58;

/** Start and end hues, in degrees. Interpolated the short way round. */
const HUES: Record<PhaseKind, readonly [number, number]> = {
  // Red at 25:00, easing to green as the clock runs out.
  'work': [0, 122],
  // Blue-green to a warm orange: the same journey, walked backwards.
  'short-break': [172, 28],
  'long-break': [196, 40],
};

export function detectColorMode(stream: NodeJS.WriteStream = process.stdout): ColorMode {
  if (process.env['NO_COLOR'] !== undefined && process.env['NO_COLOR'] !== '') return 'none';
  if (!stream.isTTY) return 'none';

  const term = process.env['TERM'] ?? '';
  if (term === 'dumb') return 'none';

  const colorterm = process.env['COLORTERM'] ?? '';
  if (/truecolor|24bit/i.test(colorterm)) return 'truecolor';
  if (/-truecolor|-direct/.test(term)) return 'truecolor';

  return 'ansi256';
}

export function hslToRgb(hue: number, saturation: number, lightness: number): Rgb {
  const h = ((hue % 360) + 360) % 360;
  const c = (1 - Math.abs(2 * lightness - 1)) * saturation;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = lightness - c / 2;

  const [r, g, b] =
    h < 60 ? [c, x, 0]
    : h < 120 ? [x, c, 0]
    : h < 180 ? [0, c, x]
    : h < 240 ? [0, x, c]
    : h < 300 ? [x, 0, c]
    : [c, 0, x];

  return [
    Math.round((r + m) * 255),
    Math.round((g + m) * 255),
    Math.round((b + m) * 255),
  ] as const;
}

/** The colour of a phase at `t` in [0, 1], where 0 is its start. */
export function phaseColor(kind: PhaseKind, t: number): Rgb {
  const [from, to] = HUES[kind];
  const clamped = Math.min(1, Math.max(0, t));
  return hslToRgb(from + (to - from) * clamped, SATURATION, LIGHTNESS);
}

/** Nearest colour in the xterm 6x6x6 cube, plus its greyscale ramp. */
export function rgbToAnsi256([r, g, b]: Rgb): number {
  if (Math.abs(r - g) < 8 && Math.abs(g - b) < 8) {
    if (r < 8) return 16;
    if (r > 248) return 231;
    return 232 + Math.round(((r - 8) / 247) * 23);
  }
  const scale = (v: number) => Math.round((v / 255) * 5);
  return 16 + 36 * scale(r) + 6 * scale(g) + scale(b);
}

export function fg(text: string, rgb: Rgb, mode: ColorMode): string {
  if (mode === 'none' || text.length === 0) return text;
  const code =
    mode === 'truecolor'
      ? `38;2;${rgb[0]};${rgb[1]};${rgb[2]}`
      : `38;5;${rgbToAnsi256(rgb)}`;
  return `\x1b[${code}m${text}\x1b[39m`;
}

export function dim(text: string, mode: ColorMode): string {
  if (mode === 'none' || text.length === 0) return text;
  return `\x1b[2m${text}\x1b[22m`;
}

export function bold(text: string, mode: ColorMode): string {
  if (mode === 'none' || text.length === 0) return text;
  return `\x1b[1m${text}\x1b[22m`;
}

/** Reverse video, used to light up whatever the mouse is hovering. */
export function invert(text: string, mode: ColorMode): string {
  if (mode === 'none' || text.length === 0) return text;
  return `\x1b[7m${text}\x1b[27m`;
}
