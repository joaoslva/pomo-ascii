/**
 * A jingle, from scratch.
 *
 * The terminal bell is one short beep that most terminals render quietly, mute
 * by default, or turn into a flash — which is a poor way to tell someone their
 * focus block is over. So we synthesise a few notes into a WAV and hand it to
 * whatever can play audio on this machine, falling back to the bell when
 * nothing can.
 *
 * The notes are plain data on purpose. Making them configurable later is a
 * matter of parsing a flag into an array, not of touching any of this.
 */

import { spawn } from 'node:child_process';
import { unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/** One note. `hz` of 0 is a rest. */
export type Note = { hz: number; ms: number };

/**
 * Equal temperament, A4 = 440. Named here so the jingles below read as music
 * rather than as a list of frequencies.
 */
const C5 = 523.25;
const E5 = 659.25;
const G5 = 783.99;
const A5 = 880.0;
const C6 = 1046.5;
const G4 = 392.0;

export const JINGLES: Record<string, readonly Note[]> = {
  /** End of a focus block: up and out, you're done. */
  'focus': [
    { hz: C5, ms: 90 },
    { hz: E5, ms: 90 },
    { hz: G5, ms: 90 },
    { hz: C6, ms: 260 },
  ],
  /** End of a break: two notes, lower and softer, back to it. */
  'break': [
    { hz: G4, ms: 110 },
    { hz: C5, ms: 240 },
  ],
  /** End of the whole session. */
  'done': [
    { hz: C5, ms: 100 },
    { hz: E5, ms: 100 },
    { hz: G5, ms: 100 },
    { hz: C6, ms: 100 },
    { hz: 0, ms: 70 },
    { hz: A5, ms: 120 },
    { hz: C6, ms: 420 },
  ],
};

const RATE = 44_100;
/** Well under full scale: this is a notification, not an alarm. */
const AMPLITUDE = 0.32;
/** Fade in and out of every note, or each one starts and ends with a click. */
const ATTACK_MS = 6;
const RELEASE_MS = 45;

function envelope(position: number, total: number): number {
  const attack = Math.min(ATTACK_MS * (RATE / 1000), total / 2);
  const release = Math.min(RELEASE_MS * (RATE / 1000), total / 2);
  if (position < attack) return position / attack;
  const remaining = total - position;
  if (remaining < release) return remaining / release;
  return 1;
}

/** A 16-bit mono PCM WAV of `notes`, header and all. */
export function wav(notes: readonly Note[]): Buffer {
  const counts = notes.map((note) => Math.max(0, Math.round((note.ms / 1000) * RATE)));
  const total = counts.reduce((sum, count) => sum + count, 0);

  const data = Buffer.alloc(total * 2);
  let offset = 0;

  notes.forEach((note, i) => {
    const count = counts[i]!;
    for (let n = 0; n < count; n++) {
      let value = 0;
      if (note.hz > 0) {
        const phase = (2 * Math.PI * note.hz * n) / RATE;
        // A touch of the second harmonic: a bare sine reads as a test tone.
        value = (Math.sin(phase) + 0.22 * Math.sin(2 * phase)) / 1.22;
        value *= AMPLITUDE * envelope(n, count);
      }
      data.writeInt16LE(Math.round(Math.max(-1, Math.min(1, value)) * 32_767), offset);
      offset += 2;
    }
  });

  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + data.length, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16); // PCM header size
  header.writeUInt16LE(1, 20); // PCM
  header.writeUInt16LE(1, 22); // mono
  header.writeUInt32LE(RATE, 24);
  header.writeUInt32LE(RATE * 2, 28); // bytes per second
  header.writeUInt16LE(2, 32); // block align
  header.writeUInt16LE(16, 34); // bits per sample
  header.write('data', 36);
  header.writeUInt32LE(data.length, 40);

  return Buffer.concat([header, data]);
}

type Player = { command: string; args: (file: string) => string[] };

/**
 * Tried in order. Everything takes a path rather than stdin, because afplay
 * and PowerShell can't read stdin anyway and one code path beats two.
 */
const PLAYERS: readonly Player[] =
  process.platform === 'darwin'
    ? [{ command: 'afplay', args: (file) => [file] }]
    : process.platform === 'win32'
      ? [
          {
            command: 'powershell',
            args: (file) => [
              '-NoProfile',
              '-Command',
              `(New-Object Media.SoundPlayer '${file}').PlaySync()`,
            ],
          },
        ]
      : [
          { command: 'pw-play', args: (file) => [file] },
          { command: 'paplay', args: (file) => [file] },
          { command: 'aplay', args: (file) => ['-q', file] },
          {
            command: 'ffplay',
            args: (file) => ['-nodisp', '-autoexit', '-loglevel', 'quiet', file],
          },
        ];

/**
 * Plays jingles, or rings the bell if this machine has nothing to play them
 * with. Which player works is discovered by trying them: a missing binary
 * fails the spawn, which is cheaper and more honest than probing PATH.
 */
export class Chime {
  readonly #fallback: () => void;
  readonly #files = new Map<string, string>();

  #player: Player | null = null;
  #exhausted = false;

  constructor(fallback: () => void) {
    this.#fallback = fallback;
  }

  play(name: string, notes: readonly Note[]): void {
    if (this.#exhausted) {
      this.#fallback();
      return;
    }
    const file = this.#file(name, notes);
    if (file === null) {
      this.#exhausted = true;
      this.#fallback();
      return;
    }
    this.#spawn(file, this.#player ? PLAYERS.indexOf(this.#player) : 0);
  }

  /** Removes the temp files. Safe to call more than once. */
  dispose(): void {
    for (const file of this.#files.values()) {
      try {
        unlinkSync(file);
      } catch {
        // Already gone, or never written. Either way there's nothing to do.
      }
    }
    this.#files.clear();
  }

  #file(name: string, notes: readonly Note[]): string | null {
    const existing = this.#files.get(name);
    if (existing !== undefined) return existing;

    const file = join(tmpdir(), `pomo-${process.pid}-${name}.wav`);
    try {
      writeFileSync(file, wav(notes));
    } catch {
      return null;
    }
    this.#files.set(name, file);
    return file;
  }

  #spawn(file: string, index: number): void {
    const player = PLAYERS[index];
    if (!player) {
      this.#exhausted = true;
      this.#fallback();
      return;
    }

    let child;
    try {
      child = spawn(player.command, player.args(file), {
        stdio: 'ignore',
        // Detached so quitting the timer doesn't cut the last note short.
        detached: true,
      });
    } catch {
      this.#spawn(file, index + 1);
      return;
    }

    // ENOENT and friends arrive here, asynchronously, rather than as a throw.
    child.on('error', () => {
      if (this.#player === player) this.#player = null;
      this.#spawn(file, index + 1);
    });
    child.on('spawn', () => {
      this.#player = player;
    });
    child.unref();
  }
}
