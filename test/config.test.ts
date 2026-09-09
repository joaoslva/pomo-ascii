import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { DEFAULTS, durations, parseConfig, type Config } from '../src/config.ts';

function run(args: string[], base: Config = DEFAULTS) {
  const result = parseConfig(args, base);
  assert.equal(result.kind, 'run', `expected a runnable config, got ${result.kind}`);
  return (result as Extract<typeof result, { kind: 'run' }>).config;
}

/** What a config file would have left us, before any flags are read. */
const stored = (overrides: Partial<Config>): Config => ({ ...DEFAULTS, ...overrides });

describe('parseConfig', () => {
  it('falls back to the classic 25/5/15 x 4', () => {
    assert.deepEqual(run([]), DEFAULTS);
  });

  it('reads long and short flags', () => {
    assert.equal(run(['--work', '50']).work, 50);
    assert.equal(run(['-w', '50']).work, 50);
    assert.equal(run(['--long-break', '30']).longBreak, 30);
    assert.equal(run(['-r', '2']).rounds, 2);
  });

  it('handles the negatable booleans', () => {
    const config = run(['--no-color', '--no-mouse', '--no-sound', '--ascii']);
    assert.equal(config.color, false);
    assert.equal(config.mouse, false);
    assert.equal(config.sound, 'off');
    assert.equal(config.ascii, true);
  });

  it('picks a sound mode', () => {
    assert.equal(run([]).sound, 'jingle');
    assert.equal(run(['--bell']).sound, 'bell');
    assert.equal(run(['--no-sound']).sound, 'off');
    // What --no-sound used to be called, kept working.
    assert.equal(run(['--no-bell']).sound, 'off');
    // Silence wins over a preference for how to make noise.
    assert.equal(run(['--bell', '--no-sound']).sound, 'off');
  });

  it('rejects nonsense durations', () => {
    for (const bad of ['0', '-5', 'abc', '2.5']) {
      assert.equal(parseConfig(['--work', bad]).kind, 'error', `--work ${bad}`);
    }
  });

  it('rejects unknown flags rather than ignoring them', () => {
    assert.equal(parseConfig(['--turbo']).kind, 'error');
  });

  it('recognises help, version and the config path', () => {
    assert.equal(parseConfig(['--help']).kind, 'help');
    assert.equal(parseConfig(['-v']).kind, 'version');
    assert.equal(parseConfig(['--config']).kind, 'config-path');
  });

  it('takes a task, trimmed, and keeps it out of the config file', () => {
    assert.equal(run(['--task', '  write the parser  ']).task, 'write the parser');
    assert.equal(run(['-t', 'ship it']).task, 'ship it');
    assert.equal(run([]).task, '');
  });

  it('locks skip and reset with --strict', () => {
    assert.equal(run([]).strict, false);
    assert.equal(run(['--strict']).strict, true);
  });
});

describe('parseConfig over stored settings', () => {
  it('uses the stored values when no flag says otherwise', () => {
    const config = run([], stored({ work: 50, rounds: 2, sound: 'bell', strict: true }));
    assert.equal(config.work, 50);
    assert.equal(config.rounds, 2);
    assert.equal(config.sound, 'bell');
    assert.equal(config.strict, true);
  });

  it('lets a flag win over the file, for this run only', () => {
    const base = stored({ work: 50, sound: 'bell' });
    assert.equal(run(['--work', '15'], base).work, 15);
    assert.equal(run(['--no-sound'], base).sound, 'off');
    // and the file is unchanged either way
    assert.equal(base.work, 50);
  });

  it('can undo everything the file turned on', () => {
    const base = stored({ strict: true, ascii: true, color: true, mouse: true, title: true, notify: true });
    const config = run(['--no-strict', '--no-ascii', '--no-color', '--no-mouse', '--no-title', '--no-notify'], base);
    assert.deepEqual(
      [config.strict, config.ascii, config.color, config.mouse, config.title, config.notify],
      [false, false, false, false, false, false],
    );
  });

  it('turns things back on that the file turned off', () => {
    assert.equal(run(['--strict'], stored({ strict: false })).strict, true);
    assert.equal(run(['--ascii'], stored({ ascii: false })).ascii, true);
  });
});

describe('durations', () => {
  it('reads the flags as minutes by default', () => {
    const d = durations(run([]));
    assert.equal(d.work, 1500);
    assert.equal(d.shortBreak, 300);
  });

  it('reads them as seconds with --seconds, for demos', () => {
    const d = durations(run(['--seconds', '--work', '5', '--break', '2']));
    assert.equal(d.work, 5);
    assert.equal(d.shortBreak, 2);
  });
});
