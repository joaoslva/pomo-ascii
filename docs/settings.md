# Settings

There are two ways to change how pomo behaves and they are the same settings
underneath. Flags are for right now, the config file is for every run after
this one, and the menu is a way of editing the file without going and finding
it.

## The menu

A bare `pomo` opens it. Pressing `m` while the timer runs opens it again.

```
┌─ pomo ──────────────────────── settings ─┐
│› focus       ‹ 25 min                  › │
│  short break ‹ 5 min                   › │
│  long break  ‹ 15 min                  › │
│  rounds      ‹ 4                       › │
│  sound       ‹ jingle                  › │
│  notify      ‹ on                      › │
│  strict      ‹ off                     › │
│  colour      ‹ on                      › │
│  glyphs      ‹ unicode                 › │
│  mouse       ‹ on                      › │
│  title bar   ‹ on                      › │
│  menu first  ‹ on                      › │
│  focus text    Focus done, take a bre…   │
│  break text    Break over, back to it    │
│  done text     Session complete          │
│       [ start ] [ save ] [ quit ]        │
│ ↑↓ ‹›  space edit · s save · enter start │
└──────────────────────────────────────────┘
```

| key | does |
| --- | --- |
| `↑` `↓` | move between fields, wrapping at both ends |
| `←` `→` | change the focused value |
| `shift` + `←` `→` | change a number by five at a time |
| `0`-`9` | type a number straight in, over whatever was there |
| `space` | edit a message, or flip a switch |
| `enter` | start the timer, or go back to it |
| `esc` | same, and it cancels an edit while you're typing one |
| `s` | save to the config file |
| `q` | quit |

The mouse works too. The `‹` and `›` either side of a value nudge it, clicking
a label moves the focus to that row, and clicking a value does whatever `space`
would have done to it, which means a switch flips on one click and a message
opens for typing.

Fields that aren't switches and aren't lists have no `‹ ›` on them, because
there is nothing to nudge. Those you type into.

The list scrolls when the terminal is too short for all of it, with a `↑` or a
`↓` in the right hand column saying which way there is more. The menu needs 34
columns and 7 rows at an absolute minimum. Below that it says so rather than
drawing you half a list.

`menu first` is the menu asking whether it should keep opening. Turn it off and
a bare `pomo` goes straight to the clock, and `--menu` still brings this screen
back for a single run.

## Saving, or not

`start` and `back` take the values for this run and leave the file alone.
`save` writes them. That split is on purpose, since trying out a 50 minute
block is not the same act as deciding that you are a 50 minute person now.

The header says `settings · edited` while the menu is holding something the
file hasn't got, and `settings · saved` for a moment after a write. The `save`
button greys out when there is nothing to save, because the file is the only
thing on this screen you can't undo by walking away.

## Changing things mid-session

Everything on the menu applies the moment you go back to the timer, sound and
the mouse and the title bar included. Colour and glyphs go one better and
redraw the menu itself as you change them, so you can see what ASCII mode looks
like before you commit to it.

Durations are the interesting case. The rule is that a change reaches the
phases that haven't started yet, and the one you are in keeps the length it
started with. Changing the focus length at minute twelve of a focus block does
not make the number on screen jump, it makes the next focus block the new
length. A timer that rewrites the clock in front of you is a timer you stop
believing.

Rounds work the same way, and moving them moves the long break with them, since
the long break is defined as the one that replaces the last short break. The
whole thing is a five line function in `session.ts`:

```ts
export function reshape(s: Session, d: PhaseDurations): Session {
  const rebuilt = buildPhases(d);
  if (isFinished(s)) return { ...s, phases: rebuilt, index: rebuilt.length };
  return { ...s, phases: [...s.phases.slice(0, s.index + 1), ...rebuilt.slice(s.index + 1)] };
}
```

Cutting the rounds down below where you already are doesn't strand you. The
phase you're in still finishes, there just isn't anything after it. Changing
the settings once the session is over swaps the queue out wholesale, so the
`again` button starts the session you just described rather than the one you
finished.

## The config file

It lands in `~/.config/pomo/config.json`, or wherever `XDG_CONFIG_HOME` points
if you have that set. `pomo --config` prints the path.

It gets written with the defaults the first time pomo runs, which means the
file documents its own format and you never have to look up a key name:

```json
{
  "work": 25,
  "shortBreak": 5,
  "longBreak": 15,
  "rounds": 4,
  "color": true,
  "ascii": false,
  "mouse": true,
  "sound": "jingle",
  "strict": false,
  "title": true,
  "notify": true,
  "menu": true,
  "messages": {
    "focus": "Focus done, take a break",
    "break": "Break over, back to it",
    "done": "Session complete"
  }
}
```

Edit it by hand or from the menu, whichever you feel like. Saving from the menu
keeps any keys in there that pomo doesn't recognise, so a half finished
experiment of your own survives a save.

`--task` deliberately isn't in there. It's about right now, not about how you
like your timer, so it stays a flag.

## Precedence

Flag, then file, then the built in default. Nothing surprising.

```ts
const parsed = parseConfig(process.argv.slice(2), { ...DEFAULTS, ...load() });
```

Every switch the file can turn on has a `--no-` flag to turn it back off for
one run, and the two that are off by default have a plain flag to turn them on.
So the file is your normal, and the flags are the exception you make today.

## Nothing in there is load-bearing

A file that can't be read is treated as a file that isn't there. A value of the
wrong type gets dropped and the other ten still apply, so a typo in one key
costs you that key and nothing else. Writing the starter file is best effort as
well, since a read only home directory is a perfectly fine place to run a
pomodoro timer. It should never be the reason a timer won't start.

```ts
for (const key of NUMERIC_KEYS) {
  const value = source[key];
  if (typeof value === 'number' && Number.isInteger(value) && value > 0) out[key] = value;
}
```

Unknown keys are left alone rather than reported. The file is meant to be
edited by hand and an experiment in there is not an error.

## The notification wording

`messages` is what the desktop notification says at the end of each kind of
phase. Change them in the file or on the last three rows of the menu, and they
are one string each rather than a list to pick from at random.

What pomo adds to your wording is the stuff that is a fact rather than a
phrasing. The task, when you passed `--task`, gets appended, and the last
notification of a session carries the round count.

```
Focus done, take a break — write the parser
Session complete · 4/4 rounds — write the parser
```

A message is capped at 60 characters, trimmed, and can't be empty, since an
empty notification is a notification you can't read. Deleting the lot in the
menu and pressing `enter` leaves the old wording where it was.
