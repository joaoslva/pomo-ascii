import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { bigText, bigTextWidth, DIGIT_HEIGHT } from '../src/digits.ts';
import { hslToRgb, phaseColor, rgbToAnsi256 } from '../src/gradient.ts';
import { UNICODE } from '../src/glyphs.ts';
import { FRAME_HEIGHT, FRAME_WIDTH, render } from '../src/render.ts';
import { buildPhases, createSession, pause, skip } from '../src/session.ts';

const DURATIONS = { work: 25 * 60, shortBreak: 5 * 60, longBreak: 15 * 60, rounds: 4 };
const T0 = 1_700_000_000_000;

const ANSI = /\x1b\[[\d;]*m/g;
const strip = (s: string) => s.replace(ANSI, '');

const view = (overrides: Partial<Parameters<typeof render>[0]> = {}) =>
  render({
    session: createSession(buildPhases(DURATIONS), T0),
    now: T0,
    mode: 'truecolor' as const,
    glyphs: UNICODE,
    hovered: null,
    mouse: true,
    ...overrides,
  });

describe('digits', () => {
  it('reports the width it actually draws', () => {
    for (const text of ['25:00', '00:00', '07:42']) {
      const lines = bigText(text, '#');
      assert.equal(lines.length, DIGIT_HEIGHT);
      for (const line of lines) assert.equal(line.length, bigTextWidth(text));
    }
  });

  it('draws every digit distinctly', () => {
    const shapes = new Set('0123456789'.split('').map((d) => bigText(d, '#').join('|')));
    assert.equal(shapes.size, 10);
  });
});

describe('render', () => {
  it('produces a frame of exactly the declared size', () => {
    const frame = view();
    assert.equal(frame.lines.length, FRAME_HEIGHT);
    for (const line of frame.lines) assert.equal(strip(line).length, FRAME_WIDTH);
  });

  it('keeps the frame rectangular in every state', () => {
    const running = createSession(buildPhases(DURATIONS), T0);
    const states = [
      running,
      pause(running, T0 + 60_000),
      skip(running, T0), // a break
      { ...running, index: running.phases.length, runningSince: null },
    ];

    for (const session of states) {
      for (const mode of ['truecolor', 'ansi256', 'none'] as const) {
        for (const mouse of [true, false]) {
          const frame = render({
            session,
            now: T0 + 60_000,
            mode,
            glyphs: UNICODE,
            hovered: 'skip',
            mouse,
          });
          assert.equal(frame.lines.length, FRAME_HEIGHT);
          for (const line of frame.lines) assert.equal(strip(line).length, FRAME_WIDTH);
        }
      }
    }
  });

  it('shows the full time at the top of a phase', () => {
    const clock = view().lines.slice(2, 2 + DIGIT_HEIGHT).map(strip).join('\n');
    const expected = bigText('25:00', UNICODE.digit);
    for (const line of expected) assert.ok(clock.includes(line.trimEnd()));
  });

  it('emits no escape codes when colour is off', () => {
    for (const line of view({ mode: 'none' }).lines) {
      assert.equal(line.includes('\x1b'), false);
    }
  });

  it('flips the primary button between pause and resume without moving it', () => {
    const running = view();
    const stopped = view({ session: pause(createSession(buildPhases(DURATIONS), T0), T0) });

    assert.ok(strip(running.lines[10]!).includes('pause'));
    assert.ok(strip(stopped.lines[10]!).includes('resume'));
    assert.deepEqual(running.hits, stopped.hits);
  });
});

describe('hit boxes', () => {
  it('lines up with where the labels were actually drawn', () => {
    const frame = view();
    const row = strip(frame.lines[10]!);

    assert.equal(frame.hits.length, 4);
    for (const hit of frame.hits) {
      const text = row.slice(hit.col, hit.col + hit.width);
      assert.equal(text.startsWith('['), true, `hit for ${hit.id} starts at a bracket`);
      assert.equal(text.endsWith(']'), true, `hit for ${hit.id} ends at a bracket`);
    }
  });

  it('never overlaps or escapes the frame', () => {
    const hits = [...view().hits].sort((a, b) => a.col - b.col);
    for (let i = 0; i < hits.length; i++) {
      const hit = hits[i]!;
      assert.ok(hit.col >= 1 && hit.col + hit.width <= FRAME_WIDTH - 1);
      const next = hits[i + 1];
      if (next) assert.ok(hit.col + hit.width <= next.col);
    }
  });
});

describe('gradient', () => {
  it('walks red to green across a focus phase', () => {
    const [r0, g0] = phaseColor('work', 0);
    const [r1, g1] = phaseColor('work', 1);
    assert.ok(r0 > g0, 'starts red');
    assert.ok(g1 > r1, 'ends green');
  });

  it('walks blue-green to orange across a break', () => {
    const start = phaseColor('short-break', 0);
    const end = phaseColor('short-break', 1);
    assert.ok(start[2] > start[0], 'starts cool');
    assert.ok(end[0] > end[2], 'ends warm');
  });

  it('stays saturated through the midpoint instead of going muddy', () => {
    // The whole reason for interpolating hue: an RGB lerp bottoms out here.
    for (const t of [0.25, 0.5, 0.75]) {
      const rgb = phaseColor('work', t);
      assert.ok(Math.max(...rgb) - Math.min(...rgb) > 100, `t=${t} keeps its chroma`);
    }
  });

  it('clamps out-of-range progress', () => {
    assert.deepEqual(phaseColor('work', -1), phaseColor('work', 0));
    assert.deepEqual(phaseColor('work', 2), phaseColor('work', 1));
  });

  it('converts hsl and back to the 256 cube sensibly', () => {
    assert.deepEqual(hslToRgb(0, 1, 0.5), [255, 0, 0]);
    assert.deepEqual(hslToRgb(120, 1, 0.5), [0, 255, 0]);
    assert.equal(rgbToAnsi256([255, 0, 0]), 196);
    assert.equal(rgbToAnsi256([0, 0, 0]), 16);
  });
});
