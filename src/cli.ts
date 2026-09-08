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
import { layout, render, tooSmall, type ButtonId, type Hit } from './render.ts';
import {
  buildPhases,
  completedWorkPhases,
  createSession,
  focusedMs,
  isFinished,
  restartPhase,
  restartSession,
  skip,
  tick,
  toggle,
  totalWorkPhases,
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

/** `50m`, `1h 15m`. Minutes only — nobody wants seconds in a summary. */
function formatDuration(ms: number): string {
  const minutes = Math.round(ms / 60_000);
  if (minutes < 60) return `${minutes}m`;
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
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
  const screen = new Screen({ mouse: config.mouse });

  let session: Session = createSession(buildPhases(durations(config)), Date.now());
  let hovered: ButtonId | null = null;
  let hits: Hit[] = [];
  // Absolute, 1-based position of the frame's top-left cell. The frame is
  // centred, so this is the same arithmetic hit testing has to undo.
  let originRow = 1;
  let originCol = 1;
  let timer: NodeJS.Timeout | null = null;
  let exiting = false;

  const paint = (): void => {
    const now = Date.now();
    const { columns, rows } = screen.size();
    const tier = layout(columns, rows);

    if (!tier) {
      hits = [];
      const lines = tooSmall(columns, rows);
      const width = lines.reduce((max, line) => Math.max(max, line.length), 0);
      screen.draw(lines, center(rows, lines.length), center(columns, width));
      return;
    }

    const frame = render({ session, now, mode, glyphs, hovered, mouse: screen.mouseEnabled, tier });
    hits = frame.hits;
    originRow = center(rows, tier.height);
    originCol = center(columns, tier.width);
    screen.draw(frame.lines, originRow, originCol);
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

  /** What's left behind on the real screen once the alternate one is gone. */
  const summary = (): string => {
    const done = completedWorkPhases(session);
    const total = totalWorkPhases(session);
    return `pomo · ${done}/${total} rounds · ${formatDuration(focusedMs(session, Date.now()))} focused`;
  };

  const shutdown = (): void => {
    if (exiting) return;
    exiting = true;
    if (timer) clearInterval(timer);
    screen.stop(summary());
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
    for (const hit of hits) {
      if (hit.row !== row - originRow) continue;
      if (col >= originCol + hit.col && col < originCol + hit.col + hit.width) return hit.id;
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

  screen.start({ onKey, onMouse, onResize: paint });
  paint();
  timer = setInterval(advance, TICK_MS);
}

/** 1-based coordinate that centres `size` inside `available`. */
function center(available: number, size: number): number {
  return Math.max(1, Math.floor((available - size) / 2) + 1);
}

main();
