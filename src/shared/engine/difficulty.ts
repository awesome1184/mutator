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
// Two planners do the same but keep the 4 or 12 most promising lines going at
// once. If these players can match par, the board is easy to figure out
// whatever its mutations are. difficultyScore turns how far over par each one
// ends up into the number the generator aims for.
import { ACTIONS, CELLS, DIRS, stepIdx, wrapIdx } from './grid.ts';
import { cellAt, step, stateKey } from './sim.ts';
import type { GameState } from './types.ts';
import { exitFor, isFloodedAt, layerFor, portalMode, portalPartner, shuttleHere, type Layer, type World } from './world.ts';

const FAR = 60;
/** Steps and walk measurements done so far, so callers can charge them to a budget. */
let work = 0;
/** walkLeft results for the current naiveBest call, keyed by state. */
let memo = new Map<string | number, number>();

type Walk = { solid: Uint8Array; L: Layer; mode: 0 | 1; exit: number };

function walkModel(w: World, s: GameState): Walk {
  const L = layerFor(w, s.turn);
  const solid = new Uint8Array(CELLS);
  for (let i = 0; i < CELLS; i++) {
    if (L.wall[i] === 1 || s.decay[i] === 0 || s.blight[i] === 1) solid[i] = 1;
    else if (w.has.FLOOD && isFloodedAt(w, s.turn, i)) solid[i] = 1;
    else if (L.door[i] && !s.doorsOpen) solid[i] = 1;
    else if ((w.lockAt[i] as number) >= 0 && !(s.locksOpen & (1 << (w.lockAt[i] as number))) && s.keys === 0) solid[i] = 1;
    else if ((L.paintGate[i] as number) >= 0 && s.paint !== (L.paintGate[i] as number) + 1) solid[i] = 1;
    else if (w.chasm[i] && !shuttleHere(w, i, s.turn)) solid[i] = 1;
  }
  return { solid, L, mode: portalMode(s.turn), exit: exitFor(w, s.turn) };
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

const QUEUE = new Int16Array(CELLS * 4);

function distances(w: World, m: Walk, from: number): Int16Array {
  const d = new Int16Array(CELLS).fill(FAR);
  d[from] = 0;
  QUEUE[0] = from;
  let tail = 1;
  const wrap = w.has.WRAPAROUND === true;
  for (let h = 0; h < tail; h++) {
    const i = QUEUE[h] as number;
    const next = (d[i] as number) + 1;
    for (let k = 0; k < 4; k++) {
      const dir = DIRS[k] as (typeof DIRS)[number];
      const j = wrap ? wrapIdx(i, dir) : stepIdx(i, dir);
      if (j < 0 || m.solid[j]) continue;
      // You can still collect something you are carried across, so record both tiles.
      if ((d[j] as number) > next) {
        d[j] = next;
        QUEUE[tail++] = j;
      }
      const to = settle(w, m, j);
      if (to !== j && (d[to] as number) > next) {
        d[to] = next;
        QUEUE[tail++] = to;
      }
    }
  }
  return d;
}

/** Shortest walk from `from` through every tile in `left` (at most two) and on to the exit. */
function tour(w: World, m: Walk, from: number, left: number[]): number {
  const here = distances(w, m, from);
  if (left.length === 0) return here[m.exit] as number;
  if (left.length === 1) {
    const a = left[0] as number;
    return (here[a] as number) + (distances(w, m, a)[m.exit] as number);
  }
  const [a, b] = left as [number, number];
  const fa = distances(w, m, a);
  const fb = distances(w, m, b);
  return Math.min(
    (here[a] as number) + (fa[b] as number) + (fb[m.exit] as number),
    (here[b] as number) + (fb[a] as number) + (fa[m.exit] as number)
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
  // Low Charge: a walk longer than the charge left needs a stop at a charger
  // (a cell would refill you too, but the tour already counts those).
  if (w.has.LOW_CHARGE && best > s.charge && left.length === 0) best = FAR;
  if (!(w.has.PAINT || w.has.KEYS || w.has.BLAST_DOORS || w.has.LOW_CHARGE)) return best;

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
    if (w.has.LOW_CHARGE && w.chargerAt[i] && (here[i] as number) <= s.charge) {
      detour(i, { ...s, charge: w.chargeMax });
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
  const visited = new Set<string | number>([stateKey(w, s)]);
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
 * A player who keeps the `width` most promising lines of play going at once
 * (judged by moves made plus walk left) instead of committing to one. Closer
 * to how a person weighs a few plans. Returns moves to solve, or null.
 */
export function beamMoves(w: World, start: GameState, width: number, cap: number): number | null {
  let layer: GameState[] = [start];
  const seen = new Set<string | number>([stateKey(w, start)]);
  while ((layer[0] as GameState).turn < cap) {
    const next: { s: GameState; h: number }[] = [];
    for (const s of layer) {
      for (const a of ACTIONS) {
        const r = step(w, s, a);
        work++;
        if (!r.ok) continue;
        if (r.state.solved) return r.state.turn;
        const key = stateKey(w, r.state);
        if (seen.has(key)) continue;
        seen.add(key);
        next.push({ s: r.state, h: walkLeft(w, r.state) + (a === 'W' ? 0.5 : 0) });
      }
    }
    if (next.length === 0) return null;
    // A stable sort keeps ties in a fixed order.
    next.sort((x, y) => x.h - y.h);
    layer = next.slice(0, width).map((x) => x.s);
  }
  return null;
}

/** The reference players: greedy with 1, 2 and 3 moves of lookahead, then beams 4 and 12 wide. */
export const PLAYERS = 5;

/**
 * How the naive player does with 1, 2 and 3 moves of lookahead (`each`, null
 * where they get stuck or pass `cap`), and the best of those (`moves`).
 * `work` is a rough count of the effort spent, comparable to solver states.
 */
export function naiveBest(w: World, start: GameState, cap: number): { moves: number | null; each: (number | null)[]; work: number } {
  work = 0;
  memo = new Map();
  const each = [...[1, 2, 3].map((look) => naiveMoves(w, start, look, cap)), ...[4, 12].map((width) => beamMoves(w, start, width, cap))];
  memo = new Map();
  const done = each.filter((n): n is number => n !== null);
  return { moves: done.length ? Math.min(...done) : null, each, work: Math.ceil(work * 1.5) };
}

/** The tiles the best greedy player stands on, in order (their whole route if they get stuck). */
export function naivePath(w: World, start: GameState, cap: number): number[] {
  memo = new Map();
  let best: number[] = [];
  let bestMoves = Infinity;
  for (const look of [1, 2, 3]) {
    const trail: number[] = [];
    const n = naiveMoves(w, start, look, cap, trail) ?? cap + 1;
    if (n < bestMoves) {
      bestMoves = n;
      best = trail;
    }
  }
  memo = new Map();
  return best;
}

/**
 * One number for how hard a board is to figure out, from how far over par
 * each reference player ends up: the best greedy player counts once (up to
 * 6), the 4-wide planner twice and the 12-wide planner three times (each up
 * to 4). 0 means a greedy walk finds par; above 10 or so, planning a few
 * lines ahead doesn't find it either.
 */
export function difficultyScore(each: readonly (number | null)[], par: number): number {
  const over = (n: number | null | undefined, cap: number): number => (n === null || n === undefined ? cap : Math.min(cap, Math.max(0, n - par)));
  const greedy = Math.min(over(each[0], 6), over(each[1], 6), over(each[2], 6));
  return greedy + 2 * over(each[3], 4) + 3 * over(each[4], 4);
}

/** The difficulty score of a board whose par is known. */
export function difficultyOf(w: World, start: GameState, par: number): number {
  return difficultyScore(naiveBest(w, start, par + 14).each, par);
}
