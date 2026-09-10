/**
 * Every dirty thing in one file: raw mode, escape codes, mouse tracking,
 * screen bookkeeping and cleanup. Nothing else in the project touches stdout.
 *
 * Drawing happens on the alternate screen. That costs us the frozen box in
 * your scrollback — `stop` prints a one-line summary instead — and buys back
 * the thing that matters: every frame is written at an absolute position we
 * chose, so a resize can never leave half-overwritten rows behind. It also
 * means we know exactly where the frame sits, which is what makes a click land
 * on the button under it without asking the terminal where the cursor is.
 */

const ESC = '\x1b';

const ALT_ON = `${ESC}[?1049h`;
const ALT_OFF = `${ESC}[?1049l`;
const HIDE_CURSOR = `${ESC}[?25l`;
const SHOW_CURSOR = `${ESC}[?25h`;
const CLEAR_SCREEN = `${ESC}[2J${ESC}[H`;
const CLEAR_RIGHT = `${ESC}[K`;

// Auto-wrap off. A frame that happens to reach the last column of the last row
// would otherwise scroll the whole buffer; with wrapping off it just clips.
const WRAP_OFF = `${ESC}[?7l`;
const WRAP_ON = `${ESC}[?7h`;

// 1000: press/release. 1003: motion too, so buttons can highlight on hover.
// 1006: SGR coordinates, which don't cap out at column 223.
const MOUSE_ON = `${ESC}[?1000h${ESC}[?1003h${ESC}[?1006h`;
const MOUSE_OFF = `${ESC}[?1006l${ESC}[?1003l${ESC}[?1000l`;

// OSC 2 sets the window title. 22/23;2 push and pop it on the terminal's own
// stack, which is the only honest way to put it back: there is no sequence
// that asks a terminal what its title currently is.
const TITLE_PUSH = `${ESC}[22;2t`;
const TITLE_POP = `${ESC}[23;2t`;
const setTitle = (text: string): string => `${ESC}]2;${text}\x07`;

