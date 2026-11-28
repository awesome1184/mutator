// How hard a board is for someone who doesn't plan ahead.
//
// The naive player looks a few moves ahead (the landing previews show one)
// and picks whichever move leaves the shortest walk to the remaining cells and
// the exit. Walks are measured on the board as it looks right now: walls,
// pits, blight, water, closed doors, locks they can't open and barriers of the
// wrong colour count as solid, but they will make one stop on the way for a
// key, a paint splash or a door plate if that opens a shorter walk. Belts and
// portals they can see are used as shortcuts. Everything else is treated as
// plain floor. They never return to a state they have already been in.
//
// If that player can match par, the board is easy whatever its mutations are.
// The gap between their score and par is what the generator uses to judge
// difficulty.
import { ACTIONS, CELLS, DIRS, stepIdx, wrapIdx } from './grid.ts';
import { cellAt, step, stateKey } from './sim.ts';
import type { GameState } from './types.ts';
import { isFloodedAt, layerFor, portalMode, portalPartner, type Layer, type World } from './world.ts';

const FAR = 60;
/** Steps and walk measurements done so far, so callers can charge them to a budget. */
let work = 0;
/** walkLeft results for the current naiveBest call, keyed by state. */
let memo = new Map<string, number>();
/** Gap reported when the naive player never finishes. */
export const STUCK_GAP = 99;

type Walk = { solid: Uint8Array; L: Layer; mode: 0 | 1 };

function walkModel(w: World, s: GameState): Walk {
  const L = layerFor(w, s.turn);
  const solid = new Uint8Array(CELLS);
  for (let i = 0; i < CELLS; i++) {
    if (L.wall[i] === 1 || s.decay[i] === 0 || s.blight[i] === 1) solid[i] = 1;
    else if (w.has.FLOOD && isFloodedAt(w, s.turn, i)) solid[i] = 1;
    else if (L.door[i] && !s.doorsOpen) solid[i] = 1;
    else if ((w.lockAt[i] as number) >= 0 && !(s.locksOpen & (1 << (w.lockAt[i] as number))) && s.keys === 0) solid[i] = 1;
    else if ((L.paintGate[i] as number) >= 0 && s.paint !== (L.paintGate[i] as number) + 1) solid[i] = 1;
  }
  return { solid, L, mode: portalMode(s.turn) };
}

/** Where you end up after walking onto tile j, counting visible belts and portals. */
function settle(w: World, m: Walk, j: number): number {
  const label = w.portalAt[j] as number;
  if (w.has.PORTALS && label >= 0) {
    const dest = w.portalPos[portalPartner(label, m.mode)] as number;
    return dest >= 0 && !m.solid[dest] ? dest : j;
  }
  const belt = m.L.conv[j] as number;
  if (belt >= 0) {
    const n = stepIdx(j, DIRS[belt] as (typeof DIRS)[number]);
    return n >= 0 && !m.solid[n] ? n : j;
  }
  return j;
}

function distances(w: World, m: Walk, from: number): Int16Array {
  const d = new Int16Array(CELLS).fill(FAR);
  d[from] = 0;
  const q = [from];
  const wrap = w.has.WRAPAROUND === true;
  for (let h = 0; h < q.length; h++) {
    const i = q[h] as number;
    for (const dir of DIRS) {
      const j = wrap ? wrapIdx(i, dir) : stepIdx(i, dir);
      if (j < 0 || m.solid[j]) continue;
      // You can still collect something you are carried across, so record both tiles.
      for (const k of j === settle(w, m, j) ? [j] : [j, settle(w, m, j)]) {
        if ((d[k] as number) <= (d[i] as number) + 1) continue;
        d[k] = (d[i] as number) + 1;
        q.push(k);
      }
    }
  }
  return d;
}

/** Shortest walk from `from` through every tile in `left` (at most two) and on to the exit. */
function tour(w: World, m: Walk, from: number, left: number[]): number {
  const here = distances(w, m, from);
  if (left.length === 0) return here[w.exit] as number;
  if (left.length === 1) {
    const a = left[0] as number;
    return (here[a] as number) + (distances(w, m, a)[w.exit] as number);
  }
  const [a, b] = left as [number, number];
  const fa = distances(w, m, a);
  const fb = distances(w, m, b);
  return Math.min(
    (here[a] as number) + (fa[b] as number) + (fb[w.exit] as number),
    (here[b] as number) + (fb[a] as number) + (fa[w.exit] as number)
  );
}

