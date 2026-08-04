/**
 * A tiny 5-row bitmap font. Only the ten digits and a colon, which is all a
 * clock ever needs. Each cell is drawn two characters wide so the result
 * doesn't look squashed in a terminal's tall character cells.
 */

export const DIGIT_HEIGHT = 5;

/** Horizontal blank cells between two characters. */
const TRACKING = 1;

const FONT: Record<string, readonly string[]> = {
  '0': ['###', '# #', '# #', '# #', '###'],
  '1': [' # ', '## ', ' # ', ' # ', '###'],
  '2': ['###', '  #', '###', '#  ', '###'],
  '3': ['###', '  #', '###', '  #', '###'],
  '4': ['# #', '# #', '###', '  #', '  #'],
  '5': ['###', '#  ', '###', '  #', '###'],
  '6': ['###', '#  ', '###', '# #', '###'],
  '7': ['###', '  #', '  #', '  #', '  #'],
  '8': ['###', '# #', '###', '# #', '###'],
  '9': ['###', '# #', '###', '  #', '###'],
  ':': [' ', '#', ' ', '#', ' '],
  ' ': [' ', ' ', ' ', ' ', ' '],
};

function cellsFor(char: string): readonly string[] {
  return FONT[char] ?? FONT[' ']!;
}

/** Rendered width, in terminal columns, of a string drawn as big digits. */
export function bigTextWidth(text: string): number {
  if (text.length === 0) return 0;
  let width = 0;
  for (const char of text) width += (cellsFor(char)[0]?.length ?? 0) * 2;
  return width + (text.length - 1) * TRACKING * 2;
}

/**
 * Draws `text` as DIGIT_HEIGHT lines of `glyph` and spaces. Every line comes
 * back the same length, so callers can centre it without measuring.
 */
export function bigText(text: string, glyph: string): string[] {
  const gap = ' '.repeat(TRACKING * 2);
  const lines: string[] = [];

  for (let row = 0; row < DIGIT_HEIGHT; row++) {
    const parts: string[] = [];
    for (const char of text) {
      const pattern = cellsFor(char)[row] ?? '';
      let out = '';
      for (const cell of pattern) out += cell === '#' ? glyph.repeat(2) : '  ';
      parts.push(out);
    }
    lines.push(parts.join(gap));
  }

  return lines;
}