const SGR_MOUSE = /^\x1b\[<(\d+);(\d+);(\d+)([Mm])/;
const UNKNOWN_ESCAPE = /^\x1b(\[|O)[\d;?<>]*[A-Za-z~]/;

/**
 * The keys that aren't characters. Handlers get either a single character or
 * one of these names, and since every name is longer than one character the
 * two can never be confused for each other.
 *
 * Both encodings of the arrows are here: terminals send `ESC [ A` normally and
 * `ESC O A` in application cursor mode, and which one you get depends on the
 * terminal rather than on anything we asked for.
 */
const NAMED_KEYS: Record<string, string> = {
  '\x1b[A': 'up', '\x1bOA': 'up',
  '\x1b[B': 'down', '\x1bOB': 'down',
  '\x1b[C': 'right', '\x1bOC': 'right',
  '\x1b[D': 'left', '\x1bOD': 'left',
  '\x1b[1;2C': 'shift-right', '\x1b[1;2D': 'shift-left',
  '\x1b[Z': 'shift-tab',
  '\x1b[3~': 'delete',
  '\r': 'enter', '\n': 'enter',
  '\t': 'tab',
  '\x7f': 'backspace', '\x08': 'backspace',
};

/**
 * How long a lone ESC waits to find out whether it was the start of something.
 * Nothing else in here needs a timer, but the alternative is an escape key that
 * only lands once you press another one.
 */
const ESCAPE_MS = 40;

export type MouseEvent = {
  kind: 'press' | 'release' | 'move';
  /** Absolute, 1-based terminal coordinates. */
  row: number;
  col: number;
  button: number;
};

export type Handlers = {
  onKey: (key: string) => void;
  onMouse: (event: MouseEvent) => void;
  onResize: () => void;
};

export type Size = { columns: number; rows: number };

export class Screen {
  readonly #out = process.stdout;
  readonly #in = process.stdin;

  // Both of these can change while the app is running, because the settings
  // menu can change them, so neither is a constructor-and-forget flag.
  #wantMouse: boolean;
  #wantTitle: boolean;

  #handlers: Handlers | null = null;
  #buffer = '';
  #escapeTimer: NodeJS.Timeout | null = null;
  #mouseEnabled = false;
  #started = false;
  #lastFrame: string | null = null;
  #lastTitle: string | null = null;

  constructor(options: { mouse: boolean; title?: boolean }) {
    this.#wantMouse = options.mouse;
    this.#wantTitle = options.title ?? false;
  }

  get mouseEnabled(): boolean {
    return this.#mouseEnabled;
  }

  /** Turns mouse tracking on or off after the fact. */
  setMouse(on: boolean): void {
    this.#wantMouse = on;
    if (!this.#started || on === this.#mouseEnabled) return;
    this.#out.write(on ? MOUSE_ON : MOUSE_OFF);
    this.#mouseEnabled = on;
  }

  /**
   * Same, for the title bar. Turning it off pops the title the terminal had
   * before us, which is the only way to put a title back where we found it.
   */
  setTitleBar(on: boolean): void {
    if (!this.#started || on === this.#wantTitle) {
      this.#wantTitle = on;
      return;
    }
    this.#out.write(on ? TITLE_PUSH : TITLE_POP);
    this.#wantTitle = on;
    this.#lastTitle = null;
  }

  /**
   * Current terminal size. A TTY that can't answer reports 0 rather than
   * nothing at all, so this falls back on anything falsy, not just undefined.
   */
  size(): Size {
    return { columns: this.#out.columns || 80, rows: this.#out.rows || 24 };
  }

  start(handlers: Handlers): void {
    if (this.#started) return;
    this.#started = true;
    this.#handlers = handlers;

    this.#in.setRawMode(true);
    this.#in.resume();
    this.#in.setEncoding('utf8');
    this.#in.on('data', this.#onData);

    this.#out.write(ALT_ON + CLEAR_SCREEN + WRAP_OFF + HIDE_CURSOR);

    if (this.#wantTitle) this.#out.write(TITLE_PUSH);

    if (this.#wantMouse) {
      this.#out.write(MOUSE_ON);
      this.#mouseEnabled = true;
    }

    process.on('SIGWINCH', this.#onResize);
  }

  /**
   * Paints `lines` with their top-left corner at the given 1-based cell.
   * Rows are addressed absolutely, so nothing depends on where the cursor
   * happened to end up after the last frame.
   */
  draw(lines: readonly string[], originRow: number, originCol: number): void {
    const frame = `${originRow},${originCol}\n${lines.join('\n')}`;
    if (frame === this.#lastFrame) return;
    this.#lastFrame = frame;

    let out = '';
    for (let i = 0; i < lines.length; i++) {
      out += `${ESC}[${originRow + i};${originCol}H${CLEAR_RIGHT}${lines[i] ?? ''}`;
    }
    this.#out.write(out);
  }

  /**
   * Puts `text` in the title bar, so a terminal you can't see still tells you
   * how long is left. Repeats are dropped: this runs on every tick.
   */
  title(text: string): void {
    if (!this.#wantTitle || text === this.#lastTitle) return;
    this.#lastTitle = text;
    this.#out.write(setTitle(text));
  }

  bell(): void {
    this.#out.write('\x07');
  }

  /** Leaves the alternate screen, then prints `summary` on the real one. */
  stop(summary?: string): void {
    if (!this.#started) return;
    this.#started = false;

    process.removeListener('SIGWINCH', this.#onResize);
    this.#in.removeListener('data', this.#onData);
    if (this.#escapeTimer) clearTimeout(this.#escapeTimer);
    this.#escapeTimer = null;

    if (this.#mouseEnabled) this.#out.write(MOUSE_OFF);
    if (this.#wantTitle) this.#out.write(TITLE_POP);
    this.#out.write(WRAP_ON + SHOW_CURSOR + ALT_OFF);
    if (summary) this.#out.write(`${summary}\n`);

    if (this.#in.isTTY) this.#in.setRawMode(false);
    this.#in.pause();
  }

  #onResize = (): void => {
    // The new geometry may want a different layout at a different offset, so
    // wipe the buffer rather than trusting anything already on it.
    this.#out.write(CLEAR_SCREEN);
    this.#lastFrame = null;
    this.#handlers?.onResize();
  };

  #onData = (chunk: string): void => {
    if (this.#escapeTimer) {
      clearTimeout(this.#escapeTimer);
      this.#escapeTimer = null;
    }
    this.#buffer += chunk;

    while (this.#buffer.length > 0) {
      const mouse = SGR_MOUSE.exec(this.#buffer);
      if (mouse) {
        this.#buffer = this.#buffer.slice(mouse[0].length);
        this.#emitMouse(Number(mouse[1]), Number(mouse[2]), Number(mouse[3]), mouse[4] === 'M');
        continue;
      }

      if (this.#buffer.startsWith(ESC)) {
        const named = this.#named();
        if (named) {
          this.#buffer = this.#buffer.slice(named.length);
          this.#handlers?.onKey(NAMED_KEYS[named]!);
          continue;
        }

        const unknown = UNKNOWN_ESCAPE.exec(this.#buffer);
        if (unknown) {
          this.#buffer = this.#buffer.slice(unknown[0].length);
          continue;
        }
        // A partial sequence — wait for the rest. Bail out if it's implausibly
        // long, so a stray ESC can't wedge the parser forever.
        if (this.#buffer.length < 32) break;
        this.#buffer = this.#buffer.slice(1);
        continue;
      }

      const key = this.#buffer[0]!;
      this.#buffer = this.#buffer.slice(1);
      this.#handlers?.onKey(NAMED_KEYS[key] ?? key);
    }

    // A buffer holding nothing but ESC is either the escape key or the first
    // byte of a sequence still in flight. Waiting a moment tells us which.
    if (this.#buffer === ESC) {
      this.#escapeTimer = setTimeout(() => {
        this.#escapeTimer = null;
        if (this.#buffer !== ESC) return;
        this.#buffer = '';
        this.#handlers?.onKey('escape');
      }, ESCAPE_MS);
      this.#escapeTimer.unref();
    }
  };

  /** The longest named sequence the buffer currently starts with. */
  #named(): string | null {
    let best: string | null = null;
    for (const sequence of Object.keys(NAMED_KEYS)) {
      if (!this.#buffer.startsWith(sequence)) continue;
      if (best === null || sequence.length > best.length) best = sequence;
    }
    return best;
  }

  #emitMouse(flags: number, col: number, row: number, pressed: boolean): void {
    const kind: MouseEvent['kind'] =
      (flags & 32) !== 0 ? 'move' : pressed ? 'press' : 'release';
    this.#handlers?.onMouse({ kind, row, col, button: flags & 3 });
  }
}
