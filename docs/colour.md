# Colour

The clock starts red at 25:00 and slides through orange and yellow until it's
green at 00:00. Breaks make the same journey backwards, blue-green to a warm
orange, so you can tell what mode you're in from across the room without
reading anything.

## Hue, not RGB

Gradients interpolate hue at a fixed saturation and lightness. A straight RGB
lerp from red to green sags through a muddy olive at the midpoint, whereas
walking the hue wheel stays vivid the whole way across.

```ts
const SATURATION = 0.72;
const LIGHTNESS = 0.58;

const HUES: Record<PhaseKind, readonly [number, number]> = {
  'work': [0, 122],
  'short-break': [172, 28],
  'long-break': [196, 40],
};

export function phaseColor(kind: PhaseKind, t: number): Rgb {
  const [from, to] = HUES[kind];
  const clamped = Math.min(1, Math.max(0, t));
  return hslToRgb(from + (to - from) * clamped, SATURATION, LIGHTNESS);
}
```

`t` is the progress through the phase, 0 at the start and 1 at the end, so the
colour is a pure function of how far along you are. Nothing stores a colour or
mutates one, which is why the same function can colour the clock, the header
label and every cell of the progress bar without any of them getting out of
step.

The bar is the nice case. Each filled cell is coloured for its own position
rather than for the current one, so what you see is the whole gradient
travelled so far instead of one flat block that changes shade:

```ts
for (let i = 0; i < filled; i++) {
  bar += fg(g.barFull, phaseColor(kind, i / (width - 1)), mode);
}
```

## What your terminal can do

Three modes, worked out once at startup.

```ts
export function detectColorMode(stream = process.stdout): ColorMode {
  if (process.env['NO_COLOR'] !== undefined && process.env['NO_COLOR'] !== '') return 'none';
  if (!stream.isTTY) return 'none';

  const term = process.env['TERM'] ?? '';
  if (term === 'dumb') return 'none';

  const colorterm = process.env['COLORTERM'] ?? '';
  if (/truecolor|24bit/i.test(colorterm)) return 'truecolor';
  if (/-truecolor|-direct/.test(term)) return 'truecolor';

  return 'ansi256';
}
```

`truecolor` gets the exact RGB. `ansi256` gets the nearest colour in the xterm
6x6x6 cube, with the greyscale ramp handled separately since a near-grey
rounded into the cube looks wrong. `none` returns the text untouched, which
means every styling function is a no-op rather than a branch at every call
site.

[NO_COLOR](https://no-color.org) is honoured, `--no-color` forces it, and
piping the output anywhere that isn't a terminal turns it off on its own.

## The escape codes

Four of them, and they all follow the same shape.

```ts
export function dim(text: string, mode: ColorMode): string {
  if (mode === 'none' || text.length === 0) return text;
  return `\x1b[2m${text}\x1b[22m`;
}
```

Foreground colour, dim, bold and reverse video. Reverse is what lights up the
button under your mouse, which is cheaper than picking a background colour that
works on every terminal theme and is more reliable too.

Everything closes with the specific reset for what it opened, `\x1b[39m` for
colour and `\x1b[22m` for dim and bold, rather than the blanket `\x1b[0m`. That
way styles nest, which they have to, because the hovered button is bold and
coloured and reversed all at once.

One consequence worth knowing when you touch `render.ts`. A styled string is
longer than what it draws, so every layout calculation in there passes the
visible width around separately. Padding is worked out from the plain text and
applied around the styled text, never measured off `.length`.
