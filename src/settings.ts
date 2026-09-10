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

import { DEFAULTS, type Config, type Messages, type SoundMode } from './config.ts';

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
  | 'menu'
  | 'messages'
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
  'menu',
  'messages',
] as const satisfies readonly (keyof Stored)[];

/** Grouped by the check they need, which is also how `sanitize` reads them. */
const NUMERIC_KEYS = ['work', 'shortBreak', 'longBreak', 'rounds'] as const;
const BOOLEAN_KEYS = ['color', 'ascii', 'mouse', 'strict', 'title', 'notify', 'menu'] as const;
const MESSAGE_KEYS = ['focus', 'break', 'done'] as const satisfies readonly (keyof Messages)[];

/** Long enough for a sentence, short enough that a desktop will show all of it. */
export const MESSAGE_MAX = 60;

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

  const messages = sanitizeMessages(source['messages']);
  if (messages) out.messages = messages;

  return out;
}

/**
 * The three notification bodies. Missing ones fall back to the default rather
 * than to nothing, so half a `messages` object still leaves you with three
 * working notifications. Returns null when there was nothing usable in there
 * at all, which keeps `sanitize` free of keys the file never mentioned.
 */
function sanitizeMessages(raw: unknown): Messages | null {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null;
  const source = raw as Record<string, unknown>;
  const out = { ...DEFAULTS.messages };
  let found = false;

  for (const key of MESSAGE_KEYS) {
    const value = source[key];
    if (typeof value !== 'string' || value.trim() === '') continue;
    out[key] = value.trim().slice(0, MESSAGE_MAX);
    found = true;
  }

  return found ? out : null;
}

/** Every stored setting, spelled out, so the file documents its own format. */
export function serialize(config: Stored): string {
  const out: Record<string, unknown> = {};
  for (const key of STORED_KEYS) out[key] = config[key];
  return `${JSON.stringify(out, null, 2)}\n`;
}

/** The half of a live config that belongs in the file. */
export function toStored(config: Config): Stored {
  const out: Record<string, unknown> = {};
  for (const key of STORED_KEYS) out[key] = config[key];
  return out as Stored;
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

/**
 * Writes the settings back, which is what the menu's save button does.
 *
 * Anything already in the file that we don't recognise is kept: `sanitize`
 * promises that a half-finished experiment in there isn't an error, and it
 * would be a poor kind of promise if saving from the menu quietly deleted it.
 * Returns whether the write landed — a read-only home is still a fine place to
 * run a timer, the settings just won't outlive the session.
 */
export function save(path: string, config: Stored): boolean {
  let existing: Record<string, unknown> = {};
  try {
    const raw: unknown = JSON.parse(readFileSync(path, 'utf8'));
    if (typeof raw === 'object' && raw !== null && !Array.isArray(raw)) {
      existing = raw as Record<string, unknown>;
    }
  } catch {
    // No file, or nothing we can read. We're about to write a whole one.
  }

  const merged: Record<string, unknown> = { ...existing };
  for (const key of STORED_KEYS) merged[key] = config[key];

  try {
    mkdirSync(join(path, '..'), { recursive: true });
    writeFileSync(path, `${JSON.stringify(merged, null, 2)}\n`);
    return true;
  } catch {
    return false;
  }
}
