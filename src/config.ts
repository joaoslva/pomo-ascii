import { parseArgs } from 'node:util';

/** How the end of a phase is announced. */
export type SoundMode = 'jingle' | 'bell' | 'off';

export type Config = {
  work: number;
  shortBreak: number;
  longBreak: number;
  rounds: number;
  /** Read the duration flags as seconds instead of minutes. Handy for demos. */
  seconds: boolean;
  color: boolean;
  ascii: boolean;
  mouse: boolean;
  sound: SoundMode;
};

export const DEFAULTS: Config = {
  work: 25,
  shortBreak: 5,
  longBreak: 15,
  rounds: 4,
  seconds: false,
  color: true,
  ascii: false,
  mouse: true,
  sound: 'jingle',
};

export const HELP = `
  pomo — an ASCII pomodoro timer

  Usage
    pomo [options]

  Options
    -w, --work <min>         focus length          (default 25)
    -b, --break <min>        short break length    (default 5)
    -l, --long-break <min>   long break length     (default 15)
    -r, --rounds <n>         focus rounds before the long break (default 4)

        --seconds            read the durations above as seconds, not minutes
        --ascii              plain ASCII glyphs instead of box drawing
        --no-color           disable colour (NO_COLOR is honoured too)
        --no-mouse           disable mouse tracking
        --bell               plain terminal bell instead of the jingle
        --no-sound           silence: no jingle, no bell

    -h, --help               show this
    -v, --version            print the version

  Controls
    click a button, or:
    space  pause / resume     s  skip phase
    r      restart phase      q  quit        (ctrl-c also works)
`;

class ConfigError extends Error {}

function positiveInt(raw: string, flag: string): number {
  const value = Number(raw);
  if (!Number.isFinite(value) || !Number.isInteger(value) || value <= 0) {
    throw new ConfigError(`${flag} expects a positive whole number, got "${raw}"`);
  }
  return value;
}

export type ParseResult =
  | { kind: 'run'; config: Config }
  | { kind: 'help' }
  | { kind: 'version' }
  | { kind: 'error'; message: string };

export function parseConfig(argv: readonly string[]): ParseResult {
  let parsed;
  try {
    parsed = parseArgs({
      args: [...argv],
      allowPositionals: false,
      options: {
        work: { type: 'string', short: 'w' },
        break: { type: 'string', short: 'b' },
        'long-break': { type: 'string', short: 'l' },
        rounds: { type: 'string', short: 'r' },
        seconds: { type: 'boolean' },
        ascii: { type: 'boolean' },
        // node:util's parseArgs has no --no-x negation, so the off switches
        // are declared as their own flags.
        'no-color': { type: 'boolean' },
        'no-mouse': { type: 'boolean' },
        'no-sound': { type: 'boolean' },
        // --no-bell is what this flag used to be called.
        'no-bell': { type: 'boolean' },
        bell: { type: 'boolean' },
        help: { type: 'boolean', short: 'h' },
        version: { type: 'boolean', short: 'v' },
      },
    });
  } catch (error) {
    return { kind: 'error', message: (error as Error).message };
  }

  const values = parsed.values;
  if (values.help) return { kind: 'help' };
  if (values.version) return { kind: 'version' };

  try {
    const config: Config = {
      work: values.work ? positiveInt(values.work, '--work') : DEFAULTS.work,
      shortBreak: values.break ? positiveInt(values.break, '--break') : DEFAULTS.shortBreak,
      longBreak: values['long-break']
        ? positiveInt(values['long-break'], '--long-break')
        : DEFAULTS.longBreak,
      rounds: values.rounds ? positiveInt(values.rounds, '--rounds') : DEFAULTS.rounds,
      seconds: values.seconds ?? DEFAULTS.seconds,
      ascii: values.ascii ?? DEFAULTS.ascii,
      color: !values['no-color'],
      mouse: !values['no-mouse'],
      sound: soundMode(values),
    };
    return { kind: 'run', config };
  } catch (error) {
    if (error instanceof ConfigError) return { kind: 'error', message: error.message };
    throw error;
  }
}

function soundMode(values: { 'no-sound'?: boolean; 'no-bell'?: boolean; bell?: boolean }): SoundMode {
  if (values['no-sound'] || values['no-bell']) return 'off';
  return values.bell ? 'bell' : DEFAULTS.sound;
}

/** Turns the user-facing durations into the seconds the session model wants. */
export function durations(config: Config) {
  const scale = config.seconds ? 1 : 60;
  return {
    work: config.work * scale,
    shortBreak: config.shortBreak * scale,
    longBreak: config.longBreak * scale,
    rounds: config.rounds,
  };
}
