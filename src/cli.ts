#!/usr/bin/env node
/**
 * Entry point: parse flags, wire the pure pieces to the terminal, own the
 * process lifetime. This is the only file that knows the app has a clock
 * ticking and a way to exit.
 *
 * There are two screens, the timer and the settings menu, and this file is
 * where that fact lives: `menu` being non-null is the whole of it. The clock
 * keeps running underneath either one, because a break you spend changing
 * settings is still a break.
 */

import { readFileSync } from 'node:fs';

import { Chime, JINGLES } from './audio.ts';
import { DEFAULTS, durations, HELP, parseConfig, type Config } from './config.ts';
import { detectColorMode, type ColorMode } from './gradient.ts';
import { glyphSet, type GlyphSet } from './glyphs.ts';
import {
  activate,
  backspace,
  cancel,
  commit,
  createMenu,
  focus,
  isEditing,
  markSaved,
  move,
  step,
  write,
  type Menu,
} from './menu.ts';
import { Notifications } from './notify.ts';
import {
  COMPACT,
  layout,
  MENU_CHROME,
  menuLayout,
  render,
  renderMenu,
  tooSmall,
  type ButtonId,
  type Hit,
  type MenuButtonId,
  type MenuTarget,
} from './render.ts';
import {
  buildPhases,
  completedWorkPhases,
  createSession,
  currentPhase,
  focusedMs,
  formatClock,
  isFinished,
  isRunning,
  remainingMs,
  reshape,
  restartSession,
  skip,
  tick,
  toggle,
  totalWorkPhases,
  type Phase,
  type Session,
} from './session.ts';
import { configPath, ensure, load, save, toStored, type Stored } from './settings.ts';
import { Screen, type MouseEvent } from './terminal.ts';

/** Fast enough that a keypress feels instant, slow enough to cost nothing. */
const TICK_MS = 200;

/** The smallest menu worth drawing: two columns short of the compact box. */
const MENU_MIN = { width: COMPACT.width, height: MENU_CHROME + 3 };

