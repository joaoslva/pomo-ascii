/**
 * The whole timer, as pure functions over a plain object.
 *
 * Two ideas keep this simple:
 *
 * 1. A session is a fixed queue of phases built up front. "Skip" is just an
 *    index bump, and nothing in the app needs an `isBreak` flag.
 * 2. Time is never counted. We store how much has already elapsed plus the
 *    wall-clock instant the phase last resumed, and derive the rest. Ticks can
 *    drift, the machine can sleep for an hour, and the clock still lands right.
 */

export type PhaseKind = 'work' | 'short-break' | 'long-break';

export type Phase = {
  kind: PhaseKind;
  /** Total length of the phase in seconds. */
  seconds: number;
};

export type Session = {
  readonly phases: readonly Phase[];
  /** Index into `phases`; equals `phases.length` once the session is over. */
  index: number;
  /** Milliseconds banked in the current phase before the latest resume. */
  elapsedBefore: number;
  /** Epoch ms of the latest resume, or null while paused. */
  runningSince: number | null;
};

export type PhaseDurations = {
  work: number;
  shortBreak: number;
  longBreak: number;
  rounds: number;
};

/**
 * work, break, work, break, ..., work, long break.
 * `rounds` work phases, with the long one at the end instead of a short one.
 */
export function buildPhases(d: PhaseDurations): Phase[] {
  const phases: Phase[] = [];
  for (let round = 1; round <= d.rounds; round++) {
    phases.push({ kind: 'work', seconds: d.work });
    phases.push(
      round === d.rounds
        ? { kind: 'long-break', seconds: d.longBreak }
        : { kind: 'short-break', seconds: d.shortBreak },
    );
  }
  return phases;
}

export function createSession(phases: readonly Phase[], now: number, autostart = true): Session {
  return {
    phases,
    index: 0,
    elapsedBefore: 0,
    runningSince: autostart ? now : null,
  };
}

export function isFinished(s: Session): boolean {
  return s.index >= s.phases.length;
}

export function isRunning(s: Session): boolean {
  return s.runningSince !== null && !isFinished(s);
}

export function currentPhase(s: Session): Phase | null {
  return s.phases[s.index] ?? null;
}

export function elapsedMs(s: Session, now: number): number {
  const live = s.runningSince === null ? 0 : Math.max(0, now - s.runningSince);
  return s.elapsedBefore + live;
}

export function remainingMs(s: Session, now: number): number {
  const phase = currentPhase(s);
  if (!phase) return 0;
  return Math.max(0, phase.seconds * 1000 - elapsedMs(s, now));
}

/** 0 at the start of the current phase, 1 at its end. */
export function progress(s: Session, now: number): number {
  const phase = currentPhase(s);
  if (!phase || phase.seconds <= 0) return 1;
  return Math.min(1, Math.max(0, elapsedMs(s, now) / (phase.seconds * 1000)));
}

export function pause(s: Session, now: number): Session {
  if (!isRunning(s)) return s;
  return { ...s, elapsedBefore: elapsedMs(s, now), runningSince: null };
}

export function resume(s: Session, now: number): Session {
  if (s.runningSince !== null || isFinished(s)) return s;
  return { ...s, runningSince: now };
}

export function toggle(s: Session, now: number): Session {
  return isRunning(s) ? pause(s, now) : resume(s, now);
}

/** Jump to the next phase, keeping the running/paused state. */
export function skip(s: Session, now: number): Session {
  if (isFinished(s)) return s;
  const next = s.index + 1;
  return {
    ...s,
    index: next,
    elapsedBefore: 0,
    runningSince: s.runningSince === null || next >= s.phases.length ? null : now,
  };
}

/** Restart the current phase from the top. */
export function restartPhase(s: Session, now: number): Session {
  if (isFinished(s)) return s;
  return { ...s, elapsedBefore: 0, runningSince: s.runningSince === null ? null : now };
}

/** Restart the whole session, running. */
export function restartSession(s: Session, now: number): Session {
  return createSession(s.phases, now, true);
}

/**
 * New phase lengths, applied to the phases that haven't started yet.
 *
 * The running phase keeps the length it started with, on purpose: changing it
 * under someone who is watching the clock would make the number jump, and the
 * one thing a timer has to be is believable. Everything after it comes from a
 * freshly built queue, so changing `rounds` moves the long break too.
 */
export function reshape(s: Session, d: PhaseDurations): Session {
  const rebuilt = buildPhases(d);
  // A finished session has nothing left to reshape, but it does have an
  // "again" button, and that should start the session you just described.
  if (isFinished(s)) return { ...s, phases: rebuilt, index: rebuilt.length };
  return { ...s, phases: [...s.phases.slice(0, s.index + 1), ...rebuilt.slice(s.index + 1)] };
}

/**
 * Advance past every phase whose time is up. Returns the phases that just
 * ended so the caller can ring the bell — plural because a long sleep can
 * blow through more than one.
 */
export function tick(s: Session, now: number): { session: Session; completed: Phase[] } {
  const completed: Phase[] = [];
  let session = s;

  while (isRunning(session)) {
    const phase = currentPhase(session);
    if (!phase) break;

    const overshoot = elapsedMs(session, now) - phase.seconds * 1000;
    if (overshoot < 0) break;

    completed.push(phase);
    const next = session.index + 1;
    session = {
      ...session,
      index: next,
      // Roll the overrun into the next phase so a slow tick can't add time.
      elapsedBefore: 0,
      runningSince: next >= session.phases.length ? null : now - overshoot,
    };
  }

  return { session, completed };
}

/** How many work phases are fully behind us. */
export function completedWorkPhases(s: Session): number {
  let count = 0;
  for (let i = 0; i < s.index && i < s.phases.length; i++) {
    if (s.phases[i]?.kind === 'work') count++;
  }
  return count;
}

export function totalWorkPhases(s: Session): number {
  return s.phases.filter((p) => p.kind === 'work').length;
}

/** 1-based round number for display; clamped to the total once finished. */
export function currentRound(s: Session): number {
  const total = totalWorkPhases(s);
  if (isFinished(s)) return total;
  return Math.min(total, completedWorkPhases(s) + 1);
}

/** mm:ss, rounded up so the clock shows 25:00 the instant it starts. */
export function formatClock(ms: number): string {
  const totalSeconds = Math.ceil(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

/** Total time spent in work phases: whole ones behind us, plus the live one. */
export function focusedMs(s: Session, now: number): number {
  let ms = 0;
  for (let i = 0; i < s.index && i < s.phases.length; i++) {
    const phase = s.phases[i]!;
    if (phase.kind === 'work') ms += phase.seconds * 1000;
  }
  const phase = currentPhase(s);
  if (phase?.kind === 'work') ms += Math.min(elapsedMs(s, now), phase.seconds * 1000);
  return ms;
}
