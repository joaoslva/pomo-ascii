import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { createHome, cycle, select, selected } from '../src/home.ts';

describe('the start screen', () => {
  it('points at start, since that is why you opened it', () => {
    assert.equal(selected(createHome()), 'start');
  });

  it('wraps in both directions', () => {
    assert.equal(selected(cycle(createHome(), -1)), 'quit');
    assert.equal(selected(cycle(createHome(), 3)), 'start');
  });

  it('points at whatever the mouse is over', () => {
    assert.equal(selected(select(createHome(), 'settings')), 'settings');
  });
});
