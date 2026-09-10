# Internals

Zero runtime dependencies, and that isn't a boast about bundle size. The WAV
encoder, the argument parser, the mouse protocol and the colour handling are
written out by hand because each of them is a hundred lines of Node and a
hundred lines you can read beats a package you can't.

## The modules

| file | job |
| --- | --- |
| `session.ts` | the timer, as pure functions over a plain object |
| `menu.ts` | the settings menu model, same idea |
| `render.ts` | state in, frame out, plus the hit boxes for anything clickable |
| `gradient.ts` | HSL interpolation, ANSI escape codes, terminal capability detection |
| `audio.ts` | synthesises a WAV from a list of notes and finds something to play it |
| `notify.ts` | hands the end of a phase to the desktop |
| `digits.ts`, `glyphs.ts` | the 5 row font, and the two character sets |
| `config.ts` | flag parsing and the help text |
| `settings.ts` | the config file, read, written and sanitised |
| `terminal.ts` | every dirty thing, raw mode, escape codes, mouse tracking, the alternate screen |
| `cli.ts` | the only file that knows there's a clock ticking and a way to exit |

The split is the point rather than an accident of growth. `session.ts`,
`menu.ts` and `render.ts` are pure, which is why their tests need no terminal,
no fake clock and not a single mock. When something new goes in, the logic
belongs in a pure module and `cli.ts` owns the side effects. Anything that
needs the current time takes it as an argument.

## Time is never counted

The session model is the first of two ideas worth understanding before changing
anything.

```ts
export type Session = {
  readonly phases: readonly Phase[];
  index: number;
  elapsedBefore: number;
  runningSince: number | null;
};
```

Nothing counts ticks. The session remembers how much time was banked before the
last resume plus the wall clock instant of that resume, and derives everything
else from `now`.

```ts
export function elapsedMs(s: Session, now: number): number {
  const live = s.runningSince === null ? 0 : Math.max(0, now - s.runningSince);
  return s.elapsedBefore + live;
}
```

Intervals drift, and laptops go to sleep. Counting would mean a lid closed for
an hour either adds an hour to your pomodoro or loses it, depending on which
way you got it wrong. Deriving means the clock lands right no matter what
happened in between.

The same idea covers a slow tick. If a phase is 400ms overdue by the time we
look, the overshoot is rolled into the next phase instead of being handed to
you as free time, and `tick` returns every phase that ended rather than one,
because a long sleep can blow through several.

```ts
completed.push(phase);
session = {
  ...session,
  index: next,
  elapsedBefore: 0,
  runningSince: next >= session.phases.length ? null : now - overshoot,
};
```

## A session is a queue built up front

The second idea. `buildPhases` produces the whole list before anything starts,
work and break alternating, with the long break in the last slot instead of a
short one. Skip is then an index bump, and nothing anywhere needs an `isBreak`
flag or a state machine.

It's also what makes changing the settings mid-session tractable. Splicing a
freshly built queue onto the part you've already lived through is the entire
implementation, and [Settings](settings.md) has the details.

## State in, frame out

`render.ts` takes a `ViewState` and returns lines. No I/O, no timers, no
globals, no reading the clock. Everything it needs, including `now`, arrives as
a field.

It also returns the hit boxes for the clickable regions, and those come out of
the same arithmetic that placed the labels:

```ts
hits.push({ id: button.id, row: options.row, col: cursor, width: label.length });
```

Which means a button can't drift out of sync with the region that clicks it,
because there is no second calculation to get wrong. When a button is disabled
it is dimmed and left out of the hits together, so nothing on screen looks live
while doing nothing.

`cli.ts` undoes the centring to test a click, using the same origin it drew at:

```ts
function hitTest<Id>(boxes: readonly Hit<Id>[], row: number, col: number): Id | null {
  for (const hit of boxes) {
    if (hit.row !== row - originRow) continue;
    if (col >= originCol + hit.col && col < originCol + hit.col + hit.width) return hit.id;
  }
  return null;
}
```

