import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { bigText, bigTextWidth, DIGIT_HEIGHT } from '../src/digits.ts';
import { hslToRgb, phaseColor, rgbToAnsi256 } from '../src/gradient.ts';
import { ASCII, UNICODE } from '../src/glyphs.ts';
import { COMPACT, FULL, layout, render, TIERS, TINY, tooSmall, type Tier } from '../src/render.ts';
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
    task: '',
    strict: false,
    tier: FULL,
    ...overrides,
  });

describe('strict mode', () => {
  it('drops the hit boxes for skip and reset while focus runs', () => {
    const ids = view({ strict: true }).hits.map((h) => h.id);
    assert.deepEqual(ids, ['toggle', 'quit']);
  });

  it('leaves the buttons alone during a break', () => {
    const session = skip(createSession(buildPhases(DURATIONS), T0), T0);
    const ids = view({ session, strict: true }).hits.map((h) => h.id);
    assert.deepEqual(ids, ['toggle', 'skip', 'restart', 'quit']);
  });

  it('leaves them alone once focus is paused', () => {
    const session = pause(createSession(buildPhases(DURATIONS), T0), T0 + 60_000);
    const ids = view({ session, strict: true, now: T0 + 60_000 }).hits.map((h) => h.id);
    assert.deepEqual(ids, ['toggle', 'skip', 'restart', 'quit']);
  });

  it('still draws all four buttons, just dimmed', () => {
    const line = view({ strict: true }).lines.map(strip).find((l) => l.includes('skip'));
    assert.ok(line?.includes('[ skip ]'), 'the button is still on screen');
  });
});

