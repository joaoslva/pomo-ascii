# pomo-ascii

[![npm version](https://img.shields.io/npm/v/pomo-ascii.svg)](https://www.npmjs.com/package/pomo-ascii) · [GitHub repo](https://github.com/joaoslva/pomo)

A pomodoro timer made of ASCII that runs in your terminal. Big digits, a colour
gradient, buttons you can actually click, and zero dependencies. Published on
npm as [`pomo-ascii`](https://www.npmjs.com/package/pomo-ascii)

```
┌─ pomo ─────────────────────────── focus ─┐
│                                          │
│      ██    ██████      ██████  ██████    │
│    ████    ██      ██  ██  ██  ██  ██    │
│      ██    ██████      ██  ██  ██  ██    │
│      ██        ██  ██  ██  ██  ██  ██    │
│    ██████  ██████      ██████  ██████    │
│                                          │
│    ██████████████░░░░░░░░░░░░░░░░░░░░    │
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
    --no-bell            stop it dinging between phases
```

So if you're a 50/10 person:

```bash
pomo --work 50 --break 10 --rounds 3
```

And if you just want to watch the whole thing happen in under a minute:

```bash
pomo --seconds --work 8 --break 4 --rounds 2
```

## Stuff worth knowing

It just draws in place. No fancy premium game-like screen buffer, no wiping your
scrollback — the terminal updates some characters and that's pretty much it.
When you quit, the last frame stays where it was, like any other command.

Mouse tracking does steal your text selection while it's running, which is
annoying but it's just how terminals work. Hold `shift` while you drag and you
can select anyway in most of them, or run `--no-mouse` if you'd rather not.

Some terminals won't tell the app where the cursor is, and without that a click
can't be matched to a button. Rather than guessing and having your clicks land
on the wrong thing, it quietly falls back to keyboard only. You'll know because
the hint at the bottom says `keys` instead of `click`.

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
| `src/terminal.ts` | raw mode, escape codes, mouse, cleanup — all the mess |
| `src/cli.ts` | glues it together, owns the process |

Two things to know before you change anything.

Nothing counts ticks. The session remembers when it last resumed and works out
the rest from `Date.now()`, because intervals drift and laptops go to sleep, and
you don't want a lid closed for an hour to add an hour to your pomodoro. If a
tick shows up late, the overshoot gets rolled into the next phase instead of
being handed to you as free time.

And the clickable regions come out of `render()` along with the lines, worked
out from the same numbers that placed the labels. That way the buttons can't
end up somewhere different from where they're drawn.

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
