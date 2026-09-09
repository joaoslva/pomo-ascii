# Idea backlog

Random ideas that can be added to the project

Categorized depending on the effort with:
- **S**: small effort, done in less than an hour
- **M**: a bit more complex, but still manageable. Completed in an afternoon
- **L**: more work to implement, but not necessarily humongous. Definitely needs planning and a bit of thinking beforehand

## 0. Settings menu

The config file part of this is done, `~/.config/pomo/config.json` gets written on
first run and read every run after, with flags still winning for a single run.
What's left is the good half.

A menu before the session starts, showing the current values and letting you
change them without going and finding a JSON file. Rounds, time per round, the
sound mode, the lot. And the same menu reachable during a run, which is what
makes the customization update below actually pleasant instead of being a
config file with extra steps.

The rule I want to keep when this lands: if any flag is passed, skip the menu
and go straight into the timer. Bare `pomo` opens the menu, `pomo -w 50` starts
running. Nobody who already knows what they want should have to click through a
screen to get it, and aliases keep working.

For the menu during execution, we need to decide what happens to the phase that
is currently running when you change its length. I think the sane answer is that
changes only apply to phases that haven't started yet, and the running one keeps
the length it started with, otherwise the clock jumps around under you while you
are looking at it.

This is the real work of the whole page. `render.ts` today is strictly one way,
state goes in and a frame comes out, and a menu needs to track which field has
focus, whether you are editing it, and how to bump a number up and down. It also
needs to write the file back, not just read it, which nothing does yet.

> Workload: **M**

## 1. Customization update

Two main areas targeted here

### Gradients

`gradient.ts` gives a really solid foundation to add more themes. By changing the current `HUES` pair structure into an array of hue stops, we can create a better, more complex interpolation.

Worth doing that reshape before shipping any presets, because once themes exist in the wild changing the shape of one is a breaking change. Two stops stays the normal case, the type just stops forbidding three. And three is genuinely nicer for focus, red into amber into green reads much better than red straight to green.

For starters, 2 or 3 more sets of pre-defined gradients would suffice, then we can create a UI for the user to create their own gradients for the phases that they desire.

Maps with the new menu UI talked about in 0, moving away from having to necessarily memorize and use a lot of flags.

### Jingles

Same philosophy as the gradients. `audio.ts` is really solid, so the work should be straightforward. For starters we can have some pre-made jingles that the user can select aside from the default ones, after that a UI that lets the user create a jingle with a simple syntax, i.e. "C5/90 E5/90 G5/90 C6/260", with -/70 as a rest.

The parser for that syntax is small, note name to hertz is a lookup and a bit of arithmetic, maybe twenty lines. `audio.ts` already says in its header that the notes are plain data on purpose, so nothing in the synth has to move.

This can probably be saved with the config file, or maybe in a different structure? Also same question stands for the gradients, how to store the custom made ones, because the default just ship with the app.

My take on that one, keep them in the same config file under a `themes` and a `jingles` map, keyed by name. The built-in ones stay in code and get merged underneath, so a user entry with the same name just shadows it. One file and one mental model, and sharing a theme with someone is "paste this object". If people ever start actually swapping them around then a directory of separate files starts to make sense, but that is a later problem and an easy move.

One more open question, should a theme carry its own jingle or are they separate axes? I lean separate, since muting sound and picking colours are different decisions and people do one without the other.

> Workload: **M**

## 2. Sidequest update

On a break the timer asks if you want a sidequest, something like "20 pushups?". You have around 30 seconds to answer, otherwise the screen goes back to the normal clock. The break timer never stops while this is happening.

This is the first thing in the app that puts state on screen which isn't session state, so the thing to be careful about is keeping `render.ts` pure. The way that works out nicely is passing an overlay into the view:

```ts
type Overlay =
  | { kind: 'sidequest'; quest: Quest; expiresAt: number }
  | null;
```

