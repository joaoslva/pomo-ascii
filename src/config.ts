import { parseArgs } from 'node:util';

/** How the end of a phase is announced. */
export type SoundMode = 'jingle' | 'bell' | 'off';

/** What the desktop notification says, per event. The task is appended. */
export type Messages = {
  focus: string;
  break: string;
  done: string;
};

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
  /** No skipping and no resetting while a focus phase is running. */
  strict: boolean;
  /** Put the clock in the terminal's title bar. */
  title: boolean;
  /** Ask the desktop to show a notification when a phase ends. */
  notify: boolean;
  /** Open the settings menu on a bare `pomo`, rather than starting the timer. */
  menu: boolean;
  messages: Messages;
  /** What you're working on. Shown on the status row; per-run, so flag only. */
  task: string;
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
  strict: false,
  title: true,
  notify: true,
  menu: true,
  messages: {
    focus: 'Focus done, take a break',
    break: 'Break over, back to it',
    done: 'Session complete',
  },
  task: '',
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
    -t, --task <text>        what you're working on, shown while it runs

        --seconds            read the durations above as seconds, not minutes
        --strict             no skip and no reset during a focus phase
        --ascii              plain ASCII glyphs instead of box drawing
        --bell               plain terminal bell instead of the jingle
        --no-sound           silence: no jingle, no bell
        --no-color           disable colour (NO_COLOR is honoured too)
        --no-mouse           disable mouse tracking
        --no-title           don't put the clock in the terminal title
        --no-notify          don't send desktop notifications
        --no-ascii           --no-strict          undo the above

        --menu               open the settings menu, even alongside flags
        --no-menu            start the timer straight away
        --config             print the path of the config file
    -h, --help               show this
    -v, --version            print the version

  Config
    Preferences are read from ~/.config/pomo/config.json, written with the
    defaults the first time pomo runs. Flags win over the file for one run.
    A bare \`pomo\` opens the settings menu; passing any flag skips it.

  Controls
    click a button, or:
    space  pause / resume     s  skip phase
    r      reset session      m  settings
    q      quit               (ctrl-c also works)

  In the menu
    up/down  move             left/right  change
    space    edit a value     enter       start
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
  | { kind: 'run'; config: Config; menu: boolean }
  | { kind: 'help' }
  | { kind: 'version' }
  | { kind: 'config-path' }
  | { kind: 'error'; message: string };

/**
 * `base` is what the config file left us, already merged over the built-in
 * defaults. Every flag here overrides it, and only for this run.
 */
export function parseConfig(argv: readonly string[], base: Config = DEFAULTS): ParseResult {
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
        task: { type: 'string', short: 't' },
        seconds: { type: 'boolean' },
        ascii: { type: 'boolean' },
        strict: { type: 'boolean' },
        menu: { type: 'boolean' },
        // node:util's parseArgs has no --no-x negation, so the off switches
        // are declared as their own flags.
        'no-ascii': { type: 'boolean' },
        'no-strict': { type: 'boolean' },
        'no-color': { type: 'boolean' },
        'no-mouse': { type: 'boolean' },
        'no-sound': { type: 'boolean' },
        'no-title': { type: 'boolean' },
        'no-notify': { type: 'boolean' },
        'no-menu': { type: 'boolean' },
        // --no-bell is what --no-sound used to be called.
        'no-bell': { type: 'boolean' },
        bell: { type: 'boolean' },
        config: { type: 'boolean' },
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
  if (values.config) return { kind: 'config-path' };

  /** A flag that turns something on, one that turns it off, or neither. */
  const flip = (on: boolean | undefined, off: boolean | undefined, current: boolean): boolean => {
    if (on) return true;
    if (off) return false;
    return current;
  };

  try {
    const config: Config = {
      work: values.work ? positiveInt(values.work, '--work') : base.work,
      shortBreak: values.break ? positiveInt(values.break, '--break') : base.shortBreak,
      longBreak: values['long-break']
        ? positiveInt(values['long-break'], '--long-break')
        : base.longBreak,
      rounds: values.rounds ? positiveInt(values.rounds, '--rounds') : base.rounds,
      seconds: values.seconds ?? base.seconds,
      ascii: flip(values.ascii, values['no-ascii'], base.ascii),
      strict: flip(values.strict, values['no-strict'], base.strict),
      color: flip(undefined, values['no-color'], base.color),
      mouse: flip(undefined, values['no-mouse'], base.mouse),
      title: flip(undefined, values['no-title'], base.title),
      notify: flip(undefined, values['no-notify'], base.notify),
      menu: flip(values.menu, values['no-menu'], base.menu),
      sound: soundMode(values, base.sound),
      messages: base.messages,
      task: values.task?.trim() ?? base.task,
    };
    return { kind: 'run', config, menu: showMenu(values, argv, base.menu) };
  } catch (error) {
    if (error instanceof ConfigError) return { kind: 'error', message: error.message };
    throw error;
  }
}

/**
 * Whether to open the menu before the timer, which is not the same question as
 * `config.menu`: anyone who typed a flag has already said what they want, so
 * they get the timer and not a screen to click through. `--menu` is there for
 * the one case that rule gets wrong, wanting the menu *and* a task label.
 */
function showMenu(
  values: { menu?: boolean; 'no-menu'?: boolean },
  argv: readonly string[],
  stored: boolean,
): boolean {
  if (values.menu) return true;
  if (values['no-menu']) return false;
  return argv.length === 0 && stored;
}

function soundMode(
  values: { 'no-sound'?: boolean; 'no-bell'?: boolean; bell?: boolean },
  current: SoundMode,
): SoundMode {
  if (values['no-sound'] || values['no-bell']) return 'off';
  return values.bell ? 'bell' : current;
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