/**
 * Length of the shortest walk through the remaining cells to the exit, on
 * the board as it is now. Like a person would, the naive player also
 * considers one detour first: to a key, a paint splash or a door plate.
 */
export function walkLeft(w: World, s: GameState): number {
  if (s.solved) return 0;
  const key = stateKey(w, s);
  const known = memo.get(key);
  if (known !== undefined) return known;
  const v = measure(w, s);
  memo.set(key, v);
  return v;
}

function measure(w: World, s: GameState): number {
  work += 3;
  const m = walkModel(w, s);
  const left: number[] = [];
  for (const k of [0, 1]) if (!(s.got & (1 << k))) left.push(cellAt(w, s, k));
  let best = tour(w, m, s.pos, left);
  if (!(w.has.PAINT || w.has.KEYS || w.has.BLAST_DOORS)) return best;

  const here = distances(w, m, s.pos);
  const detour = (at: number, after: GameState): void => {
    const d = here[at] as number;
    if (d >= FAR || d >= best) return;
    best = Math.min(best, d + tour(w, walkModel(w, after), at, left));
  };
  for (let i = 0; i < CELLS; i++) {
    if (w.has.PAINT && (m.L.paintPad[i] as number) >= 0 && s.paint !== (m.L.paintPad[i] as number) + 1) {
      detour(i, { ...s, paint: (m.L.paintPad[i] as number) + 1 });
    }
    if (w.has.KEYS && (w.keyAt[i] as number) >= 0 && !(s.keysTaken & (1 << (w.keyAt[i] as number)))) {
      detour(i, { ...s, keys: s.keys + 1 });
    }
    if (w.has.BLAST_DOORS && m.L.plate[i] === 1) {
      detour(i, { ...s, doorsOpen: !s.doorsOpen });
    }
  }
  return best;
}

function lookahead(w: World, s: GameState, depth: number): number {
  if (s.solved) return 0;
  let best = walkLeft(w, s);
  if (depth <= 0) return best;
  for (const a of ACTIONS) {
    const r = step(w, s, a);
    work++;
    if (!r.ok) continue;
    best = Math.min(best, r.state.solved ? 0 : lookahead(w, r.state, depth - 1));
    if (best === 0) break;
  }
  return best;
}

/**
 * Moves the naive player needs, or null if they get stuck or pass `cap`.
 * `look` is how many moves ahead they consider.
 */
export function naiveMoves(w: World, start: GameState, look: number, cap: number, trail?: number[]): number | null {
  let s = start;
  const visited = new Set<string>([stateKey(w, s)]);
  while (s.turn < cap) {
    let best: GameState | null = null;
    let bestScore = Infinity;
    for (const a of ACTIONS) {
      const r = step(w, s, a);
      if (!r.ok) continue;
      if (r.state.solved) return r.state.turn;
      if (visited.has(stateKey(w, r.state))) continue;
      // Holding still is the last resort.
      const score = lookahead(w, r.state, look - 1) + (a === 'W' ? 0.5 : 0);
      if (score < bestScore) {
        bestScore = score;
        best = r.state;
      }
    }
    if (!best) return null;
    visited.add(stateKey(w, best));
    s = best;
    trail?.push(s.pos);
  }
  return null;
}

/**
 * How the naive player does with 1, 2 and 3 moves of lookahead (`each`, null
 * where they get stuck or pass `cap`), and the best of those (`moves`).
 * `work` is a rough count of the effort spent, comparable to solver states.
 */
export function naiveBest(w: World, start: GameState, cap: number): { moves: number | null; each: (number | null)[]; work: number } {
  work = 0;
  memo = new Map();
  const each = [1, 2, 3].map((look) => naiveMoves(w, start, look, cap));
  memo = new Map();
  const done = each.filter((n): n is number => n !== null);
  return { moves: done.length ? Math.min(...done) : null, each, work: Math.ceil(work * 1.5) };
}

/** The tiles the best naive player stands on, in order. */
export function naivePath(w: World, start: GameState, cap: number): number[] {
  const { each } = naiveBest(w, start, cap);
  let look = 1;
  let best = Infinity;
  each.forEach((n, k) => {
    if (n !== null && n < best) {
      best = n;
      look = k + 1;
    }
  });
  const trail: number[] = [];
  memo = new Map();
  naiveMoves(w, start, look, cap, trail);
  memo = new Map();
  return trail;
}

/** How many moves over par the naive player ends up. */
export function naiveGap(w: World, start: GameState, par: number): number {
  const { moves } = naiveBest(w, start, par + 14);
  return moves === null ? STUCK_GAP : Math.max(0, moves - par);
}
