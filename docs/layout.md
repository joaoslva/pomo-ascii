# Layout

The box comes in three sizes and pomo picks the biggest one your terminal can
hold, re-picking it the moment you drag the window. Nothing stretches, because
a progress bar 200 columns wide is not an improvement, so a big terminal just
gets the box centred in it.

```ts
export const FULL: Tier = { name: 'full', width: 44, height: 13 };
export const COMPACT: Tier = { name: 'compact', width: 34, height: 9 };
export const TINY: Tier = { name: 'tiny', width: 16, height: 3 };

export function layout(columns: number, rows: number): Tier | null {
  for (const tier of TIERS) {
    if (columns >= tier.width && rows >= tier.height) return tier;
  }
  return null;
}
```

## Full, at 44 by 13

The one in the README. Big digits at two characters per font cell, blank rows
above and below the clock and the bar, padded buttons, and a status row along
the bottom with the dots, the round count and either the key hints or your
`--task`.

## Compact, at 34 by 9

The spacing goes, the digits get thin, the round count moves up into the title
bar and the buttons lose their padding. The status row goes altogether, which
is why the header has to carry the round count here.

```
┌─ pomo ───────────── focus 1/4 ─┐
│        █  ███   ███ ███        │
│       ██    █ █   █ █ █        │
│        █  ███   ███ █ █        │
│        █    █ █ █   █ █        │
│       ███ ███   ███ ███        │
│   █████░░░░░░░░░░░░░░░░░░░░░   │
│ [pause ] [skip] [reset] [quit] │
└────────────────────────────────┘
```

Everything that changes between these two is one small record, which is most of
why there are two sizes rather than one size and a pile of conditionals:

```ts
const STYLES: Record<'full' | 'compact', BoxStyle> = {
  full: { digitScale: 2, barWidth: 34, spacers: true, padButtons: true, statusRow: true },
  compact: { digitScale: 1, barWidth: 26, spacers: false, padButtons: false, statusRow: false },
};
```

## Tiny, at 16 by 3

No room for a border, never mind a button. Three bare lines, the clock and the
phase, the bar, the round count and the key hints. The keys still work.

```
13:20      focus
███░░░░░░░░░░░░░
1/4  spc s r m q
```

At this width a border would cost two of the sixteen columns and the button row
wouldn't fit at all, so there is no point pretending.

## Smaller than that

Below the tiny tier there is nothing honest left to draw, so it says so:

```
too small
have 12x4
need 16x3
```

Even that degrades. It tries the three line version, then a shorter one, then
two lines, then one, then a bare `!`, and takes the first that fits whatever is
actually there. A "too small" notice that is itself too small would be a
comedy.

The settings menu has its own layout function, since a list of settings has
nothing to gain from big digits. It borrows the two box widths and then takes
as many rows as the terminal will give it, scrolling the field list if that
isn't all of them.

## The digit font

`digits.ts` is a 5 row bitmap font with eleven characters in it, the ten digits
and a colon, which is all a clock ever needs.

```ts
const FONT: Record<string, readonly string[]> = {
  '0': ['###', '# #', '# #', '# #', '###'],
  '1': [' # ', '## ', ' # ', ' # ', '###'],
  ...
  ':': [' ', '#', ' ', '#', ' '],
};
```

Terminal cells are about twice as tall as they are wide, so every font cell
gets drawn `scale` characters across. Two is the shape the font was drawn for
and one is the squashed version, used when the terminal is too narrow to afford
the good one. The glyph itself is a parameter, which is how the same font draws
in `█` or in `#`.

## The two character sets

`glyphs.ts` holds two of everything, a Unicode set and an ASCII one. The
Unicode one looks better. The ASCII one is for fonts and terminals that render
box drawing badly, and for anyone who wants the thing to be literally ASCII.

```
+- pomo --------------------------- focus -+
|                                          |
|      ##    ######      ######  ######    |
|    ####        ##  ##      ##  ##  ##    |
|      ##    ######      ######  ##  ##    |
|      ##        ##  ##  ##      ##  ##    |
|    ######  ######      ######  ######    |
|                                          |
|    =======...........................    |
|                                          |
|  [ pause  ] [ skip ] [ reset ] [ quit ]  |
| oooo round 1/4     click · space s r m q |
+------------------------------------------+
```

`--ascii` picks it, `ascii: true` in the config file makes it your normal, and
the `glyphs` row of the menu flips between them. The menu draws itself in
whichever one is currently selected, so you get a look at the answer before you
leave the screen.

Adding a character to the set means adding it in both places, which the type
enforces. The menu's `‹ › ↑ ↓` all have `< > ^ v` waiting for them on the other
side.

## Resizing

`SIGWINCH` clears the screen, throws away the cached frame and repaints. The
new geometry may want a different tier at a different offset, so trusting
anything already on screen is how you end up with half a box in the corner.
