import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { JINGLES, wav, type Note } from '../src/audio.ts';

const RATE = 44_100;
const HEADER = 44;

const samples = (buffer: Buffer): number[] => {
  const values: number[] = [];
  for (let i = HEADER; i + 1 < buffer.length; i += 2) values.push(buffer.readInt16LE(i));
  return values;
};

describe('wav', () => {
  it('writes a header a player will accept', () => {
    const buffer = wav([{ hz: 440, ms: 100 }]);

    assert.equal(buffer.subarray(0, 4).toString(), 'RIFF');
    assert.equal(buffer.subarray(8, 12).toString(), 'WAVE');
    assert.equal(buffer.subarray(12, 16).toString(), 'fmt ');
    assert.equal(buffer.subarray(36, 40).toString(), 'data');
    assert.equal(buffer.readUInt16LE(20), 1, 'PCM');
    assert.equal(buffer.readUInt16LE(22), 1, 'mono');
    assert.equal(buffer.readUInt32LE(24), RATE);
    assert.equal(buffer.readUInt16LE(34), 16, 'bit depth');
    // Both length fields have to agree with the buffer we actually produced.
    assert.equal(buffer.readUInt32LE(4), buffer.length - 8);
    assert.equal(buffer.readUInt32LE(40), buffer.length - HEADER);
  });

  it('lasts as long as the notes say it does', () => {
    const notes: Note[] = [
      { hz: 440, ms: 100 },
      { hz: 0, ms: 50 },
      { hz: 880, ms: 250 },
    ];
    const expected = notes.reduce((sum, note) => sum + Math.round((note.ms / 1000) * RATE), 0);
    assert.equal(samples(wav(notes)).length, expected);
  });

  it('keeps rests silent', () => {
    const values = samples(wav([{ hz: 0, ms: 40 }]));
    assert.ok(values.length > 0);
    assert.ok(values.every((value) => value === 0));
  });

  it('fades in and out, so notes do not click', () => {
    const values = samples(wav([{ hz: 440, ms: 200 }]));
    const peak = Math.max(...values.map(Math.abs));

    assert.equal(values[0], 0, 'starts from silence');
    assert.ok(Math.abs(values.at(-1)!) < peak / 10, 'ends near silence');
    assert.ok(peak > 1000, 'and is audible in between');
  });

  it('stays inside 16-bit range', () => {
    for (const notes of Object.values(JINGLES)) {
      for (const value of samples(wav(notes))) {
        assert.ok(value > -32_768 && value < 32_767, `sample ${value} would clip`);
      }
    }
  });

  it('handles an empty jingle without producing a broken file', () => {
    const buffer = wav([]);
    assert.equal(buffer.length, HEADER);
    assert.equal(buffer.readUInt32LE(40), 0);
  });
});

describe('jingles', () => {
  it('are all playable', () => {
    for (const [name, notes] of Object.entries(JINGLES)) {
      assert.ok(notes.length > 0, `${name} has notes`);
      for (const note of notes) {
        assert.ok(note.ms > 0, `${name} has no zero-length notes`);
        assert.ok(note.hz >= 0, `${name} has no negative frequencies`);
      }
      // Long enough to register, short enough not to be a nuisance.
      const total = notes.reduce((sum, note) => sum + note.ms, 0);
      assert.ok(total > 200 && total < 2000, `${name} lasts ${total}ms`);
    }
  });

  it('covers every event the cli announces', () => {
    for (const name of ['focus', 'break', 'done']) {
      assert.ok(JINGLES[name], `missing the ${name} jingle`);
    }
  });
});
