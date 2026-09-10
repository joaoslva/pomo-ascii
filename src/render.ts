/**
 * State in, frame out. No I/O, no timers, no globals — which is why the tests
 * for this file are three lines each.
 *
 * The frame comes in three sizes. `layout` picks the largest that fits the
 * terminal; below the smallest there is nothing sensible to draw and the
 * caller shows `tooSmall` instead. Sizes are fixed rather than stretched — a
 * progress bar 200 columns wide is not an improvement — so a big terminal just
 * gets the box centred in it.
 *
 * `render` also returns the hit boxes for the clickable buttons. They're
 * derived from the same numbers that positioned the labels, so the mouse
 * targets cannot drift out of sync with what's on screen.
 *
 * Two screens live here, the timer and the settings menu. They share the box,
 * the header and the button bar, and they differ in what a hit box points at,
 * which is why `Hit` is generic over its id.
 */

import { bigText, bigTextWidth, DIGIT_HEIGHT, type Scale } from './digits.ts';
import { bold, dim, fg, invert, phaseColor, type ColorMode, type Rgb } from './gradient.ts';
import type { GlyphSet } from './glyphs.ts';
import { display, type Field, type Menu } from './menu.ts';
import {
  completedWorkPhases,
  currentPhase,
  currentRound,
  formatClock,
  isFinished,
  isRunning,
  progress,
  remainingMs,
  totalWorkPhases,
  type PhaseKind,
  type Session,
} from './session.ts';

export type ButtonId = 'toggle' | 'skip' | 'restart' | 'quit';

/** A clickable region, in coordinates relative to the top-left of the frame. */
export type Hit<Id = ButtonId> = {
  id: Id;
  /** 0-based row within the frame. */
  row: number;
  /** 0-based column within the frame. */
  col: number;
  width: number;
};

export type Frame<Id = ButtonId> = {
  lines: string[];
  hits: Hit<Id>[];
};

export type TierName = 'full' | 'compact' | 'tiny';

export type Tier = {
  name: TierName;
  /** Total frame size, borders included. */
  width: number;
  height: number;
};

export const FULL: Tier = { name: 'full', width: 44, height: 13 };
export const COMPACT: Tier = { name: 'compact', width: 34, height: 9 };
export const TINY: Tier = { name: 'tiny', width: 16, height: 3 };

/** Largest first: `layout` returns the first one that fits. */
export const TIERS: readonly Tier[] = [FULL, COMPACT, TINY];

export type ViewState = {
  session: Session;
  now: number;
  mode: ColorMode;
  glyphs: GlyphSet;
  hovered: ButtonId | null;
  /** Drives the hint text, so a terminal without mouse support says so. */
  mouse: boolean;
  /** What you're working on. Takes the status row's right-hand side if set. */
  task: string;
  /** Skip and reset are locked while a focus phase runs. */
  strict: boolean;
  tier: Tier;
};

const TITLE = 'pomo';

/** Past this many rounds the dots stop being countable, so we drop them. */
const MAX_DOTS = 12;

const PHASE_LABELS: Record<PhaseKind, string> = {
  'work': 'focus',
  'short-break': 'break',
  'long-break': 'long break',
};

const SHORT_LABELS: Record<PhaseKind, string> = {
  'work': 'focus',
  'short-break': 'break',
  'long-break': 'long',
};

/** What changes between the full box and the compact one. */
type BoxStyle = {
  digitScale: Scale;
  barWidth: number;
  /** Blank rows above and below the clock and the bar. */
  spacers: boolean;
  /** `[ skip ]` rather than `[skip]`. */
  padButtons: boolean;
  /** A row of its own for the dots, the round and the key hint. */
  statusRow: boolean;
};

const STYLES: Record<'full' | 'compact', BoxStyle> = {
  full: { digitScale: 2, barWidth: 34, spacers: true, padButtons: true, statusRow: true },
  compact: { digitScale: 1, barWidth: 26, spacers: false, padButtons: false, statusRow: false },
};

