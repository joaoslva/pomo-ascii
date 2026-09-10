/**
 * The settings menu, as pure functions over a plain object.
 *
 * Same deal as `session.ts`: no I/O, no terminal, nothing that has to happen in
 * order. A menu is a list of fields, an index saying which one has focus, and
 * a draft string that is non-null exactly while you're typing into a value.
 * `cli.ts` turns keypresses into calls on this and `render.ts` draws whatever
 * comes back.
 *
 * The fields are described rather than coded: each one says how to show its
 * value and how to nudge it, which is why adding a setting to the menu is a
 * line in `FIELDS` and nothing else. The list is deliberately in the order you
 * think about them — how long, how many, then the noise, then the looks.
 */

import type { Messages, SoundMode } from './config.ts';
import { MESSAGE_MAX, type Stored } from './settings.ts';

type NumberKey = 'work' | 'shortBreak' | 'longBreak' | 'rounds';
type FlagKey = 'color' | 'ascii' | 'mouse' | 'strict' | 'title' | 'notify' | 'menu';
type MessageKey = keyof Messages;

export type Field =
  /** A duration is shown in whatever unit the run is using; a count is bare. */
  | { kind: 'number'; key: NumberKey; label: string; min: number; max: number; unit: boolean }
  | { kind: 'choice'; key: 'sound'; label: string; options: readonly SoundMode[] }
  | { kind: 'flag'; key: FlagKey; label: string; on: string; off: string }
  | { kind: 'text'; key: MessageKey; label: string };

export const FIELDS: readonly Field[] = [
  { kind: 'number', key: 'work', label: 'focus', min: 1, max: 999, unit: true },
  { kind: 'number', key: 'shortBreak', label: 'short break', min: 1, max: 999, unit: true },
  { kind: 'number', key: 'longBreak', label: 'long break', min: 1, max: 999, unit: true },
  { kind: 'number', key: 'rounds', label: 'rounds', min: 1, max: 99, unit: false },
  { kind: 'choice', key: 'sound', label: 'sound', options: ['jingle', 'bell', 'off'] },
  { kind: 'flag', key: 'notify', label: 'notify', on: 'on', off: 'off' },
  { kind: 'flag', key: 'strict', label: 'strict', on: 'on', off: 'off' },
  { kind: 'flag', key: 'color', label: 'colour', on: 'on', off: 'off' },
  { kind: 'flag', key: 'ascii', label: 'glyphs', on: 'ascii', off: 'unicode' },
  { kind: 'flag', key: 'mouse', label: 'mouse', on: 'on', off: 'off' },
  { kind: 'flag', key: 'title', label: 'title bar', on: 'on', off: 'off' },
  { kind: 'flag', key: 'menu', label: 'menu first', on: 'on', off: 'off' },
  { kind: 'text', key: 'focus', label: 'focus text' },
  { kind: 'text', key: 'break', label: 'break text' },
  { kind: 'text', key: 'done', label: 'done text' },
];

export type Menu = {
  readonly fields: readonly Field[];
  /** The settings as they'd be used right now. */
  readonly values: Stored;
  /** The settings as they are in the file, for telling you there's a change. */
  readonly saved: Stored;
  readonly index: number;
  /** What's being typed into the focused field, or null when nothing is. */
  readonly draft: string | null;
  /** `true` when durations are seconds, which only a demo run does. */
  readonly seconds: boolean;
};

export function createMenu(values: Stored, saved: Stored, seconds = false): Menu {
  return { fields: FIELDS, values, saved, index: 0, draft: null, seconds };
}

export function focused(menu: Menu): Field {
  return menu.fields[menu.index] ?? menu.fields[0]!;
}

export function isEditing(menu: Menu): boolean {
  return menu.draft !== null;
}

/** Whether the menu is holding anything the file doesn't have yet. */
export function isDirty(menu: Menu): boolean {
  return JSON.stringify(menu.values) !== JSON.stringify(menu.saved);
}

/** Called once the file has been written, so the header stops saying `edited`. */
export function markSaved(menu: Menu): Menu {
  return { ...menu, saved: menu.values };
}

