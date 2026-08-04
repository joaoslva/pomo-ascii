#!/usr/bin/env node
/**
 * Entry point: parse flags, wire the pure pieces to the terminal, own the
 * process lifetime. This is the only file that knows the app has a clock
 * ticking and a way to exit.
 */

import { readFileSync } from 'node:fs';

import { durations, HELP, parseConfig } from './config.ts';
import { detectColorMode, type ColorMode } from './gradient.ts';
import { glyphSet } from './glyphs.ts';
import { FRAME_HEIGHT, FRAME_WIDTH, render, tooNarrow, type ButtonId, type Hit } from './render.ts';
import {
  buildPhases,
  createSession,
  isFinished,
  restartPhase,
  restartSession,
  skip,
  tick,
  toggle,
  type Session,
} from './session.ts';
import { Screen, type MouseEvent } from './terminal.ts';

/** Fast enough that a keypress feels instant, slow enough to cost nothing. */
const TICK_MS = 200;

function version(): string {
  try {
    const raw = readFileSync(new URL('../package.json', import.meta.url), 'utf8');
    return (JSON.parse(raw) as { version?: string }).version ?? '0.0.0';
  } catch {
    return '0.0.0';
  }
}

function main(): void {
  const parsed = parseConfig(process.argv.slice(2));

  if (parsed.kind === 'help') {
    process.stdout.write(HELP);
    return;
  }
  if (parsed.kind === 'version') {
    process.stdout.write(`${version()}\n`);
    return;
  }
  if (parsed.kind === 'error') {
    process.stderr.write(`pomo: ${parsed.message}\n\nTry: pomo --help\n`);
    process.exitCode = 1;
    return;
  }

  const config = parsed.config;

  if (!process.stdout.isTTY || !process.stdin.isTTY) {
    process.stderr.write('pomo: needs an interactive terminal (stdin and stdout must be a TTY)\n');
    process.exitCode = 1;
    return;
  }

  const mode: ColorMode = config.color ? detectColorMode() : 'none';
  const glyphs = glyphSet(config.ascii);
  const screen = new Screen({ height: FRAME_HEIGHT, mouse: config.mouse });

  let session: Session = createSession(buildPhases(durations(config)), Date.now());
  let hovered: ButtonId | null = null;
  let hits: Hit[] = [];
  let timer: NodeJS.Timeout | null = null;
  let exiting = false;

  const paint = (): void => {
    const now = Date.now();

    if ((process.stdout.columns ?? 80) < FRAME_WIDTH) {
      hits = [];
      screen.draw(tooNarrow(process.stdout.columns ?? 0));
      return;
    }

    const frame = render({ session, now, mode, glyphs, hovered, mouse: screen.mouseEnabled });
    hits = frame.hits;
    screen.draw(frame.lines);
  };

  const advance = (): void => {
    const result = tick(session, Date.now());
    session = result.session;
    if (result.completed.length > 0 && config.bell) screen.bell();
    paint();
  };

  const act = (id: ButtonId): void => {
    const now = Date.now();
    switch (id) {
      case 'toggle':
        session = isFinished(session) ? restartSession(session, now) : toggle(session, now);
        break;
      case 'skip':
        session = skip(session, now);
        break;
      case 'restart':
        session = isFinished(session)
          ? restartSession(session, now)
          : restartPhase(session, now);
        break;
      case 'quit':
        shutdown();
        return;
    }
    paint();
  };

  const shutdown = (): void => {
    if (exiting) return;
    exiting = true;
    if (timer) clearInterval(timer);
    // One last frame so the finished state is what stays in the scrollback.
    paint();
    screen.stop();
    process.exit(0);
  };

  const onKey = (key: string): void => {
    switch (key) {
      case ' ':
        act('toggle');
        break;
      case 's':
      case 'S':
        act('skip');
        break;
      case 'r':
      case 'R':
        act('restart');
        break;
      case 'q':
      case 'Q':
      case '\x03': // ctrl-c: raw mode delivers it as a byte, not a signal
      case '\x04': // ctrl-d
        shutdown();
        break;
    }
  };

  const hitTest = (row: number, col: number): ButtonId | null => {
    const origin = screen.originRow;
    if (origin === null) return null;
    const localRow = row - origin;
    for (const hit of hits) {
      if (hit.row !== localRow) continue;
      if (col >= hit.col + 1 && col < hit.col + 1 + hit.width) return hit.id;
    }
    return null;
  };

  const onMouse = (event: MouseEvent): void => {
    const target = hitTest(event.row, event.col);

    if (event.kind === 'move') {
      if (target !== hovered) {
        hovered = target;
        paint();
      }
      return;
    }

    if (event.kind === 'press' && event.button === 0 && target) {
      hovered = target;
      act(target);
    }
  };

  process.on('SIGTERM', shutdown);
  process.on('SIGHUP', shutdown);
  process.on('exit', () => screen.stop());

  void screen.start({ onKey, onMouse, onResize: paint }).then(() => {
    paint();
    timer = setInterval(advance, TICK_MS);
  });
}

main();
