/**
 * State in, frame out. No I/O, no timers, no globals — which is why the tests
 * for this file are three lines each.
 *
 * `render` also returns the hit boxes for the clickable buttons. They're
 * derived from the same numbers that positioned the labels, so the mouse
 * targets cannot drift out of sync with what's on screen.
 */

import { bigText, bigTextWidth, DIGIT_HEIGHT } from './digits.ts';
import { bold, dim, fg, invert, phaseColor, type ColorMode, type Rgb } from './gradient.ts';
import type { GlyphSet } from './glyphs.ts';
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
export type Hit = {
  id: ButtonId;
  /** 0-based row within the frame. */
  row: number;
  /** 0-based column within the frame. */
  col: number;
  width: number;
};

export type Frame = {
  lines: string[];
  hits: Hit[];
};

export type ViewState = {
  session: Session;
  now: number;
  mode: ColorMode;
  glyphs: GlyphSet;
  hovered: ButtonId | null;
  /** Drives the hint text, so a terminal without mouse support says so. */
  mouse: boolean;
};

/** Inner width, between the borders. */
const INNER = 42;
const BAR_WIDTH = 34;
const TITLE = 'pomo';

export const FRAME_WIDTH = INNER + 2;
export const FRAME_HEIGHT = 13;

const ROW_BUTTONS = 10;

const PHASE_LABELS: Record<PhaseKind, string> = {
  'work': 'focus',
  'short-break': 'break',
  'long-break': 'long break',
};

function padCenter(text: string, width: number): [left: number, right: number] {
  const slack = Math.max(0, width - text.length);
  const left = Math.floor(slack / 2);
  return [left, slack - left];
}

export function render(view: ViewState): Frame {
  const { session, now, mode, glyphs: g } = view;
  const finished = isFinished(session);
  const phase = currentPhase(session);
  const kind: PhaseKind = phase?.kind ?? 'long-break';
  const t = finished ? 1 : progress(session, now);
  const color = phaseColor(kind, t);

  const lines: string[] = [];
  const border = dim(g.vertical, mode);

  /** Wraps `styled` (whose visible length is `plainWidth`) in the box. */
  const row = (styled: string, plainWidth: number): string => {
    const [left, right] = padCenter(' '.repeat(plainWidth), INNER);
    return border + ' '.repeat(left) + styled + ' '.repeat(right) + border;
  };

  const blank = (): string => border + ' '.repeat(INNER) + border;

  // ── top border ───────────────────────────────────────────────────────────
  const statusLabel = finished
    ? 'done'
    : PHASE_LABELS[kind] + (isRunning(session) ? '' : ' · paused');
  const headLeft = `${g.topLeft}${g.horizontal} ${TITLE} `;
  const headRight = ` ${g.horizontal}${g.topRight}`;
  const fill = Math.max(1, FRAME_WIDTH - headLeft.length - statusLabel.length - 1 - headRight.length);
  lines.push(
    dim(headLeft, mode) +
      dim(g.horizontal.repeat(fill), mode) +
      ' ' +
      fg(statusLabel, color, mode) +
      dim(headRight, mode),
  );

  lines.push(blank());

  // ── clock ────────────────────────────────────────────────────────────────
  const clock = formatClock(finished ? 0 : remainingMs(session, now));
  const clockLines = bigText(clock, g.digit);
  const clockWidth = bigTextWidth(clock);
  for (let i = 0; i < DIGIT_HEIGHT; i++) {
    lines.push(row(fg(clockLines[i] ?? '', color, mode), clockWidth));
  }

  lines.push(blank());

  // ── progress bar ─────────────────────────────────────────────────────────
  // Each filled cell is coloured for its own position, so the bar shows the
  // whole gradient travelled so far rather than one flat block of colour.
  const filled = Math.round(t * BAR_WIDTH);
  let bar = '';
  for (let i = 0; i < filled; i++) {
    bar += fg(g.barFull, phaseColor(kind, i / (BAR_WIDTH - 1)), mode);
  }
  bar += dim(g.barEmpty.repeat(BAR_WIDTH - filled), mode);
  lines.push(row(bar, BAR_WIDTH));

  lines.push(blank());

  // ── buttons ──────────────────────────────────────────────────────────────
  const buttons = buttonLabels(session);
  const buttonsPlain = buttons.map((b) => `[ ${b.label} ]`);
  const buttonsWidth = buttonsPlain.reduce((sum, b) => sum + b.length, 0) + (buttons.length - 1);
  const [buttonsLeft] = padCenter(' '.repeat(buttonsWidth), INNER);

  const hits: Hit[] = [];
  let styledButtons = '';
  let cursor = 1 + buttonsLeft; // +1 for the left border column
  buttons.forEach((button, i) => {
    const text = buttonsPlain[i] ?? '';
    const hovered = view.hovered === button.id;
    styledButtons += hovered ? invert(fg(text, color, mode), mode) : bold(text, mode);
    hits.push({ id: button.id, row: ROW_BUTTONS, col: cursor, width: text.length });
    cursor += text.length;
    if (i < buttons.length - 1) {
      styledButtons += ' ';
      cursor += 1;
    }
  });
  lines.push(row(styledButtons, buttonsWidth));

  // ── status ───────────────────────────────────────────────────────────────
  lines.push(statusRow(session, color, mode, g, border, view.mouse));

  // ── bottom border ────────────────────────────────────────────────────────
  lines.push(dim(g.bottomLeft + g.horizontal.repeat(INNER) + g.bottomRight, mode));

  return { lines, hits };
}

function buttonLabels(session: Session): { id: ButtonId; label: string }[] {
  // The first label is padded to a fixed width so the row doesn't jitter when
  // it flips between "pause" and "resume".
  const primary = isFinished(session) ? 'again' : isRunning(session) ? 'pause' : 'resume';
  return [
    { id: 'toggle', label: primary.padEnd(6) },
    { id: 'skip', label: 'skip' },
    { id: 'restart', label: 'reset' },
    { id: 'quit', label: 'quit' },
  ];
}

function statusRow(
  session: Session,
  color: Rgb,
  mode: ColorMode,
  g: GlyphSet,
  border: string,
  mouse: boolean,
): string {
  const done = completedWorkPhases(session);
  const total = totalWorkPhases(session);

  const dots =
    fg(g.dotFull.repeat(done), color, mode) + dim(g.dotEmpty.repeat(total - done), mode);

  const roundText = isFinished(session)
    ? `${total}/${total} complete`
    : `round ${currentRound(session)}/${total}`;
  const left = `${dots} ${roundText}`;
  const leftWidth = total + 1 + roundText.length;

  const hint = mouse ? 'click · space s r q' : 'keys · space s r q';
  const gap = Math.max(1, INNER - 2 - leftWidth - hint.length);

  return (
    border +
    ' ' +
    left +
    ' '.repeat(gap) +
    dim(hint, mode) +
    ' '.repeat(Math.max(0, INNER - 1 - leftWidth - gap - hint.length)) +
    border
  );
}

/** Rendered when the terminal is too narrow to fit the box. */
export function tooNarrow(columns: number): string[] {
  const message = `pomo needs ${FRAME_WIDTH} columns (this terminal has ${columns})`;
  const lines = [message];
  while (lines.length < FRAME_HEIGHT) lines.push('');
  return lines;
}
