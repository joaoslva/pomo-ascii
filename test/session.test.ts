import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  buildPhases,
  completedWorkPhases,
  createSession,
  currentPhase,
  currentRound,
  formatClock,
  isFinished,
  isRunning,
  pause,
  progress,
  remainingMs,
  reshape,
  restartPhase,
  restartSession,
  resume,
  skip,
  tick,
  toggle,
  totalWorkPhases,
} from '../src/session.ts';

const DURATIONS = { work: 25 * 60, shortBreak: 5 * 60, longBreak: 15 * 60, rounds: 4 };
const T0 = 1_700_000_000_000;

describe('buildPhases', () => {
  it('alternates work and break, ending on the long break', () => {
    const kinds = buildPhases(DURATIONS).map((p) => p.kind);
    assert.deepEqual(kinds, [
      'work', 'short-break',
      'work', 'short-break',
      'work', 'short-break',
      'work', 'long-break',
    ]);
  });

  it('handles a single round', () => {
    const kinds = buildPhases({ ...DURATIONS, rounds: 1 }).map((p) => p.kind);
    assert.deepEqual(kinds, ['work', 'long-break']);
  });
});

describe('formatClock', () => {
  it('rounds up so a fresh phase reads at its full length', () => {
    assert.equal(formatClock(25 * 60 * 1000), '25:00');
    assert.equal(formatClock(24 * 60 * 1000 + 59_001), '25:00');
  });

  it('pads both fields', () => {
    assert.equal(formatClock(61_000), '01:01');
    assert.equal(formatClock(0), '00:00');
  });
});

describe('pause and resume', () => {
  it('freezes the remaining time while paused', () => {
    const session = createSession(buildPhases(DURATIONS), T0);
    const paused = pause(session, T0 + 60_000);

    assert.equal(remainingMs(paused, T0 + 60_000), 24 * 60 * 1000);
    // An hour on the wall clock, but the timer didn't move.
    assert.equal(remainingMs(paused, T0 + 3_600_000), 24 * 60 * 1000);
    assert.equal(isRunning(paused), false);
  });

  it('picks up where it left off', () => {
    const session = createSession(buildPhases(DURATIONS), T0);
    const paused = pause(session, T0 + 60_000);
    const resumed = resume(paused, T0 + 3_600_000);

    assert.equal(remainingMs(resumed, T0 + 3_600_000), 24 * 60 * 1000);
    assert.equal(remainingMs(resumed, T0 + 3_660_000), 23 * 60 * 1000);
  });

  it('toggles both ways', () => {
    const session = createSession(buildPhases(DURATIONS), T0);
    assert.equal(isRunning(toggle(session, T0)), false);
    assert.equal(isRunning(toggle(toggle(session, T0), T0)), true);
  });
});

describe('tick', () => {
  it('does nothing before the phase is up', () => {
    const session = createSession(buildPhases(DURATIONS), T0);
    const result = tick(session, T0 + 60_000);
    assert.equal(result.completed.length, 0);
    assert.equal(result.session.index, 0);
  });

  it('advances to the break and reports what finished', () => {
    const session = createSession(buildPhases(DURATIONS), T0);
    const result = tick(session, T0 + 25 * 60 * 1000);

    assert.equal(result.completed.length, 1);
    assert.equal(result.completed[0]?.kind, 'work');
    assert.equal(currentPhase(result.session)?.kind, 'short-break');
  });

  it('carries the overshoot into the next phase instead of granting free time', () => {
    const session = createSession(buildPhases(DURATIONS), T0);
    // The tick lands 3 seconds late.
    const result = tick(session, T0 + 25 * 60 * 1000 + 3_000);
    assert.equal(remainingMs(result.session, T0 + 25 * 60 * 1000 + 3_000), 5 * 60 * 1000 - 3_000);
  });

  it('catches up across several phases after a long sleep', () => {
    const session = createSession(buildPhases(DURATIONS), T0);
    const result = tick(session, T0 + 45 * 60 * 1000);

    assert.deepEqual(result.completed.map((p) => p.kind), ['work', 'short-break']);
    assert.equal(result.session.index, 2);
    assert.equal(remainingMs(result.session, T0 + 45 * 60 * 1000), 10 * 60 * 1000);
  });

  it('stops at the end of the session', () => {
    const session = createSession(buildPhases({ ...DURATIONS, rounds: 1 }), T0);
    const result = tick(session, T0 + 10 * 60 * 60 * 1000);

    assert.equal(isFinished(result.session), true);
    assert.equal(isRunning(result.session), false);
    assert.equal(result.completed.length, 2);
  });
});

