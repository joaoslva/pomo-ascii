# pomo-ascii

[![npm version](https://img.shields.io/npm/v/pomo-ascii.svg)](https://www.npmjs.com/package/pomo-ascii) · [GitHub repo](https://github.com/joaoslva/pomo)

A pomodoro timer made of ASCII that runs in your terminal. Big digits, a colour
gradient, buttons you can actually click, and zero dependencies. Published on
npm as [`pomo-ascii`](https://www.npmjs.com/package/pomo-ascii)

```
┌─ pomo ─────────────────────────── focus ─┐
│                                          │
│      ██    ██████      ██  ██  ██████    │
│    ████    ██      ██  ██  ██  ██  ██    │
│      ██    ██████      ██████  ██  ██    │
│      ██    ██  ██  ██      ██  ██  ██    │
│    ██████  ██████          ██  ██████    │
│                                          │
│    ███████████░░░░░░░░░░░░░░░░░░░░░░░    │
│                                          │
│  [ pause  ] [ skip ] [ reset ] [ quit ]  │
│ ○○○○ round 1/4       click · space s r q │
└──────────────────────────────────────────┘
```

The clock starts red at 25:00 and slides through orange and yellow until it's
green at 00:00. Breaks do the same trip but backwards, blue-green to orange, so
you can tell what mode you're in from across the room without reading anything.

## Running it

```bash
npx pomo-ascii
```

Or keep it around:

```bash
npm install -g pomo-ascii
```

Then just `pomo`.

## Using it

Click the buttons. Or if your hands are already on the keyboard:

| key | does |
| --- | --- |
| `space` | pause / resume |
| `s` | skip to the next phase |
| `r` | restart the current phase |
| `q` | quit (`ctrl-c` too) |

A session is `--rounds` focus blocks with a short break after each one, then a
long break at the end to finish. The dots in the bottom corner keep count.

## Options

```
-w, --work <min>         focus length          (default 25)
-b, --break <min>        short break length    (default 5)
-l, --long-break <min>   long break length     (default 15)
-r, --rounds <n>         focus rounds before the long break (default 4)

    --seconds            read those durations as seconds instead of minutes
    --ascii              plain ASCII instead of box drawing characters
    --no-color           turn colour off (NO_COLOR works too)
    --no-mouse           turn mouse tracking off
    --bell               plain terminal bell instead of the jingle
    --no-sound           silence, no jingle and no bell
```

So if you're a 50/10 person:

```bash
pomo --work 50 --break 10 --rounds 3
```

And if you just want to watch the whole thing happen in under a minute:

```bash
pomo --seconds --work 8 --break 4 --rounds 2
```

## It fits whatever window you've got

The box comes in three sizes and it picks the biggest one your terminal can
hold, re-picking it the moment you drag the window. Nothing stretches — a
progress bar 200 columns wide is not an improvement — so a big terminal just
gets the box centred in it.

At 34×9 the spacing goes, the digits get thin, the round count moves up into the
title bar and the buttons lose their padding:

```
┌─ pomo ───────────── focus 1/4 ─┐
│        █  ███   █ █ ███        │
│       ██  █   █ █ █ █ █        │
│        █  ███   ███ █ █        │
│        █  █ █ █   █ █ █        │
│       ███ ███     █ ███        │
│   █████████░░░░░░░░░░░░░░░░░   │
│ [pause ] [skip] [reset] [quit] │
└────────────────────────────────┘
```

At 16×3 there's no room for a border, never mind a button, so it drops to three
bare lines. The keys still work:

```
16:40      focus
█████░░░░░░░░░░░
1/4    spc s r q
```

Below that there is nothing honest left to draw, so it says so instead:

```
too small
have 12x4
need 16x3
```

## The noise it makes

One terminal bell is easy to miss — plenty of terminals mute it, or turn it
into a flash — which is not much use for telling you a focus block just ended.
So `pomo` synthesises a short jingle instead: a rising four-note run when focus
ends, two lower notes when a break does, and something a bit more pleased with
itself when the whole session is over.

The notes are just data, a list of frequencies and durations, which is the
groundwork for making them yours in a later release. There's still nothing in
`node_modules` — the WAV is generated in memory — but playing it does mean
handing a file to whatever your machine has: `pw-play`, `paplay`, `aplay` or
`ffplay` on Linux, `afplay` on macOS, PowerShell on Windows. The first one that
works is the one it keeps. If none of them do, it falls back to the bell, and
`--bell` picks that on purpose.

## Stuff worth knowing

It runs on the alternate screen, the way `top` and `less` do, so your scrollback
comes back untouched when you quit. What it leaves behind is a single line
telling you what you actually got done:

```
pomo · 3/4 rounds · 1h 15m focused
```

Mouse tracking does steal your text selection while it's running, which is
annoying but it's just how terminals work. Hold `shift` while you drag and you
can select anyway in most of them, or run `--no-mouse` if you'd rather not.

Colour sorts itself out — 24-bit if your terminal advertises it, the 256-colour
palette otherwise, and no colour at all if you pipe it somewhere or set
`NO_COLOR`.

## Poking at it

You need Node 22.18+ to hack on it, because `npm run dev` and `npm test` just
run the TypeScript straight up using Node's built-in type stripping. No build
step, no loader, no `ts-node`. (The published thing is plain JS in `dist/` and
runs on Node 20 fine.) There's a `mise.toml` if you use mise.

Nothing at runtime, and only TypeScript and its types to develop with.

```bash
npm install
npm run dev        # runs from src/, no build
npm test
npm run typecheck
npm run build      # -> dist/
```

Everything except two files is pure functions, which is the whole reason the
tests don't need a terminal or a fake clock or a single mock:

| file | what it does |
| --- | --- |
| `src/session.ts` | the timer, as a state machine |
| `src/render.ts` | state goes in, a frame and some button boxes come out |
| `src/gradient.ts` | turns progress into a colour |
| `src/digits.ts` | the little 5-row font |
| `src/glyphs.ts` | the two character sets |
| `src/config.ts` | flags |
| `src/audio.ts` | synthesises the jingle and finds something to play it |
| `src/terminal.ts` | raw mode, escape codes, mouse, cleanup — all the mess |
| `src/cli.ts` | glues it together, owns the process |

Three things to know before you change anything.

Nothing counts ticks. The session remembers when it last resumed and works out
the rest from `Date.now()`, because intervals drift and laptops go to sleep, and
you don't want a lid closed for an hour to add an hour to your pomodoro. If a
tick shows up late, the overshoot gets rolled into the next phase instead of
being handed to you as free time.

The clickable regions come out of `render()` along with the lines, worked out
from the same numbers that placed the labels. That way the buttons can't end up
somewhere different from where they're drawn.

And every frame is written at an absolute position that `cli.ts` chose, never
relative to wherever the cursor happened to stop. That's what makes a resize
safe: the layout is recomputed, the screen is cleared, and the new frame lands
somewhere known. It's also why clicking works everywhere — the app never has to
ask the terminal where the cursor is.

## Licence

MIT

## Claude

Hello humans, I'm Claude and I helped build this. João brought the idea and the
taste with the gradient, the clickable buttons, the "no React, no 400 dependencies"
and all that clutter. I brought the escape codes and a strong opinion about interpolating hue
instead of RGB, because red-to-green the naive way goes through a colour best
described as wet cardboard.

I could not actually click the buttons from where I was sitting, so if the mouse
doesn't work, that one's on me. 🍅
