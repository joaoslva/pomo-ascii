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

const SGR_MOUSE = /^\x1b\[<(\d+);(\d+);(\d+)([Mm])/;
const UNKNOWN_ESCAPE = /^\x1b\[[\d;?<>]*[A-Za-z~]/;

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
  readonly #wantMouse: boolean;
  readonly #out = process.stdout;
  readonly #in = process.stdin;

  #handlers: Handlers | null = null;
  #buffer = '';
  #mouseEnabled = false;
  #started = false;
  #lastFrame: string | null = null;

  constructor(options: { mouse: boolean }) {
    this.#wantMouse = options.mouse;
  }

  get mouseEnabled(): boolean {
    return this.#mouseEnabled;
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

  bell(): void {
    this.#out.write('\x07');
  }

  /** Leaves the alternate screen, then prints `summary` on the real one. */
  stop(summary?: string): void {
    if (!this.#started) return;
    this.#started = false;

    process.removeListener('SIGWINCH', this.#onResize);
    this.#in.removeListener('data', this.#onData);

    if (this.#mouseEnabled) this.#out.write(MOUSE_OFF);
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
    this.#buffer += chunk;

    while (this.#buffer.length > 0) {
      const mouse = SGR_MOUSE.exec(this.#buffer);
      if (mouse) {
        this.#buffer = this.#buffer.slice(mouse[0].length);
        this.#emitMouse(Number(mouse[1]), Number(mouse[2]), Number(mouse[3]), mouse[4] === 'M');
        continue;
      }

      if (this.#buffer.startsWith(ESC)) {
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
      this.#handlers?.onKey(key);
    }
  };

  #emitMouse(flags: number, col: number, row: number, pressed: boolean): void {
    const kind: MouseEvent['kind'] =
      (flags & 32) !== 0 ? 'move' : pressed ? 'press' : 'release';
    this.#handlers?.onMouse({ kind, row, col, button: flags & 3 });
  }
}
