import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { DEFAULTS } from '../src/config.ts';
import {
  activate,
  backspace,
  cancel,
  commit,
  createMenu,
  display,
  FIELDS,
  focus,
  focused,
  isDirty,
  isEditing,
  markSaved,
  move,
  step,
  write,
  type Menu,
} from '../src/menu.ts';
import { toStored } from '../src/settings.ts';

const stored = toStored(DEFAULTS);
const fresh = (seconds = false): Menu => createMenu(stored, stored, seconds);

/** Puts the focus on the named field, since the tests care which one it is. */
const at = (label: string, seconds = false): Menu => {
  const index = FIELDS.findIndex((field) => field.label === label);
  assert.notEqual(index, -1, `no field called ${label}`);
  return focus(fresh(seconds), index);
};

describe('moving around', () => {
  it('wraps at both ends, so you can never get stuck', () => {
    assert.equal(move(fresh(), -1).index, FIELDS.length - 1);
    assert.equal(move(move(fresh(), -1), 1).index, 0);
  });

  it('throws away whatever was half-typed on the way out', () => {
    const typing = write(at('focus'), '9');
    assert.equal(isEditing(typing), true);
    assert.equal(isEditing(move(typing, 1)), false);
    assert.equal(move(typing, 1).values.work, DEFAULTS.work);
  });

  it('ignores a click on a row that isn\'t there', () => {
    assert.equal(focus(fresh(), 99).index, 0);
    assert.equal(focus(fresh(), -1).index, 0);
  });
});

describe('nudging a value', () => {
  it('moves numbers by however much it was asked for', () => {
    assert.equal(step(at('focus'), 1).values.work, 26);
    assert.equal(step(at('focus'), 5).values.work, 30);
    assert.equal(step(at('focus'), -1).values.work, 24);
  });

  it('stops at the ends rather than wrapping round to 999 minutes', () => {
    assert.equal(step(at('focus'), -50).values.work, 1);
    assert.equal(step(at('rounds'), 500).values.rounds, 99);
  });

  it('walks a choice along its options, both ways', () => {
    assert.equal(step(at('sound'), 1).values.sound, 'bell');
    assert.equal(step(step(at('sound'), 1), 1).values.sound, 'off');
    assert.equal(step(at('sound'), -1).values.sound, 'off');
  });

  it('flips a flag', () => {
    assert.equal(step(at('strict'), 1).values.strict, true);
    assert.equal(step(at('colour'), 1).values.color, false);
  });

  it('leaves a message alone, because there is nothing to nudge', () => {
    const menu = step(at('focus text'), 1);
    assert.deepEqual(menu.values.messages, DEFAULTS.messages);
  });
});

describe('typing a value', () => {
  it('starts on the first digit and replaces the whole number', () => {
    const menu = commit(write(write(at('focus'), '5'), '0'));
    assert.equal(menu.values.work, 50);
    assert.equal(isEditing(menu), false);
  });

  it('only takes digits into a number, and only so many', () => {
    assert.equal(write(at('focus'), 'x').draft, null);
    const long = ['1', '2', '3', '4', '5'].reduce(write, at('focus'));
    assert.equal(long.draft, '123');
  });

  it('clamps what you typed instead of refusing it', () => {
    assert.equal(commit(write(at('rounds'), '0')).values.rounds, 1);
    assert.equal(commit(['9', '9', '9'].reduce(write, at('rounds'))).values.rounds, 99);
  });

  it('needs space before it will take a letter, and then takes any', () => {
    assert.equal(write(at('focus text'), 'x').draft, null);
    const typing = activate(at('focus text'));
    assert.equal(typing.draft, DEFAULTS.messages.focus);
    assert.equal(commit(write(backspace(typing), '!')).values.messages.focus.endsWith('brea!'), true);
  });

  it('keeps the old message rather than letting one go blank', () => {
    let menu = activate(at('break text'));
    for (let i = 0; i < 80; i++) menu = backspace(menu);
    assert.equal(commit(menu).values.messages.break, DEFAULTS.messages.break);
  });

  it('drops the draft on cancel', () => {
    const menu = cancel(write(at('focus'), '9'));
    assert.equal(menu.values.work, DEFAULTS.work);
    assert.equal(isEditing(menu), false);
  });
});

describe('space', () => {
  it('opens a number up empty, so you type over it rather than into it', () => {
    assert.equal(activate(at('focus')).draft, '');
  });

  it('is just another nudge on the fields that only have a few states', () => {
    assert.equal(activate(at('strict')).values.strict, true);
    assert.equal(activate(at('sound')).values.sound, 'bell');
  });

  it('takes the value when it is pressed a second time', () => {
    assert.equal(commit(activate(at('focus'))).values.work, DEFAULTS.work);
    assert.equal(isEditing(activate(activate(at('focus')))), false);
  });
});

describe('what it says on screen', () => {
  it('puts the unit on a duration and not on a count', () => {
    assert.equal(display(at('focus')), '25 min');
    assert.equal(display(at('focus', true)), '25 sec');
    assert.equal(display(at('rounds')), '4');
  });

  it('names a flag rather than saying true', () => {
    assert.equal(display(at('glyphs')), 'unicode');
    assert.equal(display(step(at('glyphs'), 1)), 'ascii');
  });

  it('shows the draft while there is one', () => {
    assert.equal(display(write(at('focus'), '7')), '7');
  });
});

describe('knowing what is unsaved', () => {
  it('is clean until something actually changes', () => {
    assert.equal(isDirty(fresh()), false);
    assert.equal(isDirty(move(fresh(), 3)), false);
    assert.equal(isDirty(step(at('focus'), 1)), true);
  });

  it('is clean again once the file has caught up', () => {
    assert.equal(isDirty(markSaved(step(at('focus'), 1))), false);
  });

  it('counts a draft only once it has been taken', () => {
    assert.equal(isDirty(write(at('focus'), '9')), false);
    assert.equal(isDirty(commit(write(at('focus'), '9'))), true);
  });
});

describe('the field list', () => {
  it('starts on the first field', () => {
    assert.equal(focused(fresh()).label, 'focus');
  });

  it('has a label short enough for the narrow box', () => {
    for (const field of FIELDS) assert.ok(field.label.length <= 11, field.label);
  });
});