describe('the task label', () => {
  it('takes the status row from the key hint', () => {
    const status = view({ task: 'write the parser' }).lines.map(strip).at(-2) ?? '';
    assert.ok(status.includes('write the parser'), status);
    assert.ok(!status.includes('space s r q'), status);
  });

  it('clips a long task rather than dropping it, and says that it clipped', () => {
    const status = view({ task: 'x'.repeat(200) }).lines.map(strip).at(-2) ?? '';
    assert.ok(status.includes('round 1/4'), status);
    assert.ok(status.includes('xxx'), 'the task is still there');
    assert.ok(status.includes(UNICODE.ellipsis), 'and it admits it was cut');
    assert.equal(status.length, FULL.width);
  });

  it('uses the ASCII mark for the clip when the glyphs are ASCII', () => {
    const status = view({ task: 'y'.repeat(200), glyphs: ASCII }).lines.map(strip).at(-2) ?? '';
    assert.ok(status.includes(ASCII.ellipsis), status);
    assert.equal(status.length, FULL.width);
  });

  it('shows the hint again when there is no task', () => {
    const status = view({ task: '' }).lines.map(strip).at(-2) ?? '';
    assert.ok(status.includes('space s r q'), status);
  });
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

describe('layout', () => {
  it('picks the biggest tier that fits', () => {
    assert.equal(layout(80, 24), FULL);
    assert.equal(layout(44, 13), FULL);
    assert.equal(layout(43, 13), COMPACT);
    assert.equal(layout(44, 12), COMPACT);
    assert.equal(layout(34, 9), COMPACT);
    assert.equal(layout(33, 9), TINY);
    assert.equal(layout(16, 3), TINY);
    assert.equal(layout(15, 3), null);
    assert.equal(layout(16, 2), null);
  });

  it('orders the tiers largest first', () => {
    for (let i = 1; i < TIERS.length; i++) {
      const previous = TIERS[i - 1]!;
      const tier = TIERS[i]!;
      assert.ok(tier.width < previous.width && tier.height < previous.height);
    }
  });
});

describe('too small', () => {
  it('never draws outside the space it was given', () => {
    for (let columns = 0; columns < 20; columns++) {
      for (let rows = 0; rows < 5; rows++) {
        const lines = tooSmall(columns, rows);
        assert.ok(lines.length <= rows, `${columns}x${rows} fits vertically`);
        for (const line of lines) {
          assert.ok(line.length <= columns, `${columns}x${rows}: "${line}" fits horizontally`);
        }
      }
    }
  });

  it('says what is needed when there is room to say it', () => {
    const lines = tooSmall(12, 4).join(' ');
    assert.ok(lines.includes('12x4'), 'reports the current size');
    assert.ok(lines.includes(`${TINY.width}x${TINY.height}`), 'reports the required size');
  });

  it('only ever runs at sizes the tiny tier already rejected', () => {
    // Anything wider than this would be unreachable dead weight.
    for (let columns = 0; columns < 16; columns++) {
      for (let rows = 0; rows < 40; rows++) {
        if (layout(columns, rows)) continue;
        for (const line of tooSmall(columns, rows)) assert.ok(line.length <= columns);
      }
    }
  });
});

describe('render', () => {
  it('produces a frame of exactly the declared size, in every tier', () => {
    for (const tier of TIERS) {
      const frame = view({ tier });
      assert.equal(frame.lines.length, tier.height, `${tier.name} height`);
      for (const line of frame.lines) {
        assert.equal(strip(line).length, tier.width, `${tier.name} width`);
      }
    }
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
          for (const tier of TIERS) {
            const frame = render({
              session,
              now: T0 + 60_000,
              mode,
              glyphs: UNICODE,
              hovered: 'skip',
              mouse,
              task: '',
              strict: false,
              tier,
            });
            assert.equal(frame.lines.length, tier.height);
            for (const line of frame.lines) assert.equal(strip(line).length, tier.width);
          }
        }
      }
    }
  });

  it('stays rectangular with a round count the status row cannot draw dots for', () => {
    const many = { ...DURATIONS, rounds: 40 };
    for (const tier of TIERS) {
      const frame = view({ session: createSession(buildPhases(many), T0), tier });
      for (const line of frame.lines) assert.equal(strip(line).length, tier.width);
    }
  });

  it('shows the full time at the top of a phase', () => {
    const clock = view().lines.slice(2, 2 + DIGIT_HEIGHT).map(strip).join('\n');
    const expected = bigText('25:00', UNICODE.digit);
    for (const line of expected) assert.ok(clock.includes(line.trimEnd()));
  });

  it('emits no escape codes when colour is off', () => {
    for (const tier of TIERS) {
      for (const line of view({ mode: 'none', tier }).lines) {
        assert.equal(line.includes('\x1b'), false);
      }
    }
  });

  it('carries the round count in the compact header, which has no status row', () => {
    const header = strip(view({ tier: COMPACT }).lines[0]!);
    assert.ok(header.includes('focus 1/4'), header);
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
    for (const tier of [FULL, COMPACT] as Tier[]) {
      const frame = view({ tier });
      assert.equal(frame.hits.length, 4);
      for (const hit of frame.hits) {
        const row = strip(frame.lines[hit.row]!);
        const text = row.slice(hit.col, hit.col + hit.width);
        assert.equal(text.startsWith('['), true, `${tier.name}: ${hit.id} starts at a bracket`);
        assert.equal(text.endsWith(']'), true, `${tier.name}: ${hit.id} ends at a bracket`);
      }
    }
  });

  it('has nothing to click in the tiny tier', () => {
    assert.deepEqual(view({ tier: TINY }).hits, []);
  });

  it('points at the row it says it does', () => {
    const frame = view();
    const row = strip(frame.lines[10]!);

    for (const hit of frame.hits) {
      assert.equal(hit.row, 10);
      const text = row.slice(hit.col, hit.col + hit.width);
      assert.equal(text.startsWith('['), true, `hit for ${hit.id} starts at a bracket`);
    }
  });

  it('never overlaps or escapes the frame', () => {
    const hits = [...view().hits].sort((a, b) => a.col - b.col);
    for (let i = 0; i < hits.length; i++) {
      const hit = hits[i]!;
      assert.ok(hit.col >= 1 && hit.col + hit.width <= FULL.width - 1);
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