/** The biggest tier that fits, or null when even the smallest doesn't. */
export function layout(columns: number, rows: number): Tier | null {
  for (const tier of TIERS) {
    if (columns >= tier.width && rows >= tier.height) return tier;
  }
  return null;
}

function padCenter(text: string, width: number): [left: number, right: number] {
  const slack = Math.max(0, width - text.length);
  const left = Math.floor(slack / 2);
  return [left, slack - left];
}

/** Lays `left` and `right` out at the two ends of `width`, dropping `right`
 *  if there is no room for both. Widths are the visible ones, not the styled. */
function endToEnd(
  left: string,
  leftWidth: number,
  right: string,
  rightWidth: number,
  width: number,
): string {
  if (leftWidth + 1 + rightWidth > width) {
    right = '';
    rightWidth = 0;
  }
  return left + ' '.repeat(Math.max(0, width - leftWidth - rightWidth)) + right;
}

/**
 * Each filled cell is coloured for its own position, so the bar shows the whole
 * gradient travelled so far rather than one flat block of colour.
 */
function progressBar(
  kind: PhaseKind,
  t: number,
  width: number,
  g: GlyphSet,
  mode: ColorMode,
): string {
  const filled = Math.round(t * width);
  let bar = '';
  for (let i = 0; i < filled; i++) bar += fg(g.barFull, phaseColor(kind, i / (width - 1)), mode);
  return bar + dim(g.barEmpty.repeat(width - filled), mode);
}

type BarButton<Id> = { id: Id; label: string; disabled: boolean };

/**
 * A centred row of `[ button ]`s, and the hit boxes that go with it. Both
 * screens draw their buttons through here, so a click lands in the same place
 * on each and there is one place to change how a button looks.
 */
function buttonBar<Id>(options: {
  buttons: readonly BarButton<Id>[];
  hovered: (id: Id) => boolean;
  /** `[ skip ]` rather than `[skip]`. */
  pad: boolean;
  inner: number;
  /** 0-based row of this bar within the frame, for the hit boxes. */
  row: number;
  color: Rgb;
  mode: ColorMode;
}): { text: string; width: number; hits: Hit<Id>[] } {
  const { buttons, pad, inner, mode, color } = options;
  const plain = buttons.map((b) => (pad ? `[ ${b.label} ]` : `[${b.label}]`));
  const width = plain.reduce((sum, b) => sum + b.length, 0) + (buttons.length - 1);
  const [left] = padCenter(' '.repeat(width), inner);

  const hits: Hit<Id>[] = [];
  let text = '';
  let cursor = 1 + left; // +1 for the left border column

  buttons.forEach((button, i) => {
    const label = plain[i] ?? '';
    if (button.disabled) {
      // Dimmed and unclickable together. A button that looks live and does
      // nothing is worse than one that admits it's off.
      text += dim(label, mode);
    } else {
      text += options.hovered(button.id)
        ? invert(fg(label, color, mode), mode)
        : bold(label, mode);
      hits.push({ id: button.id, row: options.row, col: cursor, width: label.length });
    }
    cursor += label.length;
    if (i < buttons.length - 1) {
      text += ' ';
      cursor += 1;
    }
  });

  return { text, width, hits };
}

export function render(view: ViewState): Frame {
  if (view.tier.name === 'tiny') return renderTiny(view);
  return renderBox(view, STYLES[view.tier.name === 'full' ? 'full' : 'compact']);
}

