# Hacking on it

## Getting it running

```bash
git clone https://github.com/joaoslva/pomo-ascii
cd pomo-ascii
npm install
npm run dev
```

You need Node 22.18 or newer to work on it, because `npm run dev` and `npm
test` run the TypeScript straight up using Node's built in type stripping. No
build step, no loader, no `ts-node`. The published package is plain JS in
`dist/` and runs on Node 20 fine. There's a `mise.toml` if you use mise, and it
pins 24.

`npm install` pulls TypeScript and its types. Nothing else, and nothing at all
at runtime.

## The commands

```bash
npm run dev        # run from source
npm run demo       # short phases, for watching it work
npm test           # node --test, 155 tests
npm run typecheck  # tsc against src and test
npm run build      # tsc into dist/
```

Run `typecheck` as well as `test` before calling something done. `npm test`
strips types rather than checking them, so it will happily run code that
doesn't compile.

`npm run demo` is the one you want while working on anything that happens at a
phase change. It's `--seconds --work 8 --break 4 --rounds 2`, so a whole
session including the jingles takes under a minute.

## The imports look wrong and aren't

Source files import each other with `.ts` extensions.

```ts
import { buildPhases, type Session } from './session.ts';
```

That's what lets Node run the sources directly, and `rewriteRelativeImportExtensions`
turns them into `.js` at build time. It is deliberate, so please don't correct
it.

## Tests

`node:test` and `node:assert/strict`, grouped in `describe` blocks by
behaviour rather than by function name.

```ts
it('leaves the phase you are watching at the length it started with', () => {
  const session = reshape(createSession(buildPhases(DURATIONS), T0), shorter);
  assert.equal(currentPhase(session)?.seconds, 25 * 60);
  assert.equal(session.phases[1]?.seconds, 60);
});
```

The pure modules get real coverage, and anything that touches the terminal
mostly doesn't. That isn't laziness so much as the reason the code is split the
way it is. A fixed clock is a constant, `T0`, passed in as an argument, and
frames are asserted against with the escape codes stripped:

```ts
const ANSI = /\x1b\[[\d;]*m/g;
const strip = (s: string) => s.replace(ANSI, '');
```

Anything you can test without a terminal, test without a terminal.

## Adding a setting

The most common change, and it wants four small edits.

1. A key on `Config` and a value in `DEFAULTS`, in `config.ts`
2. A flag in `parseConfig` and a line in `HELP`, if it deserves one
3. The key in `Stored` and in `STORED_KEYS`, plus whichever check in
   `sanitize` matches its type, in `settings.ts`
4. A line in `FIELDS`, in `menu.ts`, so it shows up in the menu

Then use it. Anything the renderer needs goes on `ViewState`, and anything the
process needs stays in `cli.ts`.

## Conventions

Comments explain why, not what. They go at the top of a file or above a
decision that isn't obvious, and they're written as sentences. Read a few
before you write any, and don't add ones that restate the code.

TypeScript is strict, including `noUncheckedIndexedAccess`, so indexing an
array gives you `T | undefined` and you have to deal with it. That's how the
render code ends up with `?? ''` in places, and it's worth the noise.

If you're adding something that needs a package, look again. The whole identity
of this project is that it doesn't have any.

## Publishing

`npm run build` compiles into `dist/`, `prepublishOnly` runs it for you, and
`files` in `package.json` means only `dist/` ships.

`main` is protected. Work on a branch, open a pull request, let it merge from
there.
