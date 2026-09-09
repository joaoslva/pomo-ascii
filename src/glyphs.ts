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