function renderBox(view: ViewState, style: BoxStyle): Frame {
  const { session, now, mode, glyphs: g, tier } = view;
  const inner = tier.width - 2;
  const finished = isFinished(session);
  const kind: PhaseKind = currentPhase(session)?.kind ?? 'long-break';
  const t = finished ? 1 : progress(session, now);
  const color = phaseColor(kind, t);

  const lines: string[] = [];
  const border = dim(g.vertical, mode);

  /** Wraps `styled` (whose visible length is `plainWidth`) in the box. */
  const row = (styled: string, plainWidth: number): string => {
    const [left, right] = padCenter(' '.repeat(plainWidth), inner);
    return border + ' '.repeat(left) + styled + ' '.repeat(right) + border;
  };

  const blank = (): string => border + ' '.repeat(inner) + border;

  // ── top border ───────────────────────────────────────────────────────────
  lines.push(header(headerLabel(view), tier.width, g, mode, color));

  if (style.spacers) lines.push(blank());

  // ── clock ────────────────────────────────────────────────────────────────
  const clock = formatClock(finished ? 0 : remainingMs(session, now));
  const clockLines = bigText(clock, g.digit, style.digitScale);
  const clockWidth = bigTextWidth(clock, style.digitScale);
  for (let i = 0; i < DIGIT_HEIGHT; i++) {
    lines.push(row(fg(clockLines[i] ?? '', color, mode), clockWidth));
  }

  if (style.spacers) lines.push(blank());

  // ── progress bar ─────────────────────────────────────────────────────────
  // Each filled cell is coloured for its own position, so the bar shows the
  // whole gradient travelled so far rather than one flat block of colour.
  lines.push(row(progressBar(kind, t, style.barWidth, g, mode), style.barWidth));

  if (style.spacers) lines.push(blank());

  // ── buttons ──────────────────────────────────────────────────────────────
  // Strict mode only bites while focus is actually running: pausing is still
  // allowed, and a break is nobody's test of willpower.
  const locked = view.strict && !finished && kind === 'work' && isRunning(session);
  const bar = buttonBar({
    buttons: buttonLabels(session, locked),
    hovered: (id) => view.hovered === id,
    pad: style.padButtons,
    inner,
    row: lines.length,
    color,
    mode,
  });
  lines.push(row(bar.text, bar.width));
  const hits = bar.hits;

  // ── status ───────────────────────────────────────────────────────────────
  if (style.statusRow) {
    lines.push(statusRow(session, color, mode, g, border, view.mouse, view.task, inner));
  }

  // ── bottom border ────────────────────────────────────────────────────────
  lines.push(dim(g.bottomLeft + g.horizontal.repeat(inner) + g.bottomRight, mode));

  return { lines, hits };
}

/**
 * Three unadorned lines: clock, bar, round. No box and no buttons — at this
 * width a border costs two of the sixteen columns we have, and a button row
 * doesn't fit at all. The keys still work.
 */
function renderTiny(view: ViewState): Frame {
  const { session, now, mode, glyphs: g } = view;
  const width = TINY.width;
  const finished = isFinished(session);
  const kind: PhaseKind = currentPhase(session)?.kind ?? 'long-break';
  const t = finished ? 1 : progress(session, now);
  const color = phaseColor(kind, t);

  const clock = formatClock(finished ? 0 : remainingMs(session, now));
  const label = finished ? 'done' : isRunning(session) ? SHORT_LABELS[kind] : 'paused';

  const rounds = `${currentRound(session)}/${totalWorkPhases(session)}`;
  const hint = 'spc s r m q';

  return {
    lines: [
      endToEnd(fg(clock, color, mode), clock.length, dim(label, mode), label.length, width),
      progressBar(kind, t, width, g, mode),
      endToEnd(fg(rounds, color, mode), rounds.length, dim(hint, mode), hint.length, width),
    ],
    hits: [],
  };
}

/** `┌─ pomo ──────── focus ─┐`, at whatever width it's given. */
function header(
  label: string,
  width: number,
  g: GlyphSet,
  mode: ColorMode,
  color: Rgb,
): string {
  const left = `${g.topLeft}${g.horizontal} ${TITLE} `;
  const right = ` ${g.horizontal}${g.topRight}`;
  // One column for the space before the label, one for a minimum of fill.
  const room = Math.max(0, width - left.length - right.length - 2);
  const text = label.slice(0, room);
  const fill = Math.max(1, width - left.length - right.length - 1 - text.length);

  return (
    dim(left, mode) +
    dim(g.horizontal.repeat(fill), mode) +
    ' ' +
    fg(text, color, mode) +
    dim(right, mode)
  );
}

