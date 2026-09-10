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
│ ○○○○ round 1/4     click · space s r m q │
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

Then just `pomo`. That opens a settings menu where you can set the lengths and
everything else, and `enter` starts the timer. If you already know what you
want, pass a flag and it skips straight to the clock.

```bash
pomo --work 50 --break 10 --rounds 3
```

## Using it

Click the buttons. Or if your hands are already on the keyboard:

| key | does |
| --- | --- |
| `space` | pause / resume |
| `s` | skip to the next phase |
| `r` | reset the whole session |
| `m` | open the settings menu |
| `q` | quit (`ctrl-c` too) |

A session is `--rounds` focus blocks with a short break after each one, then a
long break at the end to finish. The dots in the bottom corner keep count. The
clock goes in your terminal's title bar too, so a window behind everything else
still tells you how long is left.

Your settings live in `~/.config/pomo/config.json`, written the first time you
run it. Flags win over the file, for that run only. `pomo --config` tells you
where the file is.

## Docs

The long version is in [`docs/`](docs/).

| page | what's in it |
| --- | --- |
| [Using it](docs/usage.md) | every flag, every key, and what a session actually does |
| [Settings](docs/settings.md) | the config file and the menu that edits it |
| [Layout](docs/layout.md) | the three box sizes, the digit font, the two glyph sets |
| [Colour](docs/colour.md) | the gradient, and how it decides what your terminal can do |
| [Sound](docs/sound.md) | synthesising the jingle, and the desktop notifications |
| [Internals](docs/internals.md) | how the modules fit together, with the reasoning |
| [Hacking on it](docs/hacking.md) | dev setup, the tests, the build |

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