/** The three things that get announced, which is also how the jingles are keyed. */
type Event = 'focus' | 'break' | 'done';

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
  // The file supplies the defaults; every flag then overrides them for this
  // run only. Reading it can't fail loudly, so nothing here needs guarding.
  const stored = load();
  const parsed = parseConfig(process.argv.slice(2), { ...DEFAULTS, ...stored });

  if (parsed.kind === 'help') {
    process.stdout.write(HELP);
    return;
  }
  if (parsed.kind === 'version') {
    process.stdout.write(`${version()}\n`);
    return;
  }
  if (parsed.kind === 'config-path') {
    process.stdout.write(`${configPath()}\n`);
    return;
  }
  if (parsed.kind === 'error') {
    process.stderr.write(`pomo: ${parsed.message}\n\nTry: pomo --help\n`);
    process.exitCode = 1;
    return;
  }

  let config: Config = parsed.config;

  if (!process.stdout.isTTY || !process.stdin.isTTY) {
    process.stderr.write('pomo: needs an interactive terminal (stdin and stdout must be a TTY)\n');
    process.exitCode = 1;
    return;
  }

  // Only once we know we're actually running: `--help` shouldn't leave a file
  // behind in someone's home directory.
  const created = ensure();

  // Asked once. Whether colour is wanted changes, what the terminal can do
  // doesn't.
  const capability = detectColorMode();
  let mode: ColorMode = config.color ? capability : 'none';
  let glyphs: GlyphSet = glyphSet(config.ascii);
  const screen = new Screen({ mouse: config.mouse, title: config.title });
  const chime = new Chime(() => screen.bell());
  const notifications = new Notifications();

  /** What the file holds, so the menu can tell you what it hasn't saved yet. */
  let savedValues: Stored = { ...toStored(DEFAULTS), ...stored };

  // The menu, when it's open, and whether the timer has been started at all —
  // which is the difference between a `start` button and a `back` one.
  let menu: Menu | null = null;
  let started = !parsed.menu;
  let note: string | null = null;

  // A session exists from the first frame either way. It just doesn't run
  // until the menu is out of the way, so the clock sits at its full length.
  let session: Session = createSession(buildPhases(durations(config)), Date.now(), started);
  if (parsed.menu) menu = openMenu();

  let hovered: ButtonId | null = null;
  let menuHovered: MenuButtonId | null = null;
  let hits: Hit[] = [];
  let menuHits: Hit<MenuTarget>[] = [];
  // Absolute, 1-based position of the frame's top-left cell. The frame is
  // centred, so this is the same arithmetic hit testing has to undo.
  let originRow = 1;
  let originCol = 1;
  let timer: NodeJS.Timeout | null = null;
  let exiting = false;

  function openMenu(): Menu {
    return createMenu(toStored(config), savedValues, config.seconds);
  }

  const paint = (): void => {
    const now = Date.now();
    screen.title(titleText(now));

    const { columns, rows } = screen.size();
    if (menu) {
      paintMenu(menu, columns, rows);
      return;
    }

    const tier = layout(columns, rows);
    if (!tier) {
      hits = [];
      paintTooSmall(columns, rows);
      return;
    }

    const frame = render({
      session,
      now,
      mode,
      glyphs,
      hovered,
      mouse: screen.mouseEnabled,
      task: config.task,
      strict: config.strict,
      tier,
    });
    hits = frame.hits;
    originRow = center(rows, tier.height);
    originCol = center(columns, tier.width);
    screen.draw(frame.lines, originRow, originCol);
  };

  const paintMenu = (open: Menu, columns: number, rows: number): void => {
    const tier = menuLayout(columns, rows, open.fields.length);
    if (!tier) {
      menuHits = [];
      paintTooSmall(columns, rows, MENU_MIN);
      return;
    }

    // The menu draws itself with its own values rather than the ones in force,
    // so turning colour off or switching to ASCII shows you the answer while
    // you're still deciding.
    const frame = renderMenu({
      menu: open,
      mode: open.values.color ? capability : 'none',
      glyphs: glyphSet(open.values.ascii),
      hovered: menuHovered,
      primary: started ? 'back' : 'start',
      note,
      tier,
    });
    menuHits = frame.hits;
    originRow = center(rows, tier.height);
    originCol = center(columns, tier.width);
    screen.draw(frame.lines, originRow, originCol);
  };

  const paintTooSmall = (columns: number, rows: number, need?: typeof MENU_MIN): void => {
    const lines = tooSmall(columns, rows, need);
    const width = lines.reduce((max, line) => Math.max(max, line.length), 0);
    screen.draw(lines, center(rows, lines.length), center(columns, width));
  };

  /** `24:13 · focus`, for a terminal that's behind another window. */
  const titleText = (now: number): string => {
    if (menu) return 'pomo · settings';
    if (isFinished(session)) return 'pomo · done';
    const clock = formatClock(remainingMs(session, now));
    const kind = currentPhase(session)?.kind;
    const label = !isRunning(session) ? 'paused' : kind === 'work' ? 'focus' : 'break';
    return `${clock} · ${label}`;
  };

  /** Focus ending and a break ending are different events; they sound it. */
  const announce = (completed: readonly Phase[]): void => {
    if (completed.length === 0) return;

    const name: Event = isFinished(session)
      ? 'done'
      : completed[completed.length - 1]!.kind === 'work'
        ? 'focus'
        : 'break';

    if (config.sound === 'bell') screen.bell();
    else if (config.sound !== 'off') chime.play(name, JINGLES[name]!);

    if (config.notify) notifications.send('pomo', notice(name));
  };

  /**
   * What the desktop notification says. The wording is yours, from the config
   * file or the menu; the round count on the last one is ours, because that
   * bit is a fact rather than a phrasing.
   */
  const notice = (name: Event): string => {
    const suffix = config.task === '' ? '' : ` — ${config.task}`;
    const text = config.messages[name];
    if (name !== 'done') return `${text}${suffix}`;
    const total = totalWorkPhases(session);
    return `${text} · ${total}/${total} rounds${suffix}`;
  };

  /**
   * Strict mode bites only while focus is actually running — the same rule the
   * greyed-out buttons are drawn from, so the screen can't promise otherwise.
   */
  const locked = (): boolean =>
    config.strict &&
    !isFinished(session) &&
    currentPhase(session)?.kind === 'work' &&
    isRunning(session);

  const advance = (): void => {
    const result = tick(session, Date.now());
    session = result.session;
    announce(result.completed);
    paint();
  };

  const act = (id: ButtonId): void => {
    const now = Date.now();
    switch (id) {
      case 'toggle':
        session = isFinished(session) ? restartSession(session, now) : toggle(session, now);
        break;
      case 'skip':
        if (locked()) return;
        session = skip(session, now);
        break;
      case 'restart':
        if (locked()) return;
        session = restartSession(session, now);
        break;
      case 'quit':
        shutdown();
        return;
    }
    paint();
  };

  // ── the menu ─────────────────────────────────────────────────────────────

  /**
   * Takes the menu's values for this run and puts the screen back in step with
   * them. Durations reach the running session through `reshape`, which leaves
   * the phase you're in alone: the clock in front of you never jumps.
   */
  const applyMenu = (open: Menu): void => {
    config = { ...config, ...open.values };
    mode = config.color ? capability : 'none';
    glyphs = glyphSet(config.ascii);
    screen.setMouse(config.mouse);
    screen.setTitleBar(config.title);
    if (started) session = reshape(session, durations(config));
  };

  const closeMenu = (): void => {
    if (!menu) return;
    const open = commit(menu);
    applyMenu(open);
    menu = null;
    note = null;
    menuHovered = null;
    menuHits = [];
    if (!started) {
      started = true;
      session = createSession(buildPhases(durations(config)), Date.now());
    }
    paint();
  };

  const saveMenu = (open: Menu): Menu => {
    const written = commit(open);
    if (!save(configPath(), written.values)) {
      note = 'not saved';
      return written;
    }
    savedValues = written.values;
    note = 'saved';
    return markSaved(written);
  };

  const menuKey = (key: string): void => {
    if (!menu) return;
    const open = menu;
    note = null;

    if (isEditing(open)) {
      switch (key) {
        case 'enter':
          menu = commit(open);
          break;
        case 'escape':
          menu = cancel(open);
          break;
        case 'backspace':
          menu = backspace(open);
          break;
        // Moving off a field you're typing into keeps what you typed, the way
        // a form does. Only escape throws it away.
        case 'up':
          menu = move(commit(open), -1);
          break;
        case 'down':
        case 'tab':
          menu = move(commit(open), 1);
          break;
        case '\x03':
          shutdown();
          return;
        default:
          if (key.length === 1 && key >= ' ') menu = write(open, key);
      }
      paint();
      return;
    }

    switch (key) {
      case 'up':
      case 'shift-tab':
        menu = move(open, -1);
        break;
      case 'down':
      case 'tab':
        menu = move(open, 1);
        break;
      case 'left':
        menu = step(open, -1);
        break;
      case 'right':
        menu = step(open, 1);
        break;
      // Shift moves in fives, because nudging 25 up to 50 one minute at a
      // time is a joke at the user's expense.
      case 'shift-left':
        menu = step(open, -5);
        break;
      case 'shift-right':
        menu = step(open, 5);
        break;
      case ' ':
        menu = activate(open);
        break;
      case 's':
      case 'S':
        menu = saveMenu(open);
        break;
      case 'enter':
      case 'escape':
        closeMenu();
        return;
      case 'q':
      case 'Q':
      case '\x03':
      case '\x04':
        shutdown();
        return;
      default:
        // A digit on a number field starts typing a value straight away.
        if (key.length === 1) menu = write(open, key);
    }
    paint();
  };

  const menuMouse = (event: MouseEvent): void => {
    if (!menu) return;
    const target = hitTest(menuHits, event.row, event.col);

    if (event.kind === 'move') {
      const button = target?.kind === 'button' ? target.id : null;
      if (button !== menuHovered) {
        menuHovered = button;
        paint();
      }
      return;
    }

    if (event.kind !== 'press' || event.button !== 0 || !target) return;
    note = null;
    // Anything half-typed is banked before the click lands somewhere else.
    const open = commit(menu);

    switch (target.kind) {
      case 'row':
        menu = focus(open, target.index);
        break;
      case 'value':
        menu = activate(focus(open, target.index));
        break;
      case 'step':
        menu = step(focus(open, target.index), target.delta);
        break;
      case 'button':
        if (target.id === 'primary') {
          menu = open;
          closeMenu();
          return;
        }
        if (target.id === 'save') {
          menu = saveMenu(open);
          break;
        }
        shutdown();
        return;
    }
    paint();
  };

  // ── the outside world ────────────────────────────────────────────────────

  /** What's left behind on the real screen once the alternate one is gone. */
  const summary = (): string => {
    const done = completedWorkPhases(session);
    const total = totalWorkPhases(session);
    const line = `pomo · ${done}/${total} rounds · ${formatDuration(focusedMs(session, Date.now()))} focused`;
    // Say it once, on the way out, rather than interrupting the start.
    return created ? `${line}\nwrote a config file at ${configPath()}` : line;
  };

  const shutdown = (): void => {
    if (exiting) return;
    exiting = true;
    if (timer) clearInterval(timer);
    chime.dispose();
    screen.stop(summary());
    process.exit(0);
  };

  const onKey = (key: string): void => {
    if (menu) {
      menuKey(key);
      return;
    }

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
      case 'm':
      case 'M':
        menu = openMenu();
        paint();
        break;
      case 'q':
      case 'Q':
      case '\x03': // ctrl-c: raw mode delivers it as a byte, not a signal
      case '\x04': // ctrl-d
        shutdown();
        break;
    }
  };

  function hitTest<Id>(boxes: readonly Hit<Id>[], row: number, col: number): Id | null {
    for (const hit of boxes) {
      if (hit.row !== row - originRow) continue;
      if (col >= originCol + hit.col && col < originCol + hit.col + hit.width) return hit.id;
    }
    return null;
  }

  const onMouse = (event: MouseEvent): void => {
    if (menu) {
      menuMouse(event);
      return;
    }

    const target = hitTest(hits, event.row, event.col);

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
  process.on('exit', () => {
    chime.dispose();
    screen.stop();
  });

  screen.start({ onKey, onMouse, onResize: paint });
  paint();
  timer = setInterval(advance, TICK_MS);
}

/** 1-based coordinate that centres `size` inside `available`. */
function center(available: number, size: number): number {
  return Math.max(1, Math.floor((available - size) / 2) + 1);
}

main();