`cli.ts` creates it when a break starts and drops it when the answer comes in or `Date.now()` goes past `expiresAt`, and `render` just draws whatever it was handed. The buttons become `[ yes ] [ no ]`, which the existing `ButtonId` union and hit testing already cover, so clicking works without writing anything new.

Things worth deciding before writing it:

Short breaks and long breaks probably want different quest pools. Five minutes and fifteen minutes are not the same offer, so tagging each quest with a pool, or a rough duration, seems right.

It should probably not ask on every single break. Four breaks a session, every session, and answering becomes a reflex instead of a choice. Some kind of frequency knob, a probability or an every-N-breaks, with a way to turn it off.

Don't offer the same quest twice in a row. Cheap to do and it's most of the difference between a list that feels big and one that doesn't.

A break can be shorter than the prompt window, `--break 1 --seconds` is a thing that exists, so clamp the 30 seconds to whatever is actually left.

If you say yes, show it. Putting the quest in the phase label for the rest of the break, something like `break · 20 pushups`, is a small change and it's what makes the whole thing feel like it actually happened instead of being a popup you dismissed.

The quests themselves go in the config file, a list of strings to begin with, moving to objects once they need a pool and a duration.

> Workload: **M**, closer to **L** if the pools and frequency logic go in from the start

## 3. UI companion update

An ASCII tomato that says things, cowsay style.

The real constraint here is width. `FULL` is 44 columns and a tomato with a speech bubble next to it wants something more like 64. Instead of squeezing the current box, the move is to add a `WIDE` tier above `FULL`. The tier system already picks the largest one that fits, so the companion just shows up on terminals big enough for it and everything smaller renders exactly like it does today. No existing layout has to change at all, which is the nice part.

Rough sketch of what it could look like, not a spec:

```
┌─ pomo ──────────────────────────────── focus ─┐
│                                               │
│    ██████   ██████        \|/                 │
│    ██  ██   ██  ██       (•‿•)   ╭──────────╮ │
│    ██████ ▪ ██████    ────      ─┤ halfway. │ │
│                                  ╰──────────╯ │
```

The bit I'd steal from Tamagotchis rather than from cowsay is moods. Idle during focus, sweating in the last couple of minutes, asleep on a break, delighted when the session finishes. That's just a map of mood to frames and it does more for the app's personality than a long list of phrases would.

On the phrases, keying them by event instead of keeping one flat list makes it say something that fits the moment. Phase start, halfway, phase end, session done, idle. Config file supplies the phrases, and the frames too if someone is keen enough to draw their own tomato.

> Workload: **M**

## 4. Smaller ideas

### Session log and stats

Append one JSON line per completed phase to somewhere like `$XDG_DATA_HOME/pomo/log.jsonl`, then `pomo --stats` draws an ASCII bar chart of the week. This is the thing every pomodoro tool grows eventually, it costs maybe sixty lines and no dependencies, and it's the only idea on this page that still means something a month later. Arguably worth doing before the companion.

`--task` already exists and does nothing but get drawn on screen, so writing it into each log line is free and it's what turns the log from a row of numbers into something you'd actually read back.

> Workload: **S/M**

### Resume an interrupted session

Write the session state out on quit and offer `pomo --resume`. The model is already a plain serialisable object with absolute timestamps in it, so it survives a trip to disk and back without lying about how much time passed.

> Workload: **M**

## Done

- Reset resets the whole session instead of just the current phase
- Config file at `~/.config/pomo/config.json`, flags override it per run
- `--task`, shown on the status row
- `--strict`, greys out skip and reset during focus
- Clock in the terminal title bar, `--no-title` to stop it
- Desktop notifications when a phase ends, `--no-notify` to stop them

## Housekeeping

`restartPhase` in `session.ts` has no caller anymore, since the reset button now resets the whole session, which is what reset ought to mean. Leaving it in on purpose, it's pure, it's tested, it costs nothing, and it's the obvious thing to bind if a restart-this-phase key ever earns a spot. If that key never happens, delete it.
