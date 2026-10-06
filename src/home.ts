/**
 * The start screen, the one a bare `pomo` opens on. Three choices and a
 * pointer at one of them, which hardly needs a module of its own, except that
 * the rule in this repo is that state lives in pure functions and `cli.ts`
 * only gets to call them.
 *
 * The pointer wraps, like the settings list does, so the bottom of a three item
 * menu is one keypress from the top rather than two.
 */

export type HomeItem = 'start' | 'settings' | 'quit';

export const ITEMS: readonly HomeItem[] = ['start', 'settings', 'quit'];

export type Home = {
  readonly items: readonly HomeItem[];
  readonly index: number;
};

export function createHome(): Home {
  return { items: ITEMS, index: 0 };
}

export function selected(home: Home): HomeItem {
  return home.items[home.index] ?? home.items[0]!;
}

export function cycle(home: Home, delta: number): Home {
  const count = home.items.length;
  return { ...home, index: (((home.index + delta) % count) + count) % count };
}

/** Points at `item`, which is what hovering over it with the mouse does. */
export function select(home: Home, item: HomeItem): Home {
  const index = home.items.indexOf(item);
  return index === -1 ? home : { ...home, index };
}