/** The value as it should read on screen, draft included while typing. */
export function display(menu: Menu, field: Field = focused(menu)): string {
  if (menu.draft !== null && field === focused(menu)) return menu.draft;
  const values = menu.values;

  switch (field.kind) {
    case 'number': {
      const amount = values[field.key];
      if (!field.unit) return String(amount);
      return `${amount} ${menu.seconds ? 'sec' : 'min'}`;
    }
    case 'choice':
      return values[field.key];
    case 'flag':
      return values[field.key] ? field.on : field.off;
    case 'text':
      return values.messages[field.key];
  }
}

/** Moves focus, wrapping, and throws away a half-typed value on the way out. */
export function move(menu: Menu, delta: number): Menu {
  const count = menu.fields.length;
  const index = (((menu.index + delta) % count) + count) % count;
  return { ...cancel(menu), index };
}

export function focus(menu: Menu, index: number): Menu {
  if (index < 0 || index >= menu.fields.length) return menu;
  return { ...cancel(menu), index };
}

/**
 * Nudges the focused value: numbers by `delta`, choices along their list, flags
 * over. Text has nothing to nudge — you type it — so it stays as it is.
 */
export function step(menu: Menu, delta: number): Menu {
  if (isEditing(menu)) return menu;
  const field = focused(menu);

  switch (field.kind) {
    case 'number': {
      const next = clamp(menu.values[field.key] + delta, field.min, field.max);
      return set(menu, { [field.key]: next });
    }
    case 'choice': {
      const options = field.options;
      const at = options.indexOf(menu.values[field.key]);
      const next = (((at + delta) % options.length) + options.length) % options.length;
      return set(menu, { sound: options[next]! });
    }
    case 'flag':
      return set(menu, { [field.key]: !menu.values[field.key] });
    case 'text':
      return menu;
  }
}

/**
 * The space bar: starts typing into a number or a message, and is just another
 * nudge on the fields that only have two or three states anyway.
 */
export function activate(menu: Menu): Menu {
  if (isEditing(menu)) return commit(menu);
  const field = focused(menu);
  if (field.kind === 'number') return { ...menu, draft: '' };
  if (field.kind === 'text') return { ...menu, draft: display(menu, field) };
  return step(menu, 1);
}

/**
 * A printable character. Digits open an edit on a number field by themselves,
 * since typing `50` is a lot fewer keystrokes than nudging twenty-five times.
 */
export function write(menu: Menu, char: string): Menu {
  const field = focused(menu);

  if (menu.draft === null) {
    if (field.kind !== 'number' || !/^\d$/.test(char)) return menu;
    return { ...menu, draft: char };
  }

  if (field.kind === 'number' && !/^\d$/.test(char)) return menu;
  if (menu.draft.length >= limit(field)) return menu;
  return { ...menu, draft: menu.draft + char };
}

export function backspace(menu: Menu): Menu {
  if (menu.draft === null) return menu;
  return { ...menu, draft: menu.draft.slice(0, -1) };
}

/** Takes the draft, or keeps the old value when it can't. */
export function commit(menu: Menu): Menu {
  const draft = menu.draft;
  if (draft === null) return menu;
  const field = focused(menu);

  if (field.kind === 'number') {
    const parsed = Number.parseInt(draft, 10);
    if (!Number.isFinite(parsed)) return cancel(menu);
    return cancel(set(menu, { [field.key]: clamp(parsed, field.min, field.max) }));
  }

  if (field.kind === 'text') {
    const text = draft.trim().slice(0, MESSAGE_MAX);
    // An empty notification is a notification you can't read, so the old text
    // stands rather than the field going blank.
    if (text === '') return cancel(menu);
    return cancel({
      ...menu,
      values: { ...menu.values, messages: { ...menu.values.messages, [field.key]: text } },
    });
  }

  return cancel(menu);
}

export function cancel(menu: Menu): Menu {
  return menu.draft === null ? menu : { ...menu, draft: null };
}

/** How many characters a field will take before it stops listening. */
function limit(field: Field): number {
  if (field.kind === 'text') return MESSAGE_MAX;
  return field.kind === 'number' ? String(field.max).length : 0;
}

function set(menu: Menu, patch: Partial<Stored>): Menu {
  return { ...menu, values: { ...menu.values, ...patch } };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
