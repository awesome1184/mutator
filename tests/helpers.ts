import type { Coord, MutationId, Puzzle } from '../src/shared/engine/types.ts';

/** A hand-built puzzle on an open 7x7 board. */
export function makePuzzle(over: Partial<Puzzle> & { mutations: MutationId[] }): Puzzle {
  const base: Omit<Puzzle, 'mutations'> = {
    v: 5,
    dateKey: '2026-12-01',
    number: 335,
    weekday: 2,
    tier: 'standard',
    communityPick: null,
    seed: 'test',
    grid: ['.......', '.......', '.......', '.......', '.......', '.......', '.......'],
    start: { r: 3, c: 0 },
    exit: { r: 3, c: 6 },
    cells: [
      { r: 3, c: 2 },
      { r: 3, c: 4 }
    ],
    orbits: [],
    cracked: [],
    conveyors: [],
    portals: [],
    gates: [],
    doors: [],
    plates: [],
    ice: [],
    magnets: [],
    turntables: [],
    tether: null,
    blight: [],
    blightOrder: ['U', 'R', 'D', 'L'],
    reflectors: [],
    oneWays: [],
    vents: [],
    phaseTiles: [],
    rotors: [],
    droneStart: null,
    echoStart: null,
    beam: null,
    flood: null,
    par: 0
  };
  return { ...base, ...over };
}

export const at = (r: number, c: number): number => r * 7 + c;
export const co = (r: number, c: number): Coord => ({ r, c });

/** Replaces the given cells in the grid with walls. */
export function walls(...cells: [number, number][]): string[] {
  const g = Array.from({ length: 7 }, () => '.......'.split(''));
  for (const [r, c] of cells) (g[r] as string[])[c] = '#';
  return g.map((row) => row.join(''));
}