describe('skip and restart', () => {
  it('skip moves on and keeps running', () => {
    const session = createSession(buildPhases(DURATIONS), T0);
    const skipped = skip(session, T0 + 60_000);

    assert.equal(currentPhase(skipped)?.kind, 'short-break');
    assert.equal(remainingMs(skipped, T0 + 60_000), 5 * 60 * 1000);
    assert.equal(isRunning(skipped), true);
  });

  it('skip keeps a paused session paused', () => {
    const session = pause(createSession(buildPhases(DURATIONS), T0), T0 + 60_000);
    assert.equal(isRunning(skip(session, T0 + 60_000)), false);
  });

  it('restartPhase puts the current phase back to full', () => {
    const session = createSession(buildPhases(DURATIONS), T0);
    const restarted = restartPhase(session, T0 + 10 * 60 * 1000);
    assert.equal(remainingMs(restarted, T0 + 10 * 60 * 1000), 25 * 60 * 1000);
  });

  it('restartSession rewinds the round count, not just the phase', () => {
    const now = T0 + 60_000;
    const session = skip(skip(createSession(buildPhases(DURATIONS), T0), now), now);
    assert.equal(currentRound(session), 2);

    const reset = restartSession(session, now);
    assert.equal(currentRound(reset), 1);
    assert.equal(completedWorkPhases(reset), 0);
    assert.equal(currentPhase(reset)?.kind, 'work');
    assert.equal(remainingMs(reset, now), 25 * 60 * 1000);
  });

  it('restartSession starts the clock again after the session has finished', () => {
    const session = createSession(buildPhases(DURATIONS), T0);
    const finished = tick(session, T0 + 24 * 60 * 60 * 1000).session;
    assert.equal(isFinished(finished), true);

    const reset = restartSession(finished, T0);
    assert.equal(isFinished(reset), false);
    assert.equal(isRunning(reset), true);
  });
});

describe('progress and counters', () => {
  it('runs 0 to 1 across the phase', () => {
    const session = createSession(buildPhases(DURATIONS), T0);
    assert.equal(progress(session, T0), 0);
    assert.equal(progress(session, T0 + 12.5 * 60 * 1000), 0.5);
    assert.equal(progress(session, T0 + 60 * 60 * 1000), 1);
  });

  it('counts completed work phases and the current round', () => {
    let session = createSession(buildPhases(DURATIONS), T0);
    assert.equal(currentRound(session), 1);
    assert.equal(completedWorkPhases(session), 0);

    session = skip(session, T0); // into the first break
    assert.equal(completedWorkPhases(session), 1);
    assert.equal(currentRound(session), 2);
  });
});

describe('reshape', () => {
  const shorter = { work: 10 * 60, shortBreak: 60, longBreak: 5 * 60, rounds: 4 };

  it('leaves the phase you are watching at the length it started with', () => {
    const session = reshape(createSession(buildPhases(DURATIONS), T0), shorter);
    assert.equal(currentPhase(session)?.seconds, 25 * 60);
    assert.equal(session.phases[1]?.seconds, 60);
  });

  it('keeps the clock exactly where it was', () => {
    const running = createSession(buildPhases(DURATIONS), T0);
    const session = reshape(running, shorter);
    assert.equal(remainingMs(session, T0 + 60_000), remainingMs(running, T0 + 60_000));
    assert.equal(session.index, running.index);
  });

  it('changes the phases that have not started, wherever you are in the queue', () => {
    const started = skip(skip(createSession(buildPhases(DURATIONS), T0), T0), T0);
    const session = reshape(started, shorter);
    assert.equal(session.phases[1]?.seconds, 5 * 60, 'the break already behind us');
    assert.equal(session.phases[2]?.seconds, 25 * 60, 'the phase we are in');
    assert.equal(session.phases[3]?.seconds, 60, 'the one after it');
  });

  it('moves the long break when the number of rounds moves', () => {
    const session = reshape(createSession(buildPhases(DURATIONS), T0), { ...DURATIONS, rounds: 2 });
    assert.deepEqual(session.phases.map((p) => p.kind), [
      'work', 'short-break', 'work', 'long-break',
    ]);
    assert.equal(totalWorkPhases(session), 2);
  });

  it('cuts the session short when there are fewer rounds than you have done', () => {
    let session = createSession(buildPhases(DURATIONS), T0);
    for (let i = 0; i < 6; i++) session = skip(session, T0);
    session = reshape(session, { ...DURATIONS, rounds: 2 });
    assert.equal(isFinished(session), false, 'the phase you are in still finishes');
    assert.equal(session.phases.length, 7);
  });

  it('leaves a finished session finished, ready to start again on the new shape', () => {
    let session = createSession(buildPhases(DURATIONS), T0);
    for (let i = 0; i < 8; i++) session = skip(session, T0);
    assert.equal(isFinished(session), true);

    session = reshape(session, { ...DURATIONS, rounds: 2 });
    assert.equal(isFinished(session), true);
    assert.equal(totalWorkPhases(restartSession(session, T0)), 2);
  });
});
