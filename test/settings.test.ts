import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, describe, it } from 'node:test';

import { DEFAULTS } from '../src/config.ts';
import {
  configDir,
  configPath,
  ensure,
  load,
  sanitize,
  save,
  serialize,
  toStored,
} from '../src/settings.ts';

const scratch = mkdtempSync(join(tmpdir(), 'pomo-settings-'));
after(() => rmSync(scratch, { recursive: true, force: true }));

let counter = 0;
/** A path in the scratch dir that nothing else in this file will touch. */
const fresh = (name = 'config.json') => join(scratch, `run-${counter++}`, name);

describe('configDir', () => {
  it('follows XDG_CONFIG_HOME when it is set', () => {
    const dir = configDir({ XDG_CONFIG_HOME: '/xdg' }, '/home/someone');
    assert.equal(dir, join('/xdg', 'pomo'));
  });

  it('falls back to ~/.config, including when XDG is empty or blank', () => {
    const expected = join('/home/someone', '.config', 'pomo');
    assert.equal(configDir({}, '/home/someone'), expected);
    assert.equal(configDir({ XDG_CONFIG_HOME: '' }, '/home/someone'), expected);
    assert.equal(configDir({ XDG_CONFIG_HOME: '   ' }, '/home/someone'), expected);
  });

  it('puts the file inside that directory', () => {
    assert.equal(configPath({ XDG_CONFIG_HOME: '/xdg' }, '/h'), join('/xdg', 'pomo', 'config.json'));
  });
});

describe('sanitize', () => {
  it('keeps the settings it recognises', () => {
    const clean = sanitize({ work: 50, rounds: 2, sound: 'bell', strict: true, ascii: false });
    assert.deepEqual(clean, { work: 50, rounds: 2, sound: 'bell', strict: true, ascii: false });
  });

  it('drops values of the wrong type instead of taking the whole file down', () => {
    assert.deepEqual(sanitize({ work: '50', rounds: 4 }), { rounds: 4 });
    assert.deepEqual(sanitize({ color: 'yes', mouse: true }), { mouse: true });
  });

  it('refuses durations that are not positive whole numbers', () => {
    for (const bad of [0, -5, 2.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      assert.deepEqual(sanitize({ work: bad }), {}, `work: ${String(bad)}`);
    }
  });

  it('only accepts a sound mode it knows', () => {
    assert.deepEqual(sanitize({ sound: 'jingle' }), { sound: 'jingle' });
    assert.deepEqual(sanitize({ sound: 'trumpet' }), {});
  });

  it('ignores unknown keys and anything that is not an object', () => {
    assert.deepEqual(sanitize({ turbo: true, work: 30 }), { work: 30 });
    for (const bad of [null, undefined, 42, 'nope', [1, 2]]) {
      assert.deepEqual(sanitize(bad), {}, String(bad));
    }
  });

  it('never lets the per-run settings in through the file', () => {
    assert.deepEqual(sanitize({ seconds: true, task: 'sneaky' }), {});
  });
});

describe('serialize', () => {
  it('writes every stored key, so the file documents its own format', () => {
    const parsed = JSON.parse(serialize(DEFAULTS)) as Record<string, unknown>;
    assert.deepEqual(Object.keys(parsed).sort(), [
      'ascii', 'color', 'longBreak', 'menu', 'messages', 'mouse', 'notify',
      'rounds', 'shortBreak', 'sound', 'strict', 'title', 'work',
    ]);
  });

  it('round-trips through sanitize unchanged', () => {
    assert.deepEqual(sanitize(JSON.parse(serialize(DEFAULTS))), sanitize(DEFAULTS));
  });
});

describe('load', () => {
  it('gives back nothing at all when the file is missing', () => {
    assert.deepEqual(load(fresh()), {});
  });

  it('gives back nothing rather than throwing on malformed JSON', () => {
    const path = fresh();
    ensure(path);
    writeFileSync(path, '{ this is not json');
    assert.deepEqual(load(path), {});
  });

  it('reads back what ensure wrote', () => {
    const path = fresh();
    assert.equal(ensure(path), true);
    assert.deepEqual(load(path), sanitize(DEFAULTS));
  });
});

describe('ensure', () => {
  it('creates the directory and the file, and says that it did', () => {
    const path = fresh();
    assert.equal(ensure(path), true);
    assert.equal(JSON.parse(readFileSync(path, 'utf8')).work, DEFAULTS.work);
  });

  it('leaves an existing file alone and says it did nothing', () => {
    const path = fresh();
    ensure(path);
    writeFileSync(path, JSON.stringify({ work: 99 }));
    assert.equal(ensure(path), false);
    assert.equal(load(path).work, 99);
  });

  it('reports failure rather than throwing when it cannot write', () => {
    // A path whose parent is a file, so mkdir can't succeed.
    const blocker = fresh('blocker');
    ensure(blocker);
    assert.equal(ensure(join(blocker, 'nested', 'config.json')), false);
  });
});

describe('the notification messages', () => {
  it('keeps the ones it is given and defaults the rest', () => {
    const clean = sanitize({ messages: { focus: 'Go and stretch' } });
    assert.deepEqual(clean.messages, { ...DEFAULTS.messages, focus: 'Go and stretch' });
  });

  it('drops blanks, and anything that is not a string', () => {
    assert.deepEqual(sanitize({ messages: { focus: '   ', break: 7 } }), {});
    assert.deepEqual(sanitize({ messages: 'nope' }), {});
    assert.deepEqual(sanitize({ messages: [] }), {});
  });

  it('trims, and cuts anything a notification would not show anyway', () => {
    const long = 'x'.repeat(200);
    const clean = sanitize({ messages: { done: `  ${long}  ` } });
    assert.equal(clean.messages?.done.length, 60);
  });

  it('says nothing about messages when the file says nothing', () => {
    assert.equal('messages' in sanitize({ work: 30 }), false);
  });
});

describe('save', () => {
  it('writes the settings and reads them back', () => {
    const path = fresh();
    assert.equal(save(path, { ...toStored(DEFAULTS), work: 50, rounds: 2 }), true);
    assert.equal(load(path).work, 50);
    assert.equal(load(path).rounds, 2);
  });

  it('leaves keys it does not know alone', () => {
    const path = fresh();
    ensure(path);
    writeFileSync(path, JSON.stringify({ work: 25, experiment: { hue: 200 } }));
    save(path, { ...toStored(DEFAULTS), work: 50 });
    const raw = JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>;
    assert.deepEqual(raw['experiment'], { hue: 200 });
    assert.equal(raw['work'], 50);
  });

  it('overwrites a file that was already there', () => {
    const path = fresh();
    save(path, { ...toStored(DEFAULTS), work: 50 });
    save(path, { ...toStored(DEFAULTS), work: 15 });
    assert.equal(load(path).work, 15);
  });

  it('reports failure rather than throwing when it cannot write', () => {
    const blocker = fresh('blocker');
    ensure(blocker);
    assert.equal(save(join(blocker, 'nested', 'config.json'), toStored(DEFAULTS)), false);
  });
});

describe('toStored', () => {
  it('takes the settings that belong in the file and no others', () => {
    const stored = toStored({ ...DEFAULTS, task: 'per-run', seconds: true });
    assert.equal('task' in stored, false);
    assert.equal('seconds' in stored, false);
    assert.equal(stored.work, DEFAULTS.work);
  });
});
