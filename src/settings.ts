/**
 * The config file.
 *
 * Flags are good for `--work 25` and bad for anything you want to still be
 * true tomorrow, so preferences live in a JSON file and the flags override it
 * for the length of one run. Precedence is the boring one: flag, then file,
 * then the built-in default.
 *
 * Two rules keep this from ever being the reason the timer won't start. A file
 * we can't read is treated as a file that isn't there, and a value we don't
 * recognise is dropped rather than argued with — a typo in one key shouldn't
 * cost you the other seven. Writing the starter file is best-effort for the
 * same reason: a read-only home is a fine place to run a pomodoro timer.
 */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

import { DEFAULTS, type Config, type SoundMode } from './config.ts';

/** The settings that live in the file. The rest are per-run and flag-only. */
export type Stored = Pick<
  Config,
  | 'work'
  | 'shortBreak'
  | 'longBreak'
  | 'rounds'
  | 'color'
  | 'ascii'
  | 'mouse'
  | 'sound'
  | 'strict'
  | 'title'
  | 'notify'
>;

const STORED_KEYS = [
  'work',
  'shortBreak',
  'longBreak',
  'rounds',
  'color',
  'ascii',
  'mouse',
  'sound',
  'strict',
  'title',
  'notify',
] as const satisfies readonly (keyof Stored)[];

/** Grouped by the check they need, which is also how `sanitize` reads them. */
const NUMERIC_KEYS = ['work', 'shortBreak', 'longBreak', 'rounds'] as const;
const BOOLEAN_KEYS = ['color', 'ascii', 'mouse', 'strict', 'title', 'notify'] as const;

const SOUND_MODES: readonly SoundMode[] = ['jingle', 'bell', 'off'];

export function configDir(env: NodeJS.ProcessEnv = process.env, home = homedir()): string {
  const xdg = env['XDG_CONFIG_HOME'];
  const base = xdg !== undefined && xdg.trim() !== '' ? xdg : join(home, '.config');
  return join(base, 'pomo');
}

export function configPath(env?: NodeJS.ProcessEnv, home?: string): string {
  return join(configDir(env, home), 'config.json');
}

/**
 * Keeps the keys we know, at the types we expect, and quietly drops the rest.
 * Unknown keys are left alone rather than reported: the file is meant to be
 * edited by hand, and a half-finished experiment in there is not an error.
 */
export function sanitize(raw: unknown): Partial<Stored> {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return {};
  const source = raw as Record<string, unknown>;
  const out: Partial<Stored> = {};

  for (const key of NUMERIC_KEYS) {
    const value = source[key];
    if (typeof value === 'number' && Number.isInteger(value) && value > 0) out[key] = value;
  }

  for (const key of BOOLEAN_KEYS) {
    const value = source[key];
    if (typeof value === 'boolean') out[key] = value;
  }

  const sound = source['sound'];
  if (typeof sound === 'string' && SOUND_MODES.includes(sound as SoundMode)) {
    out.sound = sound as SoundMode;
  }

  return out;
}

/** Every stored setting, spelled out, so the file documents its own format. */
export function serialize(config: Stored): string {
  const out: Record<string, unknown> = {};
  for (const key of STORED_KEYS) out[key] = config[key];
  return `${JSON.stringify(out, null, 2)}\n`;
}

/** The stored settings, or nothing at all if the file is missing or broken. */
export function load(path = configPath()): Partial<Stored> {
  let raw: string;
  try {
    raw = readFileSync(path, 'utf8');
  } catch {
    return {};
  }
  try {
    return sanitize(JSON.parse(raw));
  } catch {
    return {};
  }
}

/**
 * Writes the starter file if there isn't one. Returns whether it wrote, so the
 * caller can mention it — a file that appears in your home directory without
 * anyone saying so is a small rudeness.
 */
export function ensure(path = configPath(), defaults: Stored = DEFAULTS): boolean {
  try {
    readFileSync(path);
    return false;
  } catch {
    // Not there, or not readable. Either way, try to put one down.
  }
  try {
    mkdirSync(join(path, '..'), { recursive: true });
    writeFileSync(path, serialize(defaults), { flag: 'wx' });
    return true;
  } catch {
    return false;
  }
}