/**
 * The compact box has no status row, so its header carries the round count
 * that the full box shows along the bottom.
 */
function headerLabel(view: ViewState): string {
  const { session, tier } = view;
  const finished = isFinished(session);
  const kind: PhaseKind = currentPhase(session)?.kind ?? 'long-break';
  const paused = !finished && !isRunning(session);

  if (tier.name === 'compact') {
    const base = finished
      ? 'done'
      : `${SHORT_LABELS[kind]} ${currentRound(session)}/${totalWorkPhases(session)}`;
    return paused ? `${base} · paused` : base;
  }

  if (finished) return 'done';
  return PHASE_LABELS[kind] + (paused ? ' · paused' : '');
}

type Button = { id: ButtonId; label: string; disabled: boolean };

function buttonLabels(session: Session, locked: boolean): Button[] {
  // The first label is padded to a fixed width so the row doesn't jitter when
  // it flips between "pause" and "resume".
  const primary = isFinished(session) ? 'again' : isRunning(session) ? 'pause' : 'resume';
  return [
    { id: 'toggle', label: primary.padEnd(6), disabled: false },
    { id: 'skip', label: 'skip', disabled: locked },
    { id: 'restart', label: 'reset', disabled: locked },
    { id: 'quit', label: 'quit', disabled: false },
  ];
}

/** `text`, shortened to `width` with a mark to say that it was. */
function clip(text: string, width: number, g: GlyphSet): string {
  if (text.length <= width) return text;
  if (width <= g.ellipsis.length) return text.slice(0, width);
  return text.slice(0, width - g.ellipsis.length) + g.ellipsis;
}

function statusRow(
  session: Session,
  color: Rgb,
  mode: ColorMode,
  g: GlyphSet,
  border: string,
  mouse: boolean,
  task: string,
  inner: number,
): string {
  const done = completedWorkPhases(session);
  const total = totalWorkPhases(session);

  const showDots = total <= MAX_DOTS;
  const dots = showDots
    ? fg(g.dotFull.repeat(done), color, mode) + dim(g.dotEmpty.repeat(total - done), mode) + ' '
    : '';
  const dotsWidth = showDots ? total + 1 : 0;

  const full = isFinished(session)
    ? `${total}/${total} complete`
    : `round ${currentRound(session)}/${total}`;
  const roundText = full.slice(0, Math.max(0, inner - 1 - dotsWidth));
  const left = dots + roundText;
  const leftWidth = dotsWidth + roundText.length;

  // The task is worth more than a hint you've already read, so it wins the
  // right-hand side outright when there is one. It gets clipped to fit rather
  // than dropped, keeping a column back for the gap — cut it flush against the
  // round count and the "no room for both" branch below would swallow it.
  let hint = mouse ? 'click · space s r m q' : 'keys · space s r m q';
  if (task !== '') hint = clip(task, Math.max(0, inner - 3 - leftWidth), g);

  let gap = inner - 2 - leftWidth - hint.length;
  if (gap < 1) {
    // Not enough room for both; the round count is the part worth keeping.
    hint = '';
    gap = Math.max(0, inner - 1 - leftWidth);
  }
  const trailing = Math.max(0, inner - 1 - leftWidth - gap - hint.length);

  return (
    border +
    ' ' +
    left +
    ' '.repeat(gap) +
    dim(hint, mode) +
    ' '.repeat(trailing) +
    border
  );
}

/**
 * Rendered when the terminal can't fit even the tiny tier. Degrades until it
 * fits whatever is actually there, so the "too small" notice can never itself
 * be too big. Lines come back centred against each other.
 */
export function tooSmall(
  columns: number,
  rows: number,
  need: { width: number; height: number } = TINY,
): string[] {
  // Nothing wider than "too small" is worth listing: we only get here when the
  // terminal is under 16 columns or under 3 rows, so anything longer than that
  // would never fit in the space that made us give up in the first place.
  const wanted = `need ${need.width}x${need.height}`;
  const options: string[][] = [
    ['too small', `have ${columns}x${rows}`, wanted],
    ['too small', `${columns}x${rows}`, wanted],
    ['too small', wanted],
    ['too small'],
    ['!'],
  ];

  for (const option of options) {
    if (option.length > rows) continue;
    if (option.some((line) => line.length > columns)) continue;
    const width = Math.max(...option.map((line) => line.length));
    return option.map((line) => ' '.repeat(padCenter(line, width)[0]) + line);
  }
  return [];
}