`Hit` is generic over its id because the two screens point at different things.
The timer's hits carry a `ButtonId`, the menu's carry a `MenuTarget` saying
which row and which part of it.

## Two screens

The app has a timer and a settings menu, and the whole of that fact is one
nullable variable in `cli.ts`. When `menu` is null you're on the timer.
Painting, keys and the mouse each check it once and go their separate ways.

The clock keeps running underneath either screen. A break you spend changing
settings is still a break, and the phase change still fires its jingle while
you're in there.

`menu.ts` is modelled the same way as the session. A list of field
descriptions, an index saying which one has focus, and a draft string that is
non-null exactly while you're typing into a value.

```ts
export type Field =
  | { kind: 'number'; key: NumberKey; label: string; min: number; max: number; unit: boolean }
  | { kind: 'choice'; key: 'sound'; label: string; options: readonly SoundMode[] }
  | { kind: 'flag'; key: FlagKey; label: string; on: string; off: string }
  | { kind: 'text'; key: MessageKey; label: string };
```

The fields are described rather than coded, so adding a setting to the menu is
a line in `FIELDS` and nothing else. Everything that reads a value goes through
`display()` and everything that changes one goes through `step()`, `write()` or
`commit()`, all of which switch on `kind` in one place each.

Which slice of the list is on screen is a function of the focused index alone,
so nothing has to remember where the list was scrolled to:

```ts
export function menuWindow(index: number, visible: number, total: number): number {
  if (total <= visible) return 0;
  const centred = index - Math.floor((visible - 1) / 2);
  return Math.min(Math.max(0, centred), total - visible);
}
```

## Absolute positioning, and why

Drawing happens on the alternate screen, the way `top` and `less` do. That
costs the frozen box in your scrollback, which `stop` makes up for with a one
line summary, and what it buys back is that every frame is written at an
absolute position that `cli.ts` chose:

```ts
out += `${ESC}[${originRow + i};${originCol}H${CLEAR_RIGHT}${lines[i] ?? ''}`;
```

Never relative to wherever the cursor happened to stop. That is what makes a
resize safe, since the layout is recomputed, the screen cleared and the new
frame lands somewhere known. It's also why clicking works, because the app
knows exactly where the frame sits and never has to ask the terminal where the
cursor is.

Identical frames are dropped before anything is written, which matters when you
repaint five times a second.

## Reading the keyboard and the mouse

Raw mode means input arrives as bytes and it's on us to make sense of them.
`terminal.ts` keeps a buffer and chews through it, longest match first.

Mouse events come in SGR form, `ESC [ < flags ; col ; row M`, which is enabled
rather than assumed because the older encoding caps out at column 223. Mode
1003 asks for motion as well as clicks, which is what lets a button highlight
on hover.

Named keys are a lookup table, and handlers get either a single character or a
name like `up`. Since every name is longer than one character the two can never
be confused, which keeps the handler in `cli.ts` a plain switch.

```ts
const NAMED_KEYS: Record<string, string> = {
  '\x1b[A': 'up', '\x1bOA': 'up',
  '\x1b[B': 'down', '\x1bOB': 'down',
  ...
};
```

Both encodings of the arrows are in there, since terminals send `ESC [ A`
normally and `ESC O A` in application cursor mode, and which you get depends on
the terminal rather than on anything we asked for.

The escape key is the awkward one. A lone `ESC` is either the escape key or the
first byte of a sequence still in flight, and the only way to tell is to wait a
moment. Forty milliseconds, and any byte arriving cancels the wait.

Everything gets put back on the way out. Mouse tracking off, the title popped
off the terminal's own stack, wrapping and the cursor restored, alternate
screen left. `stop` is also wired to `process.on('exit')`, so a crash doesn't
leave your terminal in raw mode with no cursor.

## Where to put a new feature

Model in a pure module, drawing in `render.ts`, side effects in `cli.ts`. If
you find yourself reaching for `Date.now()` outside `cli.ts`, take it as an
argument instead, and if you find yourself writing to stdout outside
`terminal.ts`, don't.
