// Seeded daily board generator.
//
// The only randomness in MUTATOR lives here, and it is fully determined by the
// date and the day's mutations. Every candidate board is solved exhaustively;
// a board is only accepted when its par sits in the day's range and every
// active mutation changes the best route.

import { CELLS, DIRS, N, chebyshev, colOf, idx, manhattan, parseActions, ringOf, rowOf, stepIdx, toCoord, toIdx } from './grid.ts';
import { ALL_MUTATIONS, MUTATIONS } from './mutations.ts';
import { SeededRng } from './rng.ts';
import { dayPlan, mutationsFor, type DayPlan, type Tier } from './schedule.ts';
import { initialState, replay } from './sim.ts';
import { naiveBest, naivePath, STUCK_GAP } from './difficulty.ts';
import { solve } from './solver.ts';
import { RULES_VERSION } from './grid.ts';
import type { Coord, Dir, MutationId, Puzzle, StepEvent } from './types.ts';
import { compileWorld } from './world.ts';

const SIGNATURE: Partial<Record<MutationId, StepEvent['t'][]>> = {
  GRAVITY: ['gravity'],
  CONVEYOR: ['conveyor'],
  PORTALS: ['portal'],
  CRYO_SLICK: ['slide'],
  OVERCLOCK: ['move'],
  PHASE_SHIFT: ['move'],
  MAGNETISM: ['magnet'],
  MAGNETIC_CELLS: ['repel', 'attract'],
  BLAST_DOORS: ['doors'],
  REFLECTORS: ['reflect'],
  VENTILATION: ['vent'],
  ROTORS: ['rotor'],
  TURNTABLES: ['spin'],
  ORBITAL_CELLS: ['orbit'],
  SKITTISH_CELLS: ['flee'],
  CRATES: ['crate'],
  WRAPAROUND: ['wrap'],
  SPRINGS: ['spring'],
  PAINT: ['paint'],
  KEYS: ['unlock'],
  MUD: ['mud']
};

type Builder = {
  rng: SeededRng;
  muts: Set<MutationId>;
  order: number[];
  occ: Uint8Array;
  wall: Uint8Array;
  ring: Uint8Array;
  gaps: number[];
  sideOf: (i: number) => number;
};

function claim(b: Builder, pred?: (i: number) => boolean, allowRing = false): number {
  for (const i of b.order) {
    if (b.occ[i] || b.wall[i]) continue;
    if (!allowRing && b.ring[i]) continue;
    if (pred && !pred(i)) continue;
    b.occ[i] = 1;
    return i;
  }
  return -1;
}

const DIR_LIST: readonly Dir[] = DIRS;