// ── the settings menu ──────────────────────────────────────────────────────

export type MenuButtonId = 'primary' | 'save' | 'quit';

/**
 * What sits under the mouse in the menu. The label and the value of a row are
 * separate targets because they do different things: one moves the focus, the
 * other opens the value up for changing.
 */
export type MenuTarget =
  | { kind: 'row'; index: number }
  | { kind: 'value'; index: number }
  | { kind: 'step'; index: number; delta: number }
  | { kind: 'button'; id: MenuButtonId };

export type MenuTier = {
  width: number;
  height: number;
  /** How many field rows fit. Fewer than there are fields means it scrolls. */
  visible: number;
};

export type MenuView = {
  menu: Menu;
  mode: ColorMode;
  glyphs: GlyphSet;
  hovered: MenuButtonId | null;
  /** `start` before the timer has begun, `back` once it's running. */
  primary: 'start' | 'back';
  /** A word for the header, for saying `saved` and for admitting `not saved`. */
  note: string | null;
  tier: MenuTier;
};

/** Top border, buttons, hints, bottom border. Everything else is a field. */
export const MENU_CHROME = 4;
const MENU_MIN_VISIBLE = 3;
/** Wide enough for `short break`, which is the longest label there is. */
const MENU_LABEL = 11;
const MENU_TITLE = 'settings';

/**
 * The menu is as tall as it needs to be, up to whatever the terminal has. Only
 * the width comes in tiers — a list of settings has nothing to gain from the
 * big digits, so it borrows the timer's two box widths and stops there.
 */
export function menuLayout(columns: number, rows: number, fields: number): MenuTier | null {
  const width =
    columns >= FULL.width ? FULL.width : columns >= COMPACT.width ? COMPACT.width : 0;
  if (width === 0) return null;

  const visible = Math.min(fields, rows - MENU_CHROME);
  if (visible < Math.min(MENU_MIN_VISIBLE, fields)) return null;
  return { width, height: visible + MENU_CHROME, visible };
}

/**
 * Which slice of the list to show. Centring the focused row means the window
 * is a function of the focus alone, so nothing here has to remember where the
 * list was scrolled to last time.
 */
export function menuWindow(index: number, visible: number, total: number): number {
  if (total <= visible) return 0;
  const centred = index - Math.floor((visible - 1) / 2);
  return Math.min(Math.max(0, centred), total - visible);
}

