/**
 * Every dirty thing in one file: raw mode, escape codes, mouse tracking,
 * cursor bookkeeping and cleanup. Nothing else in the project touches stdout.
 *
 * Drawing is done in place rather than on the alternate screen, so the timer
 * behaves like a command that happens to keep updating — it stays in your
 * scrollback when it exits. The frame is reserved once with newlines; every
 * redraw walks the cursor back up and overwrites those exact lines, never
 * emitting a trailing newline (which would scroll the screen every second).
 */

const ESC = '\x1b';

const HIDE_CURSOR = `${ESC}[?25l`;
const SHOW_CURSOR = `${ESC}[?25h`;
const CLEAR_LINE = `${ESC}[2K`;
const QUERY_CURSOR = `${ESC}[6n`;

// 1000: press/release. 1003: motion too, so buttons can highlight on hover.
// 1006: SGR coordinates, which don't cap out at column 223.
const MOUSE_ON = `${ESC}[?1000h${ESC}[?1003h${ESC}[?1006h`;
const MOUSE_OFF = `${ESC}[?1006l${ESC}[?1003l${ESC}[?1000l`;

const SGR_MOUSE = /^\x1b\[<(\d+);(\d+);(\d+)([Mm])/;
const CURSOR_REPORT = /^\x1b\[(\d+);(\d+)R/;
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

export type ScreenOptions = {
  height: number;
  mouse: boolean;
};

export class Screen {
  readonly #height: number;
  readonly #wantMouse: boolean;
  readonly #out = process.stdout;
  readonly #in = process.stdin;

  #handlers: Handlers | null = null;
  #buffer = '';
  #pendingReport: ((row: number, col: number) => void) | null = null;
  #originRow: number | null = null;
  #mouseEnabled = false;
  #started = false;
  #lastFrame: string | null = null;

  constructor(options: ScreenOptions) {
    this.#height = options.height;
    this.#wantMouse = options.mouse;
  }

  /** 1-based absolute row of the frame's first line, or null if unknown. */
  get originRow(): number | null {
    return this.#originRow;
  }

  get mouseEnabled(): boolean {
    return this.#mouseEnabled;
  }

  async start(handlers: Handlers): Promise<void> {
    if (this.#started) return;
    this.#started = true;
    this.#handlers = handlers;

    this.#in.setRawMode(true);
    this.#in.resume();
    this.#in.setEncoding('utf8');
    this.#in.on('data', this.#onData);

    this.#out.write(HIDE_CURSOR);
    // Reserve the frame. height-1 newlines leaves the cursor parked on the
    // last line of the block, which is where every redraw starts from.
    if (this.#height > 1) this.#out.write('\r\n'.repeat(this.#height - 1));

    const position = await this.#queryCursor();
    if (position) {
      this.#originRow = position.row - (this.#height - 1);
      // Mouse coordinates are absolute, so without a cursor report we have no
      // way to map a click onto a button. Better to leave it off than to guess.
      if (this.#wantMouse) {
        this.#out.write(MOUSE_ON);
        this.#mouseEnabled = true;
      }
    }

    process.on('SIGWINCH', this.#onResize);
  }

  draw(lines: readonly string[]): void {
    const frame = lines.join('\n');
    if (frame === this.#lastFrame) return;
    this.#lastFrame = frame;

    let out = '\r';
    if (this.#height > 1) out += `${ESC}[${this.#height - 1}A`;
    for (let i = 0; i < this.#height; i++) {
      out += CLEAR_LINE + (lines[i] ?? '');
      if (i < this.#height - 1) out += '\r\n';
    }
    this.#out.write(out);
  }

  bell(): void {
    this.#out.write('\x07');
  }

  stop(): void {
    if (!this.#started) return;
    this.#started = false;

    process.removeListener('SIGWINCH', this.#onResize);
    this.#in.removeListener('data', this.#onData);

    if (this.#mouseEnabled) this.#out.write(MOUSE_OFF);
    this.#out.write(`\r\n${SHOW_CURSOR}`);

    if (this.#in.isTTY) this.#in.setRawMode(false);
    this.#in.pause();
  }

  #queryCursor(): Promise<{ row: number; col: number } | null> {
    return new Promise((resolve) => {
      let settled = false;
      const finish = (value: { row: number; col: number } | null) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        this.#pendingReport = null;
        resolve(value);
      };

      // Terminals that don't answer DSR shouldn't hang the startup.
      const timer = setTimeout(() => finish(null), 250);
      this.#pendingReport = (row, col) => finish({ row, col });
      this.#out.write(QUERY_CURSOR);
    });
  }

  #onResize = (): void => {
    // After a draw the cursor sits on the last line of the frame, so a fresh
    // cursor report tells us where the frame ended up after any reflow.
    void this.#queryCursor().then((position) => {
      if (position) this.#originRow = position.row - (this.#height - 1);
      this.#lastFrame = null;
      this.#handlers?.onResize();
    });
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

      const report = CURSOR_REPORT.exec(this.#buffer);
      if (report) {
        this.#buffer = this.#buffer.slice(report[0].length);
        this.#pendingReport?.(Number(report[1]), Number(report[2]));
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
