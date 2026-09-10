# Using it

## Starting it

```bash
npx pomo-ascii          # no install
npm install -g pomo-ascii && pomo
```

A bare `pomo` opens the [settings menu](settings.md) first, so you can set the
lengths without remembering a single flag. Press `enter` and the timer starts.

Pass any flag and the menu gets out of your way, because you have already said
what you want:

```bash
pomo -w 50 -b 10 -r 3
```

That rule is what keeps aliases working. `alias focus='pomo -w 50 -t code'`
lands you on the clock, not on a screen to click through. If you want the menu
anyway, `--menu` asks for it explicitly, and `--no-menu` skips it even on a
bare run.

## What a session is

`--rounds` focus blocks, with a short break after each one, and a long break at
the end instead of the last short one. The default is the classic 25 and 5,
four rounds, with 15 at the end.

```
focus  break  focus  break  focus  break  focus  long break
```

The dots along the bottom of the box fill in as you finish focus blocks, so a
glance tells you how far in you are. Past twelve rounds the dots stop being
countable and get dropped, leaving the `round 3/20` text to do the work.

## Keys and clicks

| key | does |
| --- | --- |
| `space` | pause and resume |
| `s` | skip to the next phase |
| `r` | reset the whole session |
| `m` | open the settings menu |
| `q` | quit, and so does `ctrl-c` |

Every button on screen is clickable, and it lights up when you hover it. Reset
means the whole session, not the phase you are in, because that is what reset
ought to mean when you have walked away from your desk for an hour.

Mouse tracking does steal your text selection while it runs, which is annoying
but it is just how terminals work. Hold `shift` while you drag and you can
select anyway in most of them, or run `--no-mouse` if you would rather not have
it at all.

## Every flag

```
-w, --work <min>         focus length          (default 25)
-b, --break <min>        short break length    (default 5)
-l, --long-break <min>   long break length     (default 15)
-r, --rounds <n>         focus rounds before the long break (default 4)
-t, --task <text>        what you're working on, shown while it runs

    --seconds            read those durations as seconds instead of minutes
    --strict             no skip and no reset while you're in a focus phase
    --ascii              plain ASCII instead of box drawing characters
    --bell               plain terminal bell instead of the jingle
    --no-sound           silence, no jingle and no bell
    --no-color           turn colour off (NO_COLOR works too)
    --no-mouse           turn mouse tracking off
    --no-title           don't put the clock in the terminal title bar
    --no-notify          don't send desktop notifications
    --no-ascii           --no-strict          undo any of the above

    --menu               open the settings menu, even alongside other flags
    --no-menu            start the timer straight away
    --config             print where the config file lives
-h, --help               show the help
-v, --version            print the version
```

Durations have to be positive whole numbers. Anything else is an error with a
message rather than a silently ignored flag, on the grounds that `--work abc`
is a typo you want to hear about.

`--seconds` is there for demos and for testing. `npm run demo` is nothing but
`--seconds --work 8 --break 4 --rounds 2`, which runs a whole session in under
a minute and is the fastest way to watch a phase change happen.

## Being strict with yourself

`--strict` greys out skip and reset for as long as a focus phase is running.
Pausing still works, and breaks are left alone, since a break is nobody's test
of willpower. It's a small thing but it turns the buttons from something you
can reach for at minute three into something that isn't there.

The buttons are dimmed and unclickable together. A button that looks live and
does nothing is worse than one that admits it's off.

The settings menu still opens under `--strict`, and you can still change the
focus length from it. That isn't a hole in the rule, because a change only
reaches phases that haven't started yet, so the block you are currently sitting
in keeps the length it started with either way.

## What it leaves behind

It runs on the alternate screen, the way `top` and `less` do, so your
scrollback comes back untouched when you quit. What it leaves behind is a
single line telling you what you actually got done:

```
pomo · 3/4 rounds · 1h 15m focused
```

The first time it runs it also mentions that it wrote a config file, once, on
the way out. A file appearing in your home directory without anyone saying so
is a small rudeness.