function blankPuzzle(dateKey: string, plan: DayPlan, mutations: MutationId[], pick: MutationId | null, seed: string): Puzzle {
  return {
    v: RULES_VERSION,
    dateKey,
    number: plan.number,
    weekday: plan.weekday,
    tier: plan.tier.id,
    mutations,
    communityPick: pick,
    seed,
    grid: [],
    start: { r: 0, c: 0 },
    exit: { r: 0, c: 0 },
    cells: [
      { r: 0, c: 0 },
      { r: 0, c: 0 }
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
    crates: [],
    springs: [],
    paintPads: [],
    paintGates: [],
    keys: [],
    locks: [],
    mud: [],
    droneStart: null,
    echoStart: null,
    beam: null,
    flood: null,
    par: 0
  };
}

export function buildBoard(
  dateKey: string,
  plan: DayPlan,
  mutations: MutationId[],
  pick: MutationId | null,
  seed: string,
  attempt: number
): Puzzle | null {
  const rng = new SeededRng(`${seed}:attempt:${attempt}`);
  const muts = new Set(mutations);
  const has = (m: MutationId): boolean => muts.has(m);
  const tier: Tier = plan.tier;
  const p = blankPuzzle(dateKey, plan, mutations, pick, seed);
  p.blightOrder = rng.shuffle(DIR_LIST);

  const b: Builder = {
    rng,
    muts,
    order: rng.shuffle(Array.from({ length: CELLS }, (_, i) => i)),
    occ: new Uint8Array(CELLS),
    wall: new Uint8Array(CELLS),
    ring: new Uint8Array(CELLS),
    gaps: [],
    sideOf: () => 0
  };
  const setWall = (i: number): void => {
    b.wall[i] = 1;
    b.occ[i] = 1;
  };

  // 1. Tether pylon near the middle.
  let tether = -1;
  if (has('TETHER_PYLON')) {
    tether = claim(b, (i) => rowOf(i) >= 2 && rowOf(i) <= 4 && colOf(i) >= 2 && colOf(i) <= 4);
    if (tether < 0) return null;
    setWall(tether);
    p.tether = toCoord(tether);
  }
  const inZone = (i: number): boolean => tether < 0 || chebyshev(i, tether) <= 2;

  // 2. Turntable hubs with non-overlapping rings.
  const hubs: number[] = [];
  if (has('TURNTABLES')) {
    for (let k = 0; k < 2; k++) {
      const hub = claim(
        b,
        (i) =>
          rowOf(i) >= 1 &&
          rowOf(i) <= N - 2 &&
          colOf(i) >= 1 &&
          colOf(i) <= N - 2 &&
          hubs.every((h) => manhattan(h, i) >= 3) &&
          ringOf(i).every((r) => !b.occ[r] && !b.ring[r])
      );
      if (hub < 0) break;
      setWall(hub);
      hubs.push(hub);
      for (const r of ringOf(hub)) b.ring[r] = 1;
    }
    if (hubs.length === 0) return null;
    p.turntables = hubs.map(toCoord);
  }

  // 3. Layout style. A divider wall with gaps gives gates, doors and
  //    shortcuts something to guard.
  const gatewayMuts: MutationId[] = ['PHASE_GATES', 'BLAST_DOORS', 'ONE_WAY_GATES', 'PHASE_LAYERS', 'PHASE_SHIFT', 'PORTALS', 'PAINT', 'KEYS', 'SPRINGS', 'VENTILATION'];
  const wantsDivider = mutations.some((m) => gatewayMuts.includes(m));
  // Keys and paint only matter if every way across is guarded, so they nearly always get a divider.
  const sealable = has('KEYS') || has('PAINT');
  const style = wantsDivider && rng.next() < (sealable ? 0.92 : 0.7) ? 'divider' : rng.next() < 0.35 ? 'pillars' : 'scatter';
  if (style === 'divider' && tether < 0 && hubs.length === 0) {
    const axis = rng.next() < 0.5 ? 'row' : 'col';
    const line = rng.int(2, 5);
    const gapCount = has('PHASE_SHIFT') && mutations.length === 1 ? 0 : rng.int(1, 3);
    const along = rng.shuffle([0, 1, 2, 3, 4, 5, 6]);
    const gapSet = new Set(along.slice(0, gapCount));
    for (let k = 0; k < N; k++) {
      const i = axis === 'row' ? idx(line, k) : idx(k, line);
      if (gapSet.has(k)) {
        b.gaps.push(i);
      } else {
        setWall(i);
      }
    }
    b.sideOf = (i: number): number => {
      const v = axis === 'row' ? rowOf(i) : colOf(i);
      return v < line ? -1 : v > line ? 1 : 0;
    };
  } else if (style === 'pillars') {
    for (const [r, c] of [
      [1, 1],
      [1, 5],
      [5, 1],
      [5, 5],
      [3, 3]
    ] as const) {
      const i = idx(r, c);
      if (!b.occ[i] && !b.ring[i] && rng.next() < 0.6) setWall(i);
    }
  }
  const notGap = (i: number): boolean => !b.gaps.includes(i);

  // 4. Objectives.
  const start = claim(b, (i) => inZone(i) && notGap(i));
  if (start < 0) return null;
  const startSide = b.sideOf(start);
  // Harder days spread the objectives further apart.
  const spread = tether >= 0 ? 3 : tier.par[0] >= 12 ? 5 : tier.par[0] >= 10 ? 4 : 3;
  const cellA = claim(b, (i) => inZone(i) && notGap(i) && manhattan(i, start) >= spread);
  if (cellA < 0) return null;
  const cellB = claim(b, (i) => inZone(i) && notGap(i) && manhattan(i, start) >= 3 && manhattan(i, cellA) >= spread);
  if (cellB < 0) return null;
  const exit = claim(
    b,
    (i) =>
      inZone(i) &&
      notGap(i) &&
      manhattan(i, start) >= spread + 1 &&
      manhattan(i, cellA) >= 2 &&
      manhattan(i, cellB) >= 2 &&
      (startSide === 0 || b.sideOf(i) !== startSide)
  );
  if (exit < 0) return null;
  p.start = toCoord(start);
  p.exit = toCoord(exit);
  p.cells = [toCoord(cellA), toCoord(cellB)];

  // 5. Orbits: a 2x2 loop that includes each cell.
  if (has('ORBITAL_CELLS')) {
    for (const origin of [cellA, cellB]) {
      let chosen: number[] | null = null;
      for (const [dr, dc] of rng.shuffle([
        [-1, -1],
        [-1, 0],
        [0, -1],
        [0, 0]
      ] as const)) {
        const top = rowOf(origin) + dr;
        const left = colOf(origin) + dc;
        if (top < 0 || left < 0 || top + 1 >= N || left + 1 >= N) continue;
        const loop = [idx(top, left), idx(top, left + 1), idx(top + 1, left + 1), idx(top + 1, left)];
        const extras = loop.filter((i) => i !== origin);
        if (extras.some((i) => b.occ[i] || b.wall[i] || b.ring[i] || b.gaps.includes(i) || !inZone(i))) continue;
        const at = loop.indexOf(origin);
        chosen = loop.slice(at).concat(loop.slice(0, at));
        for (const e of extras) b.occ[e] = 1;
        break;
      }
      if (!chosen) return null;
      p.orbits.push(chosen.map(toCoord));
    }
  }

  // 6. Mirror drone / echo start opposite the courier where possible.
  const mirrorOf = (i: number): number => idx(N - 1 - rowOf(i), N - 1 - colOf(i));
  if (has('MIRROR_DRONE')) {
    const m = mirrorOf(start);
    let d = -1;
    if (!b.occ[m] && !b.wall[m] && !b.ring[m]) {
      d = m;
      b.occ[m] = 1;
    } else d = claim(b, (i) => i !== exit && manhattan(i, start) >= 3);
    if (d < 0) return null;
    p.droneStart = toCoord(d);
  }
  if (has('ECHO')) {
    let e = claim(b, (i) => i !== exit && manhattan(i, start) >= 3 && manhattan(i, start) <= 6);
    if (e < 0) e = claim(b);
    if (e < 0) return null;
    p.echoStart = toCoord(e);
  }

  // 7. Portals.
  if (has('PORTALS')) {
    const pads: number[] = [];
    for (let label = 0; label < 4; label++) {
      const pad = claim(b, (i) => notGap(i) && pads.every((q) => manhattan(q, i) >= 2));
      if (pad < 0) return null;
      pads.push(pad);
      p.portals.push({ ...toCoord(pad), label: label as 0 | 1 | 2 | 3 });
    }
  }

  // 8. Features that guard gateways: prefer the divider gaps.
  const claimGateway = (): number => {
    for (const g of b.gaps) {
      if (!b.occ[g]) {
        b.occ[g] = 1;
        return g;
      }
    }
    return claim(b, undefined, true);
  };

  if (has('PHASE_GATES')) {
    const n = rng.int(3, 5);
    for (let k = 0; k < n; k++) {
      const g = k < 2 ? claimGateway() : claim(b, undefined, true);
      if (g >= 0) p.gates.push({ ...toCoord(g), polarity: (k % 2) as 0 | 1 });
    }
  }
  if (has('BLAST_DOORS')) {
    const doors = rng.int(2, 4);
    for (let k = 0; k < doors; k++) {
      const d = k === 0 ? claimGateway() : claim(b, undefined, true);
      if (d >= 0) p.doors.push(toCoord(d));
    }
    for (let k = 0; k < 2; k++) {
      const side = k === 0 ? startSide : -startSide;
      let plate = claim(b, (i) => side === 0 || b.sideOf(i) === side, true);
      if (plate < 0) plate = claim(b, undefined, true);
      if (plate >= 0) p.plates.push(toCoord(plate));
    }
    if (p.doors.length === 0 || p.plates.length === 0) return null;
  }
  if (has('ONE_WAY_GATES')) {
    const n = rng.int(2, 4);
    for (let k = 0; k < n; k++) {
      const g = k === 0 ? claimGateway() : claim(b, undefined, true);
      if (g < 0) continue;
      const dirs = DIR_LIST.filter((d) => stepIdx(g, d) >= 0);
      p.oneWays.push({ ...toCoord(g), dir: rng.pick(dirs) });
    }
  }
  // Wall in a target (the exit or a cell) except for one entrance, and return
  // the entrance, or -1 if the target's surroundings are already in use.
  const pocket = (target: number): number => {
    if (has('WRAPAROUND') || target < 0) return -1;
    const open = DIR_LIST.map((d) => stepIdx(target, d)).filter((j) => j >= 0 && !b.wall[j]);
    if (open.length < 2 || open.some((j) => b.occ[j] || b.ring[j] || b.gaps.includes(j))) return -1;
    const entrance = rng.pick(open);
    for (const j of open) if (j !== entrance) setWall(j);
    b.occ[entrance] = 1;
    return entrance;
  };
  // Claim a tile far from the given ones (picked at random among the farthest few).
  const claimFar = (pred: (i: number) => boolean, from: number[]): number => {
    const options = b.order.filter((i) => !b.occ[i] && !b.wall[i] && !b.ring[i] && pred(i));
    if (options.length === 0) return -1;
    const far = (i: number): number => Math.min(...from.map((f) => manhattan(f, i)));
    const top = Math.max(...options.map(far));
    const pickFrom = options.filter((i) => far(i) >= top - 1);
    const i = rng.pick(pickFrom);
    b.occ[i] = 1;
    return i;
  };
  const farSide = (i: number): boolean => startSide === 0 || b.sideOf(i) === -startSide;
  const nearSide = (i: number): boolean => startSide === 0 || b.sideOf(i) === startSide;
  // Pockets add a second errand, which is too long for a warm-up.
  const pocketOdds = tier.id === 'warmup' ? 0 : tier.id === 'standard' ? 0.35 : 0.65;
  // The pocket goes round the exit, or round a cell on the far side.
  const pocketTarget = (): number => (rng.next() < 0.5 ? exit : [cellA, cellB].find((c) => farSide(c)) ?? exit);

  // Every free gap in the divider gets a barrier or a lock, so the far side
  // has to be earned. Gaps are shared out when both mutations are active.
  const freeGaps = b.gaps.filter((g) => !b.occ[g]);
  const paintGaps = has('PAINT') ? (has('KEYS') ? freeGaps.filter((_, k) => k % 2 === 0) : freeGaps) : [];
  const lockGaps = has('KEYS') ? (has('PAINT') ? freeGaps.filter((_, k) => k % 2 === 1) : freeGaps) : [];
  if (has('PAINT')) {
    const first = rng.int(0, 2) as 0 | 1;
    const gates: { at: number; color: 0 | 1 }[] = paintGaps.map((g, k) => {
      b.occ[g] = 1;
      return { at: g, color: ((first + k) % 2) as 0 | 1 };
    });
    // A pocket in the other colour makes you repaint on the far side.
    const entrance = rng.next() < pocketOdds || gates.length === 0 ? pocket(pocketTarget()) : -1;
    if (entrance >= 0) gates.push({ at: entrance, color: (1 - first) as 0 | 1 });
    if (gates.length === 0) {
      const g = claim(b, undefined, true);
      if (g >= 0) gates.push({ at: g, color: first });
    }
    for (const g of gates) (p.paintGates ??= []).push({ ...toCoord(g.at), color: g.color });
    // The divider's colour is fetched on your own side, the pocket's colour on
    // the far side, each away from the barrier it opens.
    const dividerColors = new Set(gates.filter((g) => g.at !== entrance).map((g) => g.color));
    for (const color of [0, 1] as const) {
      const opens = gates.filter((g) => g.color === color).map((g) => g.at);
      if (opens.length === 0) continue;
      const side = dividerColors.has(color) ? nearSide : farSide;
      let pad = claimFar((i) => side(i) && manhattan(i, start) >= 2, [...opens, start]);
      if (pad < 0) pad = claim(b, (i) => manhattan(i, start) >= 2, true);
      if (pad >= 0) (p.paintPads ??= []).push({ ...toCoord(pad), color });
    }
    if ((p.paintGates ?? []).length === 0 || (p.paintPads ?? []).length === 0) return null;
  }
  if (has('KEYS')) {
    const locks = lockGaps.map((g) => ((b.occ[g] = 1), g));
    const entrance = rng.next() < pocketOdds || locks.length === 0 ? pocket(pocketTarget()) : -1;
    if (entrance >= 0) locks.push(entrance);
    if (locks.length === 0) {
      const extra = claim(b);
      if (extra >= 0) locks.push(extra);
    }
    // One key for each lock you must get through: one on your side for the
    // divider, one anywhere for the pocket. Spares make it a choice.
    const needed = (lockGaps.length > 0 ? 1 : 0) + (entrance >= 0 ? 1 : 0) || 1;
    const keyCount = Math.min(locks.length, needed + (rng.next() < 0.3 ? 1 : 0));
    for (let k = 0; k < keyCount; k++) {
      const side = k === 0 ? nearSide : (): boolean => true;
      let key = claimFar((i) => side(i) && manhattan(i, start) >= 2, [...locks, start]);
      if (key < 0) key = claim(b, (i) => manhattan(i, start) >= 2);
      if (key >= 0) (p.keys ??= []).push(toCoord(key));
    }
    for (const l of locks) (p.locks ??= []).push(toCoord(l));
    if ((p.locks ?? []).length === 0 || (p.keys ?? []).length === 0) return null;
  }
  if (has('PHASE_LAYERS')) {
    const n = rng.int(4, 7);
    for (let k = 0; k < n; k++) {
      const t = k < 2 ? claimGateway() : claim(b, undefined, true);
      if (t >= 0) p.phaseTiles.push({ ...toCoord(t), layer: (k % 2) as 0 | 1 });
    }
  }

  // 9. Other tile features.
  if (has('CONVEYOR')) {
    // One chain of 2-3 belts plus a few singles.
    const chainLen = rng.int(2, 4);
    const head = claim(b, undefined, true);
    if (head >= 0) {
      const dir = rng.pick(DIR_LIST);
      let cur = head;
      p.conveyors.push({ ...toCoord(cur), dir });
      for (let k = 1; k < chainLen; k++) {
        const nxt = stepIdx(cur, dir);
        if (nxt < 0 || b.occ[nxt] || b.wall[nxt] || stepIdx(nxt, dir) < 0) break;
        b.occ[nxt] = 1;
        p.conveyors.push({ ...toCoord(nxt), dir });
        cur = nxt;
      }
      if (stepIdx(cur, dir) < 0) p.conveyors.pop();
    }
    const singles = rng.int(2, 4);
    for (let k = 0; k < singles; k++) {
      const c = claim(b, undefined, true);
      if (c < 0) break;
      const dirs = DIR_LIST.filter((d) => {
        const n2 = stepIdx(c, d);
        return n2 >= 0 && !p.conveyors.some((cv) => idx(cv.r, cv.c) === n2 && stepIdx(n2, cv.dir) === c);
      });
      if (dirs.length) p.conveyors.push({ ...toCoord(c), dir: rng.pick(dirs) });
    }
  }
  if (has('CRYO_SLICK')) {
    // Two patches of ice grown from seeds.
    const target = rng.int(5, 9);
    const seeds = [claim(b, undefined, true), claim(b, undefined, true)].filter((s) => s >= 0);
    const ice: number[] = [...seeds];
    let guard = 0;
    while (ice.length < target && guard++ < 60) {
      const from = rng.pick(ice);
      const nxt = stepIdx(from, rng.pick(DIR_LIST));
      if (nxt < 0 || b.occ[nxt] || b.wall[nxt]) continue;
      b.occ[nxt] = 1;
      ice.push(nxt);
    }
    p.ice = ice.map(toCoord);
  }
  if (has('MAGNETISM')) {
    for (let k = 0; k < 2; k++) {
      const m = claim(b, (i) => rowOf(i) >= 1 && rowOf(i) <= N - 2 && colOf(i) >= 1 && colOf(i) <= N - 2);
      if (m >= 0) {
        setWall(m);
        p.magnets.push(toCoord(m));
      }
    }
    if (p.magnets.length === 0) return null;
  }
  if (has('INFECTION')) {
    const n = has('DECAY') ? 1 : rng.int(1, 3);
    for (let k = 0; k < n; k++) {
      const s = claim(b, (i) => manhattan(i, start) >= 3 && manhattan(i, exit) >= 2);
      if (s >= 0) p.blight.push(toCoord(s));
    }
    if (p.blight.length === 0) return null;
  }
  if (has('REFLECTORS')) {
    const n = rng.int(2, 4);
    for (let k = 0; k < n; k++) {
      const t = claim(b, undefined, true);
      if (t >= 0) p.reflectors.push({ ...toCoord(t), rot: rng.next() < 0.5 ? 1 : -1 });
    }
  }
  if (has('VENTILATION')) {
    // A vent in a doorway blowing back toward your side, so you have to cross on an even move.
    const door = b.gaps.find((g) => !b.occ[g]);
    if (door !== undefined && startSide !== 0) {
      const back = DIR_LIST.find((d) => {
        const j = stepIdx(door, d);
        return j >= 0 && b.sideOf(j) === startSide;
      });
      if (back) {
        b.occ[door] = 1;
        p.vents.push({ ...toCoord(door), dir: back });
      }
    }
    // A short wind tunnel: two or three vents in a row, all blowing the same way.
    const head = claim(b, undefined, true);
    if (head >= 0) {
      const dir = rng.pick(DIR_LIST.filter((d) => stepIdx(head, d) >= 0));
      p.vents.push({ ...toCoord(head), dir });
      let cur = head;
      for (let k = rng.int(1, 3); k > 0; k--) {
        const nx = stepIdx(cur, dir);
        if (nx < 0 || b.occ[nx] || b.wall[nx] || b.ring[nx] || stepIdx(nx, dir) < 0) break;
        b.occ[nx] = 1;
        p.vents.push({ ...toCoord(nx), dir });
        cur = nx;
      }
    }
    for (let k = rng.int(1, 3); k > 0; k--) {
      const t = claim(b, undefined, true);
      if (t < 0) continue;
      const dirs = DIR_LIST.filter((d) => stepIdx(t, d) >= 0);
      p.vents.push({ ...toCoord(t), dir: rng.pick(dirs) });
    }
  }
  if (has('ROTORS')) {
    const n = rng.int(2, 4);
    for (let k = 0; k < n; k++) {
      const t = claim(b, undefined, true);
      if (t >= 0) p.rotors.push({ ...toCoord(t), rot: rng.next() < 0.5 ? 1 : -1 });
    }
  }
  if (has('SPRINGS')) {
    const n = rng.int(2, 4);
    for (let k = 0; k < n; k++) {
      const t = claim(b, undefined, true);
      if (t >= 0) (p.springs ??= []).push(toCoord(t));
    }
  }
  if (has('MUD')) {
    const n = rng.int(3, 6);
    for (let k = 0; k < n; k++) {
      const t = claim(b, (i) => manhattan(i, start) >= 1, true);
      if (t >= 0) (p.mud ??= []).push(toCoord(t));
    }
  }
  if (has('CRATES')) {
    const n = rng.int(2, 4);
    for (let k = 0; k < n; k++) {
      const t = claim(b, (i) => rowOf(i) > 0 && rowOf(i) < N - 1 && colOf(i) > 0 && colOf(i) < N - 1 && manhattan(i, start) >= 2, true);
      if (t >= 0) (p.crates ??= []).push(toCoord(t));
    }
    if ((p.crates ?? []).length === 0) return null;
  }
  if (has('PULSE_BEAM')) {
    const axis = rng.next() < 0.5 ? 'row' : 'col';
    const sv = axis === 'row' ? rowOf(start) : colOf(start);
    const ev = axis === 'row' ? rowOf(exit) : colOf(exit);
    const edges = [0, N - 1].filter((n) => n !== sv && n !== ev);
    const s = edges.length ? rng.pick(edges) : sv < 3 ? N - 1 : 0;
    p.beam = { axis, start: s, step: s === 0 ? 1 : -1 };
  }
  if (has('FLOOD')) {
    const safe: Dir[] = [];
    const objectives = [start, exit];
    if (objectives.every((i) => rowOf(i) >= 2)) safe.push('U');
    if (objectives.every((i) => rowOf(i) <= N - 3)) safe.push('D');
    if (objectives.every((i) => colOf(i) >= 2)) safe.push('L');
    if (objectives.every((i) => colOf(i) <= N - 3)) safe.push('R');
    if (safe.length === 0) return null;
    p.flood = { edge: rng.pick(safe) };
  }
  if (has('MAGNETIC_CELLS')) {
    // Give Cell A a braced approach: an open tile backed by a wall.
    for (const d of rng.shuffle(DIR_LIST)) {
      const adj = stepIdx(cellA, d);
      const back = stepIdx(adj, d);
      if (adj < 0 || back < 0 || b.occ[adj] || b.occ[back] || b.ring[adj] || b.ring[back]) continue;
      b.occ[adj] = 1;
      setWall(back);
      break;
    }
  }

  // Turntable rings should carry at least one wall so a spin changes routes.
  for (const hub of hubs) {
    const free = rng.shuffle(ringOf(hub)).find((r) => !b.occ[r] && !b.wall[r]);
    if (free !== undefined) setWall(free);
  }

  // 10. Extra walls, fewer when the mutations already block a lot.
  const blockers = mutations.filter((m) =>
    ['KEYS', 'PAINT', 'MUD', 'CRATES', 'DECAY', 'INFECTION', 'PHASE_GATES', 'BLAST_DOORS', 'TURNTABLES', 'MAGNETISM', 'TETHER_PYLON', 'AFTERIMAGE', 'ECHO', 'ONE_WAY_GATES', 'PULSE_BEAM', 'FLOOD', 'PHASE_LAYERS'].includes(m)
  ).length;
  const [wMin, wMax] = tier.walls;
  const extra = Math.max(0, rng.int(wMin, wMax + 1) - blockers - (style === 'divider' ? 3 : 0));
  for (let k = 0; k < extra; k++) {
    const w = claim(b, undefined, true);
    if (w < 0) break;
    setWall(w);
  }

  const grid: string[] = [];
  for (let r = 0; r < N; r++) {
    let row = '';
    for (let c = 0; c < N; c++) row += b.wall[idx(r, c)] ? '#' : '.';
    grid.push(row);
  }
  p.grid = grid;
  return p;
}

/** A copy of the puzzle with one mutation (and its tiles) removed. */
export function ablate(p: Puzzle, m: MutationId): Puzzle {
  const q: Puzzle = { ...p, mutations: p.mutations.filter((x) => x !== m) };
  // Walls that only existed for the mutation (magnets, hubs, pylon) become floor.
  const clear: Coord[] = [];
  if (m === 'MAGNETISM') clear.push(...p.magnets);
  if (m === 'TURNTABLES') clear.push(...p.turntables);
  if (m === 'TETHER_PYLON' && p.tether) clear.push(p.tether);
  if (clear.length) {
    q.grid = p.grid.map((row, r) =>
      row
        .split('')
        .map((ch, c) => (clear.some((x) => x.r === r && x.c === c) ? '.' : ch))
        .join('')
    );
  }
  return q;
}

type Scored = {
  puzzle: Puzzle;
  score: number;
  inRange: boolean;
  relevant: boolean;
  hard: boolean;
  /** How far over par the best naive player ends up. */
  gap: number;
  /** The same for all three naive players added up: a finer signal for climbing. */
  slack: number;
  decayFlat: boolean;
};

type Budget = { left: number };

/**
 * Decay is only interesting when it breaks the obvious route, so cracked floor
 * is laid along (and especially on the revisited tiles of) the best route of
 * the board without Decay.
 */
function crackEligibility(p: Puzzle): (i: number) => boolean {
  const plain = compileWorld(ablate(p, 'DECAY'));
  const L = plain.layers[0];
  const blocked = new Uint8Array(CELLS);
  const mark = (c: Coord | null | undefined): void => {
    if (c) blocked[c.r * N + c.c] = 1;
  };
  [p.start, p.exit, ...p.cells, ...p.orbits.flat(), ...p.portals, ...p.blight, p.droneStart, p.echoStart, p.tether].forEach(mark);
  for (const hub of plain.hubs) for (const r of ringOf(hub)) blocked[r] = 1;
  return (i: number): boolean => !blocked[i] && !!L && !L.wall[i] && !L.special[i];
}

/** How many times the courier stands on each tile along a route. */
function routeVisits(p: Puzzle, path: string): Uint8Array {
  const w = compileWorld(p);
  const trace = replay(w, parseActions(path) ?? []);
  const visits = new Uint8Array(CELLS);
  for (const evs of trace.events) {
    for (const e of evs) {
      if ('from' in e && 'to' in e && e.t !== 'echo' && e.t !== 'drone' && e.t !== 'orbit') {
        visits[e.to] = (visits[e.to] as number) + 1;
      }
    }
  }
  visits[w.start] = (visits[w.start] as number) + 1;
  return visits;
}

function placeCracks(p: Puzzle, tier: Tier, rng: SeededRng, budget: Budget): boolean {
  const plain = compileWorld(ablate(p, 'DECAY'));
  const [, hi] = parRange(tier, p.mutations);
  const res = solve(plain, { maxDepth: hi + 2, maxStates: Math.min(20000, budget.left) });
  budget.left -= res.explored;
  if (!res.solvable) return false;
  const visits = routeVisits(ablate(p, 'DECAY'), res.path.join(''));
  const eligible = crackEligibility(p);

  const revisited: number[] = [];
  const route: number[] = [];
  const others: number[] = [];
  for (let i = 0; i < CELLS; i++) {
    if (!eligible(i)) continue;
    const v = visits[i] as number;
    if (v >= 2) revisited.push(i);
    else if (v === 1) route.push(i);
    else others.push(i);
  }
  // Decay only bites when the obvious route has to cross itself.
  if (revisited.length === 0) return false;
  const picked = new Set<number>(revisited);
  for (const i of rng.shuffle(route)) if (picked.size < 8 && rng.next() < 0.6) picked.add(i);
  for (const i of rng.shuffle(others)) if (picked.size < 12 && rng.next() < 0.35) picked.add(i);
  if (picked.size < 4) return false;
  p.cracked = [...picked].sort((a, b) => a - b).map(toCoord);
  return true;
}

/** Cracks the tiles that the current best route still steps on twice. */
function deepenCracks(p: Puzzle): boolean {
  if (!p.solution) return false;
  const visits = routeVisits(p, p.solution);
  const eligible = crackEligibility(p);
  const have = new Set(p.cracked.map((c) => c.r * N + c.c));
  let added = 0;
  for (let i = 0; i < CELLS; i++) {
    if ((visits[i] as number) >= 2 && eligible(i) && !have.has(i)) {
      have.add(i);
      added++;
    }
  }
  if (added === 0) return false;
  p.cracked = [...have].sort((a, b) => a - b).map(toCoord);
  return true;
}

/** Par range for a tier, tightened when history-heavy mutations explode the search. */
export function parRange(tier: Tier, mutations: readonly MutationId[]): [number, number] {
  const [lo, hi] = tier.par;
  const heavy = mutations.includes('INFECTION');
  return heavy ? [Math.min(lo, 12), Math.min(hi, 18)] : [lo, hi];
}

/**
 * Solve and score a board. While searching, easy boards are dropped once there
 * is a relevant board to fall back on. While climbing (`climb`), every board
 * is solved, but relevance is only checked once a board is hard enough.
 */
function evaluate(p: Puzzle, tier: Tier, budget: Budget, best: Scored | null, climb = false): Scored | null {
  const w = compileWorld(p);
  const [lo, hi] = parRange(tier, p.mutations);
  // The naive player first: it needs no par and costs little. A board is hard
  // when par sits at least tier.gap moves below their score, so the solver
  // only has to look that deep to find out.
  const naive = naiveBest(w, initialState(w), hi + 14);
  budget.left -= naive.work;
  const hardDepth = Math.min(hi, naive.moves === null ? hi : naive.moves - tier.gap);
  let res = hardDepth >= lo ? solve(w, { maxDepth: hardDepth, maxStates: Math.min(45000, budget.left) }) : null;
  if (res) budget.left -= res.explored;
  if (!res || !res.solvable) {
    // Too easy, or too big to search. Only worth pinning down if we have
    // nothing relevant to fall back on.
    if (best?.relevant && !climb) return null;
    res = solve(w, { maxDepth: hi + 2, maxStates: Math.min(45000, budget.left) });
    budget.left -= res.explored;
  }
  if (!res.solvable) return null;
  p.par = res.par;
  p.solution = res.path.join('');
  const inRange = res.par >= lo && res.par <= hi;
  const gap = naive.moves === null ? STUCK_GAP : Math.max(0, naive.moves - res.par);
  const hard = gap >= tier.gap;
  const par = res.par;
  const slack = naive.each.reduce<number>((sum, n) => sum + (n === null ? 15 : Math.min(15, n - par)), 0);

  const trace = replay(w, res.path);
  const seen = new Set<StepEvent['t']>();
  const kinds = new Set<string>();
  for (const evs of trace.events) {
    for (const e of evs) {
      seen.add(e.t);
      kinds.add(e.t === 'move' ? `move:${e.kind}` : e.t);
    }
  }

  let relevant = inRange && (hard || !climb);
  let decayFlat = false;
  // Cheap checks first: removing history-heavy mutations shrinks the search.
  const order = [...p.mutations].sort((a, b) => Number(b === 'DECAY' || b === 'INFECTION') - Number(a === 'DECAY' || a === 'INFECTION'));
  for (const m of order) {
    if (!relevant) break;
    const sig = SIGNATURE[m];
    if (sig) {
      const hit =
        m === 'OVERCLOCK'
          ? kinds.has('move:overclock')
          : m === 'PHASE_SHIFT'
            ? kinds.has('move:phase')
            : sig.some((t) => seen.has(t));
      if (!hit) relevant = false;
    }
    if (!relevant) break;
    // Only "same par without it" disqualifies; an inconclusive search counts as a pass.
    const abRes = solve(compileWorld(ablate(p, m)), { maxDepth: res.par, maxStates: Math.min(30000, Math.max(1000, budget.left)) });
    budget.left -= abRes.explored;
    if (abRes.solvable && abRes.par === res.par) {
      relevant = false;
      if (m === 'DECAY') decayFlat = true;
    }
  }

  const target = (lo + hi) / 2;
  // In order: par in range, every mutation matters, hard enough, then a
  // bigger gap (up to a point) and a par near the middle of the range.
  const tooHard = tier.maxGap !== undefined && gap > tier.maxGap;
  const score =
    (inRange ? 400 : 0) +
    (relevant ? 200 : 0) +
    (hard ? 100 : 0) -
    (tooHard ? 60 : 0) +
    Math.min(gap, tier.gap + 2) * 12 -
    Math.abs(res.par - target) * 2 +
    kinds.size;
  return { puzzle: p, score, inRange, relevant, hard, gap, slack, decayFlat };
}

// ------------------------------------------------------------------ climbing
//
// When no board from the search is hard enough, the best one is nudged a tile
// at a time (a wall added or removed, a feature moved or turned, a cell or the
// exit moved) and a nudge is kept if it brings the board closer.

const MOVABLE = [
  'cracked',
  'conveyors',
  'portals',
  'gates',
  'doors',
  'plates',
  'ice',
  'blight',
  'reflectors',
  'oneWays',
  'vents',
  'phaseTiles',
  'rotors',
  'crates',
  'springs',
  'paintPads',
  'paintGates',
  'keys',
  'locks',
  'mud'
] as const;

function perturb(src: Puzzle, rng: SeededRng, path: readonly number[]): Puzzle | null {
  const p = JSON.parse(JSON.stringify(src)) as Puzzle;
  delete p.solution;
  const grid = p.grid.map((row) => row.split(''));
  const wallAt = (i: number): boolean => grid[rowOf(i)]?.[colOf(i)] === '#';
  const setGrid = (i: number, ch: string): void => {
    (grid[rowOf(i)] as string[])[colOf(i)] = ch;
  };
  const occ = new Uint8Array(CELLS);
  const fixed = new Uint8Array(CELLS);
  const mark = (c: Coord | null | undefined): void => {
    if (c) occ[toIdx(c)] = 1;
  };
  mark(p.start);
  mark(p.exit);
  p.cells.forEach(mark);
  mark(p.droneStart);
  mark(p.echoStart);
  for (const k of MOVABLE) for (const t of p[k] ?? []) mark(t);
  for (const m of p.magnets) fixed[toIdx(m)] = 1;
  for (const h of p.turntables) {
    fixed[toIdx(h)] = 1;
    for (const d of DIRS) {
      const j = stepIdx(toIdx(h), d);
      if (j >= 0) fixed[j] = 1;
    }
  }
  if (p.tether) fixed[toIdx(p.tether)] = 1;
  for (const o of p.orbits) for (const c of o) fixed[toIdx(c)] = 1;
  const free: number[] = [];
  for (let i = 0; i < CELLS; i++) if (!occ[i] && !fixed[i] && !wallAt(i)) free.push(i);
  if (free.length === 0) return null;
  // Most nudges land on the naive player's route: that is where a change
  // can turn the obvious way into a wrong one.
  const onPath = free.filter((i) => path.includes(i));
  const spot = (): number => (onPath.length > 0 && rng.next() < 0.7 ? rng.pick(onPath) : rng.pick(free));
  const to = (): Coord => toCoord(spot());

  const lists = MOVABLE.filter((k) => (p[k] ?? []).length > 0);
  const aimed = (['conveyors', 'oneWays', 'vents', 'reflectors', 'rotors'] as const).filter((k) => p[k].length > 0);
  const op = rng.int(0, 5);
  if (op === 0) {
    setGrid(spot(), '#');
  } else if (op === 1) {
    const walls: number[] = [];
    for (let i = 0; i < CELLS; i++) if (wallAt(i) && !fixed[i]) walls.push(i);
    if (walls.length === 0) return null;
    setGrid(rng.pick(walls), '.');
  } else if (op === 2 && lists.length > 0) {
    const list = p[rng.pick(lists)] as Coord[];
    const k = rng.int(0, list.length);
    list[k] = { ...(list[k] as Coord), ...to() };
  } else if (op === 3 && aimed.length > 0) {
    const key = rng.pick(aimed);
    if (key === 'reflectors' || key === 'rotors') {
      const t = rng.pick(p[key]);
      t.rot = t.rot === 1 ? -1 : 1;
    } else {
      rng.pick(p[key]).dir = rng.pick(DIRS);
    }
  } else if (op === 4 && !p.mutations.includes('ORBITAL_CELLS')) {
    const which = rng.int(0, 3);
    const c = toCoord(rng.pick(free));
    if (which === 2) p.exit = c;
    else p.cells[which] = c;
  } else {
    setGrid(spot(), '#');
  }
  p.grid = grid.map((row) => row.join(''));
  return p;
}

/** Lexicographic progress while climbing: in range, hard and relevant, gap, par near the middle. */
function climbKey(s: Scored, tier: Tier, target: number): number[] {
  const over = tier.maxGap !== undefined && s.gap > tier.maxGap ? 1 : 0;
  return [s.inRange ? 1 : 0, s.hard && s.relevant ? 1 : 0, -over, Math.min(s.gap, tier.gap + 2), s.slack, -Math.abs(s.puzzle.par - target)];
}

function compareKeys(a: number[], b: number[]): number {
  for (let i = 0; i < a.length; i++) {
    if ((a[i] as number) !== (b[i] as number)) return (a[i] as number) > (b[i] as number) ? 1 : -1;
  }
  return 0;
}

function atLeast(a: number[], b: number[]): boolean {
  return compareKeys(a, b) >= 0;
}

export const climbStats = { steps: 0, accepted: 0, budgetAtStart: 0, startSlack: 0, endSlack: 0, maxSlackSeen: 0 };

function climb(start: Scored, tier: Tier, mutations: readonly MutationId[], budget: Budget, rng: SeededRng, steps: number): Scored {
  climbStats.steps = 0;
  climbStats.accepted = 0;
  climbStats.budgetAtStart = budget.left;
  climbStats.startSlack = start.slack;
  climbStats.maxSlackSeen = start.slack;
  const [lo, hi] = parRange(tier, mutations);
  const target = (lo + hi) / 2;
  let cur = start;
  let best = start;
  let path: number[] = [];
  let pathOf: Puzzle | null = null;
  for (let k = 0; k < steps && budget.left > 0; k++) {
    if (pathOf !== cur.puzzle) {
      const w = compileWorld(cur.puzzle);
      path = naivePath(w, initialState(w), cur.puzzle.par + 14);
      budget.left -= path.length * 40;
      pathOf = cur.puzzle;
    }
    const q = perturb(cur.puzzle, rng, path);
    if (!q) continue;
    climbStats.steps++;
    const sc = evaluate(q, tier, budget, null, true);
    if (!sc) continue;
    climbStats.maxSlackSeen = Math.max(climbStats.maxSlackSeen, sc.slack);
    // Ties are accepted so the search can cross flat ground.
    if (atLeast(climbKey(sc, tier, target), climbKey(cur, tier, target))) {
      cur = sc;
      climbStats.accepted++;
    }
    if (cur.score > best.score) best = cur;
    if (cur.hard && cur.relevant && cur.inRange) break;
  }
  climbStats.endSlack = cur.slack;
  return best;
}

function fallbackPuzzle(dateKey: string, plan: DayPlan, mutations: MutationId[], pick: MutationId | null, seed: string): Puzzle {
  // An open room with pillars. Always solvable for every mutation mix we ship.
  const p = blankPuzzle(dateKey, plan, mutations, pick, seed);
  const has = (m: MutationId): boolean => mutations.includes(m);
  p.grid = ['.......', '.#...#.', '.......', '...#...', '.......', '.#...#.', '.......'];
  p.start = { r: 3, c: 1 };
  p.cells = [
    { r: 0, c: 3 },
    { r: 6, c: 3 }
  ];
  p.exit = { r: 3, c: 5 };
  if (has('ORBITAL_CELLS')) {
    p.orbits = [
      [
        { r: 0, c: 3 },
        { r: 0, c: 4 },
        { r: 1, c: 4 },
        { r: 1, c: 3 }
      ],
      [
        { r: 6, c: 3 },
        { r: 5, c: 3 },
        { r: 5, c: 2 },
        { r: 6, c: 2 }
      ]
    ];
  }
  if (has('CONVEYOR')) p.conveyors = [{ r: 2, c: 2, dir: 'R' }, { r: 4, c: 4, dir: 'L' }];
  if (has('PORTALS'))
    p.portals = [
      { r: 0, c: 0, label: 0 },
      { r: 6, c: 6, label: 1 },
      { r: 6, c: 0, label: 2 },
      { r: 0, c: 6, label: 3 }
    ];
  if (has('PHASE_GATES')) p.gates = [{ r: 2, c: 3, polarity: 0 }, { r: 4, c: 3, polarity: 1 }];
  if (has('BLAST_DOORS')) {
    p.doors = [{ r: 3, c: 4 }];
    p.plates = [{ r: 2, c: 1 }];
  }
  if (has('CRYO_SLICK')) p.ice = [{ r: 2, c: 4 }, { r: 2, c: 5 }, { r: 4, c: 1 }];
  if (has('MAGNETISM')) {
    p.magnets = [{ r: 1, c: 1 }];
  }
  if (has('TURNTABLES')) p.turntables = [{ r: 3, c: 3 }];
  if (has('TETHER_PYLON')) p.tether = { r: 3, c: 3 };
  if (has('INFECTION')) p.blight = [{ r: 6, c: 6 }];
  if (has('DECAY')) p.cracked = [{ r: 2, c: 1 }, { r: 4, c: 1 }, { r: 2, c: 5 }, { r: 4, c: 5 }];
  if (has('REFLECTORS')) p.reflectors = [{ r: 4, c: 2, rot: 1 }];
  if (has('ONE_WAY_GATES')) p.oneWays = [{ r: 2, c: 3, dir: 'R' }];
  if (has('VENTILATION')) p.vents = [{ r: 4, c: 4, dir: 'U' }];
  if (has('PHASE_LAYERS')) p.phaseTiles = [{ r: 3, c: 2, layer: 0 }, { r: 3, c: 4, layer: 1 }];
  if (has('ROTORS')) p.rotors = [{ r: 2, c: 2, rot: 1 }];
  if (has('CRATES')) p.crates = [{ r: 4, c: 3 }];
  if (has('SPRINGS')) p.springs = [{ r: 4, c: 2 }];
  if (has('PAINT')) {
    p.paintPads = [{ r: 2, c: 1, color: 0 }];
    p.paintGates = [{ r: 3, c: 4, color: 0 }];
  }
  if (has('KEYS')) {
    p.keys = [{ r: 4, c: 1 }];
    p.locks = [{ r: 2, c: 5 }];
  }
  if (has('MUD')) p.mud = [{ r: 4, c: 4 }];
  if (has('MIRROR_DRONE')) p.droneStart = { r: 0, c: 6 };
  if (has('ECHO')) p.echoStart = { r: 6, c: 0 };
  if (has('PULSE_BEAM')) p.beam = { axis: 'col', start: 0, step: 1 };
  if (has('FLOOD')) p.flood = { edge: 'U' };
  return p;
}

export type GenerateOptions = {
  /** The community-voted mutation for the day (validated against the plan). */
  pick?: MutationId | null;
  /** Override the mutation list (used by tests and the archive tools). */
  mutations?: MutationId[];
  maxAttempts?: number;
  stateBudget?: number;
};

export type GenerateReport = { puzzle: Puzzle; relevant: boolean; hard: boolean; gap: number; fallback: boolean; attempts: number; statesUsed: number };

export function generatePuzzle(dateKey: string, opts: GenerateOptions = {}): Puzzle {
  return generateWithReport(dateKey, opts).puzzle;
}

export function generateWithReport(dateKey: string, opts: GenerateOptions = {}): GenerateReport {
  const plan = dayPlan(dateKey);
  let mutations: MutationId[];
  let communityPick: MutationId | null = null;
  if (opts.mutations) {
    mutations = [...opts.mutations];
  } else {
    const m = mutationsFor(plan, opts.pick ?? null);
    mutations = m.mutations;
    communityPick = m.communityPick;
  }
  // A catalyst needs something to act on.
  if (mutations.includes('PAYLOAD_MASS') && !mutations.some((m) => MUTATIONS.PAYLOAD_MASS.hosts?.includes(m))) {
    const hosts: MutationId[] = MUTATIONS.PAYLOAD_MASS.hosts ?? ['GRAVITY'];
    const host = new SeededRng(`${dateKey}:host`).pick(hosts);
    mutations.push(host);
  }
  mutations = mutations.filter((m) => ALL_MUTATIONS.includes(m));
  // Orbiting and skittish cells cannot both drive the cells.
  if (mutations.includes('ORBITAL_CELLS') && mutations.includes('SKITTISH_CELLS')) {
    mutations = mutations.filter((m) => m !== 'SKITTISH_CELLS');
  }

  const seed = `${dateKey}:v${RULES_VERSION}:${mutations.join('+')}`;
  const maxAttempts = opts.maxAttempts ?? 120;
  // A fixed state budget (not a clock) keeps generation deterministic.
  const budget: Budget = { left: opts.stateBudget ?? 2_000_000 };
  const startBudget = budget.left;
  let best: Scored | null = null;
  const found: Scored[] = [];
  let acceptedCount = 0;
  let attempt = 0;
  for (; attempt < maxAttempts && budget.left > 0; attempt++) {
    const board = buildBoard(dateKey, plan, mutations, communityPick, seed, attempt);
    if (!board) continue;
    if (mutations.includes('DECAY') && !placeCracks(board, plan.tier, new SeededRng(`${seed}:cracks:${attempt}`), budget)) continue;
    let scored = evaluate(board, plan.tier, budget, best);
    for (let round = 0; round < 3 && scored && scored.decayFlat && budget.left > 0; round++) {
      if (!deepenCracks(board)) break;
      scored = evaluate(board, plan.tier, budget, best);
    }
    if (!scored) continue;
    if (!best || scored.score > best.score) best = scored;
    if (scored.inRange) found.push(scored);
    if (scored.relevant && scored.hard && scored.inRange) {
      acceptedCount++;
      // Prefer the better of two good boards, but settle for one when the
      // search is getting expensive.
      if (acceptedCount >= 2 || budget.left < startBudget * 0.5) break;
    }
    // Keep some budget back for climbing.
    if (budget.left < startBudget * 0.45) break;
  }
  if (best && !(best.relevant && best.hard && best.inRange)) {
    // Climb from the three most promising boards, sharing what's left.
    const [lo, hi] = parRange(plan.tier, mutations);
    const target = (lo + hi) / 2;
    const starts = found
      .slice()
      .sort((a, b) => compareKeys(climbKey(b, plan.tier, target), climbKey(a, plan.tier, target)))
      .slice(0, 3);
    if (starts.length === 0) starts.push(best);
    const rng = new SeededRng(`${seed}:climb`);
    for (let k = 0; k < starts.length && budget.left > 0; k++) {
      const share: Budget = { left: Math.floor(budget.left / (starts.length - k)) };
      const before = share.left;
      const top = climb(starts[k] as Scored, plan.tier, mutations, share, rng, 60);
      budget.left -= before - share.left;
      if (top.score > best.score) best = top;
      if (best.relevant && best.hard && best.inRange) break;
    }
  }
  const used = startBudget - budget.left;
  if (best && best.puzzle.par >= 4) {
    return { puzzle: best.puzzle, relevant: best.relevant, hard: best.hard, gap: best.gap, fallback: false, attempts: attempt, statesUsed: used };
  }

  const fb = fallbackPuzzle(dateKey, plan, mutations, communityPick, seed);
  const res = solve(compileWorld(fb), { maxDepth: 40, maxStates: 120000 });
  fb.par = res.solvable ? res.par : 0;
  fb.solution = res.path.join('');
  return { puzzle: fb, relevant: false, hard: false, gap: 0, fallback: true, attempts: attempt, statesUsed: used };
}

/** Strip the answer before sending a puzzle to someone who has not solved it. */
export function publicPuzzle(p: Puzzle): Puzzle {
  const { solution: _solution, ...rest } = p;
  return rest;
}

export { dayPlan };