export function renderMenu(view: MenuView): Frame<MenuTarget> {
  const { menu, mode, glyphs: g, tier } = view;
  const inner = tier.width - 2;
  const valueWidth = inner - MENU_LABEL - 8;
  const accent = phaseColor('work', 0.5);
  const border = dim(g.vertical, mode);

  const lines: string[] = [];
  const hits: Hit<MenuTarget>[] = [];

  const dirty = JSON.stringify(menu.values) !== JSON.stringify(menu.saved);
  const note = view.note ?? (dirty ? 'edited' : null);
  lines.push(header(note ? `${MENU_TITLE} · ${note}` : MENU_TITLE, tier.width, g, mode, accent));

  // ── the fields ───────────────────────────────────────────────────────────
  const total = menu.fields.length;
  const start = menuWindow(menu.index, tier.visible, total);

  for (let i = 0; i < tier.visible; i++) {
    const index = start + i;
    const field = menu.fields[index];
    if (!field) break;

    const row = lines.length;
    const isFocused = index === menu.index;
    const editing = isFocused && menu.draft !== null;
    const steppable = field.kind !== 'text';

    const label = clip(field.label, MENU_LABEL, g).padEnd(MENU_LABEL);
    const chevron = (glyph: string): string =>
      !steppable ? ' ' : isFocused ? fg(glyph, accent, mode) : dim(glyph, mode);

    // A marker rather than a whole inverted row: the focused line should stand
    // out, not shout, since one of these is always focused.
    const marker = isFocused ? fg(g.right, accent, mode) : ' ';

    // The scroll marks live in the one column the layout doesn't use, so a
    // list that scrolls costs the values nothing.
    const scroll =
      i === 0 && start > 0 ? dim(g.up, mode)
      : i === tier.visible - 1 && start + tier.visible < total ? dim(g.down, mode)
      : ' ';

    lines.push(
      border +
        marker +
        ' ' +
        (isFocused ? bold(label, mode) : dim(label, mode)) +
        ' ' +
        chevron(g.left) +
        ' ' +
        valueCell(view, field, isFocused, editing, valueWidth, accent) +
        ' ' +
        chevron(g.right) +
        scroll +
        border,
    );

    hits.push({ id: { kind: 'row', index }, row, col: 1, width: MENU_LABEL + 2 });
    hits.push({ id: { kind: 'value', index }, row, col: MENU_LABEL + 6, width: valueWidth });
    if (steppable) {
      hits.push({ id: { kind: 'step', index, delta: -1 }, row, col: MENU_LABEL + 4, width: 1 });
      hits.push({
        id: { kind: 'step', index, delta: 1 },
        row,
        col: MENU_LABEL + valueWidth + 7,
        width: 1,
      });
    }
  }

  // ── buttons ──────────────────────────────────────────────────────────────
  // Saving is what's greyed out when there's nothing to save, because the file
  // is the only thing here you can't undo by walking away.
  const bar = buttonBar<MenuButtonId>({
    buttons: [
      { id: 'primary', label: view.primary.padEnd(5), disabled: false },
      { id: 'save', label: 'save', disabled: !dirty },
      { id: 'quit', label: 'quit', disabled: false },
    ],
    hovered: (id) => view.hovered === id,
    pad: tier.width === FULL.width,
    inner,
    row: lines.length,
    color: accent,
    mode,
  });
  const [barLeft, barRight] = padCenter(' '.repeat(bar.width), inner);
  lines.push(border + ' '.repeat(barLeft) + bar.text + ' '.repeat(barRight) + border);
  for (const hit of bar.hits) hits.push({ ...hit, id: { kind: 'button', id: hit.id } });

  // ── hints ────────────────────────────────────────────────────────────────
  const wide = tier.width === FULL.width;
  const [left, right] =
    menu.draft !== null
      ? [wide ? 'typing' : '', 'enter ok · esc cancel']
      : [
          `${g.up}${g.down} ${g.left}${g.right}`,
          wide ? `space edit · s save · enter ${view.primary}` : `enter ${view.primary}`,
        ];
  lines.push(
    border +
      ' ' +
      endToEnd(dim(left, mode), left.length, dim(right, mode), right.length, inner - 2) +
      ' ' +
      border,
  );

  lines.push(dim(g.bottomLeft + g.horizontal.repeat(inner) + g.bottomRight, mode));

  return { lines, hits };
}

/** The value, padded to its column, and marked up for whatever state it's in. */
function valueCell(
  view: MenuView,
  field: Field,
  isFocused: boolean,
  editing: boolean,
  width: number,
  accent: Rgb,
): string {
  const { menu, mode, glyphs: g } = view;
  const text = display(menu, field);

  if (editing) {
    // Keep the caret in sight by showing the tail of anything too long: you
    // care about the character you just typed, not the one you typed first.
    const room = Math.max(0, width - 1);
    const shown = text.length > room ? text.slice(text.length - room) : text;
    return (
      fg(shown, accent, mode) +
      invert(' ', mode) +
      ' '.repeat(Math.max(0, width - shown.length - 1))
    );
  }

  const shown = clip(text, width, g);
  const padding = ' '.repeat(Math.max(0, width - shown.length));
  if (isFocused) return fg(shown, accent, mode) + padding;
  return shown + padding;
}
