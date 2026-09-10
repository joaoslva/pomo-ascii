/**
 * Two interchangeable character sets. The Unicode one looks better; the ASCII
 * one exists for fonts and terminals that render box drawing badly (and for
 * anyone who wants the thing to be literally ASCII).
 */

export type GlyphSet = {
  /** One cell of a big digit. Drawn twice per cell to fix the aspect ratio. */
  digit: string;
  barFull: string;
  barEmpty: string;
  dotFull: string;
  dotEmpty: string;
  /** Marks a label that had to be cut short. */
  ellipsis: string;
  /** The menu's nudge handles, either side of a value. */
  left: string;
  right: string;
  /** Says the menu has more rows above or below the ones on screen. */
  up: string;
  down: string;
  /** Where the next typed character will land. */
  caret: string;
  topLeft: string;
  topRight: string;
  bottomLeft: string;
  bottomRight: string;
  horizontal: string;
  vertical: string;
};

export const UNICODE: GlyphSet = {
  digit: '█',
  barFull: '█',
  barEmpty: '░',
  dotFull: '●',
  dotEmpty: '○',
  ellipsis: '…',
  left: '‹',
  right: '›',
  up: '↑',
  down: '↓',
  caret: '▏',
  topLeft: '┌',
  topRight: '┐',
  bottomLeft: '└',
  bottomRight: '┘',
  horizontal: '─',
  vertical: '│',
};

export const ASCII: GlyphSet = {
  digit: '#',
  barFull: '=',
  barEmpty: '.',
  dotFull: '*',
  dotEmpty: 'o',
  ellipsis: '~',
  left: '<',
  right: '>',
  up: '^',
  down: 'v',
  caret: '_',
  topLeft: '+',
  topRight: '+',
  bottomLeft: '+',
  bottomRight: '+',
  horizontal: '-',
  vertical: '|',
};

export function glyphSet(ascii: boolean): GlyphSet {
  return ascii ? ASCII : UNICODE;
}
