import type { Action, Coord, Dir } from './types.ts';

export const N = 7;
export const CELLS = N * N;
export const RULES_VERSION = 5;

/** Clockwise order. */
export const DIRS: readonly Dir[] = ['U', 'R', 'D', 'L'];
export const ACTIONS: readonly Action[] = ['U', 'R', 'D', 'L', 'W'];

const DR: Record<Dir, number> = { U: -1, R: 0, D: 1, L: 0 };
const DC: Record<Dir, number> = { U: 0, R: 1, D: 0, L: -1 };

export const DIR_ARROW: Record<Dir, string> = { U: '↑', R: '→', D: '↓', L: '←' };
export const ACTION_ARROW: Record<Action, string> = { ...DIR_ARROW, W: '·' };
export const DIR_NAME: Record<Dir, string> = { U: 'up', R: 'right', D: 'down', L: 'left' };

export function idx(r: number, c: number): number {
  return r * N + c;
}

export function toIdx(p: Coord): number {
  return p.r * N + p.c;
}

export function rowOf(i: number): number {
  return Math.floor(i / N);
}

export function colOf(i: number): number {
  return i % N;
}

export function toCoord(i: number): Coord {
  return { r: rowOf(i), c: colOf(i) };
}

export function inBounds(r: number, c: number): boolean {
  return r >= 0 && r < N && c >= 0 && c < N;
}

/** Index of the neighbour in direction d, or -1 when it would leave the grid. */
export function stepIdx(i: number, d: Dir): number {
  if (i < 0) return -1;
  const r = rowOf(i) + DR[d];
  const c = colOf(i) + DC[d];
  return inBounds(r, c) ? idx(r, c) : -1;
}

export function rotateDir(d: Dir, quarterTurns: number): Dir {
  const k = DIRS.indexOf(d);
  return DIRS[(((k + quarterTurns) % 4) + 4) % 4] as Dir;
}

export function opposite(d: Dir): Dir {
  return rotateDir(d, 2);
}

export function manhattan(a: number, b: number): number {
  return Math.abs(rowOf(a) - rowOf(b)) + Math.abs(colOf(a) - colOf(b));
}

export function chebyshev(a: number, b: number): number {
  return Math.max(Math.abs(rowOf(a) - rowOf(b)), Math.abs(colOf(a) - colOf(b)));
}

/** Direction from a to an orthogonally adjacent b, or null. */
export function dirBetween(a: number, b: number): Dir | null {
  const dr = rowOf(b) - rowOf(a);
  const dc = colOf(b) - colOf(a);
  if (dr === -1 && dc === 0) return 'U';
  if (dr === 1 && dc === 0) return 'D';
  if (dr === 0 && dc === 1) return 'R';
  if (dr === 0 && dc === -1) return 'L';
  return null;
}

/** The four ring slots (N, E, S, W) around a turntable hub. */
export function ringOf(hub: number): [number, number, number, number] {
  return [stepIdx(hub, 'U'), stepIdx(hub, 'R'), stepIdx(hub, 'D'), stepIdx(hub, 'L')];
}

/** Rotates a position 90° clockwise around a hub if it sits in the hub's ring. */
export function spinAround(hub: number, p: number): number {
  if (p < 0) return p;
  const dr = rowOf(p) - rowOf(hub);
  const dc = colOf(p) - colOf(hub);
  if ((Math.abs(dr) === 1 && dc === 0) || (dr === 0 && Math.abs(dc) === 1)) {
    return idx(rowOf(hub) + dc, colOf(hub) - dr);
  }
  return p;
}

export function isAction(x: string): x is Action {
  return x === 'U' || x === 'R' || x === 'D' || x === 'L' || x === 'W';
}

export function parseActions(s: string): Action[] | null {
  const out: Action[] = [];
  for (const ch of s) {
    if (!isAction(ch)) return null;
    out.push(ch);
  }
  return out;
}
