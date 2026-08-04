import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { DEFAULTS, durations, parseConfig } from '../src/config.ts';

function run(args: string[]) {
  const result = parseConfig(args);
  assert.equal(result.kind, 'run', `expected a runnable config, got ${result.kind}`);
  return (result as Extract<typeof result, { kind: 'run' }>).config;
}

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
    const config = run(['--no-color', '--no-mouse', '--no-bell', '--ascii']);
    assert.equal(config.color, false);
    assert.equal(config.mouse, false);
    assert.equal(config.bell, false);
    assert.equal(config.ascii, true);
  });

  it('rejects nonsense durations', () => {
    for (const bad of ['0', '-5', 'abc', '2.5']) {
      assert.equal(parseConfig(['--work', bad]).kind, 'error', `--work ${bad}`);
    }
  });

  it('rejects unknown flags rather than ignoring them', () => {
    assert.equal(parseConfig(['--turbo']).kind, 'error');
  });

  it('recognises help and version', () => {
    assert.equal(parseConfig(['--help']).kind, 'help');
    assert.equal(parseConfig(['-v']).kind, 'version');
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
