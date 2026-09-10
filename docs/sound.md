# Sound and notifications

## Why not the bell

One terminal bell is easy to miss. Plenty of terminals mute it, or turn it into
a flash, which is not much use for telling you a focus block just ended. So
pomo synthesises a short jingle instead, a rising four note run when focus
ends, two lower notes when a break does, and something a bit more pleased with
itself when the whole session is over.

`--bell` picks the plain bell on purpose, `--no-sound` turns the lot off, and
the `sound` row of the menu switches between the three while it runs.

## The notes are just data

```ts
export const JINGLES: Record<string, readonly Note[]> = {
  'focus': [
    { hz: C5, ms: 90 },
    { hz: E5, ms: 90 },
    { hz: G5, ms: 90 },
    { hz: C6, ms: 260 },
  ],
  'break': [
    { hz: G4, ms: 110 },
    { hz: C5, ms: 240 },
  ],
  ...
};
```

A note is a frequency and a duration, and `hz: 0` is a rest. That's the whole
format. Making the jingles configurable later is a matter of parsing something
into an array of these, not of touching the synth.

## Synthesising a WAV

There's no audio library in here, and there isn't going to be one. `wav()`
takes the notes and returns a 16 bit mono PCM buffer, header and all.

```ts
const phase = (2 * Math.PI * note.hz * n) / RATE;
value = (Math.sin(phase) + 0.22 * Math.sin(2 * phase)) / 1.22;
value *= AMPLITUDE * envelope(n, count);
```

Two details in there earn their keep. The touch of second harmonic is because a
bare sine reads as a test tone rather than as a sound, and the envelope fades
each note in over 6ms and out over 45ms, because a note that starts and stops
at full amplitude starts and stops with a click.

Amplitude sits at 0.32, well under full scale. This is a notification, not an
alarm.

The 44 byte header is written by hand, which is about twenty lines of
`writeUInt32LE` and is genuinely all there is to a RIFF WAV.

## Playing it

Nothing on any of the three platforms will read a WAV from stdin reliably, so
the buffer goes to a temp file once per jingle and gets handed to whatever this
machine has.

```ts
const PLAYERS: readonly Player[] =
  process.platform === 'darwin'
    ? [{ command: 'afplay', args: (file) => [file] }]
    : process.platform === 'win32'
      ? [ /* PowerShell's Media.SoundPlayer */ ]
      : [
          { command: 'pw-play', args: (file) => [file] },
          { command: 'paplay', args: (file) => [file] },
          { command: 'aplay', args: (file) => ['-q', file] },
          { command: 'ffplay', args: (file) => ['-nodisp', '-autoexit', '-loglevel', 'quiet', file] },
        ];
```

Which one works is discovered by trying them in order. A missing binary fails
its own spawn, and that failure arrives on the child's `error` event rather
than as a throw, so the fallback chain is an event handler that moves to the
next candidate. That is cheaper than probing `PATH` and it doesn't lie about
what will actually work, since a binary being present is not the same as it
being able to open your sound device.

The first player that works is the one it keeps. If they all fail it stops
trying altogether and falls back to the bell, so a machine with no audio spawns
four doomed processes once and then never again.

Players are spawned detached, so quitting the timer doesn't cut the last note
short. The temp files are cleaned up on the way out.

## Desktop notifications

A sound only helps if you're there to hear it, and a terminal on another
workspace is exactly where a pomodoro goes to be forgotten. So the end of a
phase also gets handed to whatever this machine uses for notifications,
`notify-send` or `kdialog` on Linux, `osascript` on macOS, a balloon tip on
Windows.

Same discovery, same fallback chain, same refusal to be load-bearing. If every
notifier is missing, it goes quiet and the timer carries on.

The wording is yours. It lives in the config file and on the last three rows of
the settings menu, and [Settings](settings.md) covers what pomo appends to it.
`--no-notify` turns the whole thing off.
