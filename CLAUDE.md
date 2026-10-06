# CLAUDE.md

Guidance for working in this repo.

## What this is

`pomo-ascii` — a pomodoro timer that draws big ASCII digits in the terminal,
with a colour gradient, clickable buttons and a synthesised jingle. Published
to npm as `pomo-ascii`, run as `pomo`.

## Hard constraints

**Zero runtime dependencies.** Node builtins only. This is the project's whole
identity, not a nice-to-have — the WAV encoder, the argument parser, the mouse
protocol and the colour handling are all written out by hand rather than
installed. `typescript` and `@types/node` are the only devDependencies. Do not
add a package to solve something that a hundred lines of Node can solve.

**Node version.** Development runs the TypeScript sources directly through
Node's native type stripping, so it needs 22.18+ (mise pins 24). The published
package is plain JS in `dist/` and only needs Node 20. Source files import each
other with `.ts` extensions, which `rewriteRelativeImportExtensions` fixes up at
build time — that is deliberate, don't "correct" it to `.js`.

## Layout

| file | job |
| --- | --- |
| `session.ts` | The timer, as pure functions over a plain object. No I/O, no `Date.now()` — `now` is always a parameter. |
| `menu.ts` | The settings menu model, same idea: fields, which one has focus, what's being typed. Pure. |
| `home.ts` | The start menu model: three items and a pointer. Pure. |
| `render.ts` | State in, frame out. Pure. Draws all three screens and returns the hit boxes for whatever is clickable. |
| `gradient.ts` | Colour: HSL interpolation, ANSI escape codes, terminal capability detection. |
| `audio.ts` | Synthesises a WAV from a list of notes and hands it to whatever can play audio, falling back to the bell. |
| `digits.ts` / `glyphs.ts` | Big digit shapes, and the Unicode/ASCII character sets. |
| `config.ts` | Flag parsing and the help text. |
| `terminal.ts` | Every dirty thing: raw mode, escape codes, mouse tracking, the alternate screen. |
| `cli.ts` | The only file that knows there's a clock ticking and a way to exit. Wires everything together. |

The split is the point. `session.ts` and `render.ts` are pure, which is why
their tests are three lines each. When adding a feature, put the logic in a
pure module and let `cli.ts` own the side effects. If something needs the
current time, take it as an argument.

Two design ideas worth knowing before changing `session.ts`: a session is a
fixed queue of phases built up front, so "skip" is just an index bump; and time
is never counted, it's derived from a stored elapsed total plus the wall-clock
instant of the last resume, which is why sleeping the laptop doesn't break the
clock.

`render.ts` draws at three fixed sizes (`FULL` 44x13, `COMPACT` 34x9, `TINY`
16x3) and `layout()` picks the largest that fits. Frames aren't stretched to
the terminal, they're centred in it.

The app has three screens, the start menu, the timer and the settings menu, and
`cli.ts` holds that fact in two nullable variables: `home` until the timer is
started, and `menu` on top of either while the settings are open. Both menus
borrow the timer's two box widths but size their own height to the terminal.
The settings scroll the field list when they have to, the start menu drops the
big logo instead. Adding a setting to the menu is a line in `FIELDS` in
`menu.ts`, and adding one to the config file is a key in `Stored` plus a check
in `sanitize`.

## Commands

```bash
npm run dev        # run from source
npm run demo       # short phases, for watching it work
npm test           # node --test, 166 tests
npm run typecheck  # tsc against src + test
npm run build      # tsc into dist/
```

Run `typecheck` as well as `test` before calling something done — `npm test`
strips types rather than checking them, so it will happily run code that
doesn't compile.

## Conventions

Comments explain *why*, at the top of a file or above a non-obvious decision,
and they're written in full sentences with a bit of dryness to them. Read a few
before writing any. Don't add comments that restate the code.

TypeScript is strict, including `noUncheckedIndexedAccess`, so indexing an
array gives you `T | undefined` and you have to deal with it.

Tests use `node:test` and `node:assert/strict`, grouped in `describe` blocks by
behaviour. Pure modules get real coverage; anything touching the terminal
mostly doesn't.

## Writing docs

`BACKLOG.md` and `README.md` are written in the owner's voice, and it is
relaxed — first person, "we can" and "I think", prose paragraphs rather than
dense bullet lists, open questions left standing as questions. Match it.

Specifically, avoid the LLM-essay register: don't lean on em-dashes, don't bold
half a sentence for emphasis, don't end paragraphs on a punchy aphorism, and
don't reach for "the thing that matters is…" constructions. Keep the technical
depth, lose the polish. Also, no "-" middle sentences and ":" for non-valid enumerations

## Git

**`main` is protected on GitHub.** Never commit or push to it directly. Work on
a branch, open a PR, let it merge from there. Branch names so far follow
`feat/…` and `fix/…`. `gh` is installed and logged in, so open the PR with
`gh pr create` and hand back its URL.

Don't commit unless asked.
