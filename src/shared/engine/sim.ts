// The authoritative turn resolver. Pure and deterministic: no randomness, no
// clocks, no globals. The server replays submitted routes with this exact code.
//
// Turn order
//   1. Your move (Overclock / Inertia: up to 2 tiles, Phase Shift: through a wall)
//   2. Echo repeats your previous action, Mirror Drone mirrors this one
//   3. Tile effects chain: Portal → Belt → Vent → Prism → Rotor → Ice
//   4. Charged Cells, then Magnets (each followed by tile effects)
//   5. Gravity (followed by tile effects)
//   6. Tether snap-back
//   7. World: orbits, afterimage, decay, blight, turntables
//   8. Win check: both cells collected and standing on the exit

import { CELLS, chebyshev, colOf, delta, DIRS, manhattan, opposite, rotateDir, rowOf, spinAround, stepIdx, wrapIdx } from './grid.ts';
import type { Action, Dir, GameState, StepEvent, StepResult } from './types.ts';
import {
  activePhaseLayer,
  beamLine,
  cellPosAt,
  closedPolarity,
  floodDepth,
  gravityDir,
  isFloodedAt,
  isOverclock,
  isPhaseShift,
  layerFor,
  portalMode,
  portalPartner,
  ventsActive,
  type BeamLine,
  type Layer,
  type World
} from './world.ts';

const EMPTY_I8 = new Int8Array(CELLS).fill(-1);
const EMPTY_U8 = new Uint8Array(CELLS);
// Scratch flags for once-per-turn tile effects. step() is synchronous, so a
// single shared buffer is safe; touched entries are reset after every step.
const USED = new Uint8Array(CELLS);
const TOUCHED: number[] = [];

function markUsed(i: number, bit: number): boolean {
  const v = USED[i] as number;
  if (v & bit) return false;
  if (v === 0) TOUCHED.push(i);
  USED[i] = v | bit;
  return true;
}

function resetUsed(): void {
  for (const i of TOUCHED) USED[i] = 0;
  TOUCHED.length = 0;
}

export type MassTier = 'light' | 'normal' | 'heavy';

export function massTier(w: World, got: number): MassTier {
  if (!w.has.PAYLOAD_MASS) return 'normal';
  const n = (got & 1) + ((got >> 1) & 1);
  return n === 0 ? 'light' : n === 1 ? 'normal' : 'heavy';
}

export function initialState(w: World): GameState {
  let decay = EMPTY_I8;
  let blight = EMPTY_U8;
  if (w.has.DECAY) decay = new Int8Array(CELLS).fill(-1);
  if (w.has.INFECTION) {
    blight = new Uint8Array(CELLS);
    for (const b of w.blightStart) blight[b] = 1;
  }
  return {
    turn: 0,
    pos: w.start,
    drone: w.droneStart,
    echo: w.echoStart,
    last: null,
    inertia: null,
    pendingRot: 0,
    prevPos: w.start,
    after: -1,
    doorsOpen: false,
    got: 0,
    cells: w.cellPaths.map((p) => p[0] as number),
    crates: [...w.crateStart],
    decay,
    blight,
    solved: false
  };
}

type Ctx = {
  w: World;
  L: Layer;
  turn: number;
  pos: number;
  drone: number;
  echo: number;
  after: number;
  doorsOpen: boolean;
  got: number;
  cells: number[];
  crates: number[];
  pendingRot: number;
  decay: Int8Array;
  blight: Uint8Array;
  beam: BeamLine | null;
  flood: number;
  phaseLayer: 0 | 1;
  closedPol: 0 | 1;
  portalUsed: boolean;
  left: number[];
  events: StepEvent[];
};

type Mover = 'courier' | 'drone' | 'echo';

/** Where cell k is now: it orbits by schedule, flees (Skittish) or stays put. */
export function cellAt(w: World, s: { cells: number[]; turn: number }, k: number): number {
  if (w.has.SKITTISH_CELLS) return s.cells[k] as number;
  return cellPosAt(w, k, s.turn);
}

/** Neighbour for anything that moves; wraps around the edges with Wraparound. */
function nb(w: World, i: number, d: Dir): number {
  return w.has.WRAPAROUND ? wrapIdx(i, d) : stepIdx(i, d);
}

/** Whether `i` can be entered by `who` travelling in direction `dir`. */
function blocked(ctx: Ctx, i: number, dir: Dir | null, who: Mover): boolean {
  if (i < 0) return true;
  const L = ctx.L;
  if (L.wall[i]) return true;
  if (who !== 'drone' && ctx.drone === i) return true;
  if (who !== 'echo' && ctx.echo === i) return true;
  if (who !== 'courier' && ctx.pos === i) return true;
  if (ctx.after === i) return true;
  if (ctx.crates.length > 0 && ctx.crates.includes(i)) return true;
  const ow = L.oneway[i] as number;
  if (ow >= 0 && (dir === null || DIRS[ow] !== dir)) return true;
  const b = ctx.beam;
  if (b && b.live && (b.axis === 'row' ? rowOf(i) === b.index : colOf(i) === b.index)) return true;
  if (ctx.flood > 0 && isFloodedAt(ctx.w, ctx.turn, i, ctx.flood)) return true;
  const ph = L.phase[i] as number;
  if (ph >= 0 && ph === ctx.phaseLayer) return true;
  const g = L.gate[i] as number;
  if (g >= 0 && g === ctx.closedPol) return true;
  if (L.door[i] && !ctx.doorsOpen) return true;
  if (ctx.decay[i] === 0) return true;
  if (ctx.blight[i]) return true;
  return false;
}

function collectAt(ctx: Ctx, at: number): void {
  for (let k = 0; k < 2; k++) {
    const bit = 1 << k;
    if (ctx.got & bit) continue;
    if (cellAt(ctx.w, ctx, k) === at) {
      ctx.got |= bit;
      ctx.events.push({ t: 'collect', index: k, at });
    }
  }
}

function pressPlate(ctx: Ctx, at: number): void {
  if (!ctx.w.has.BLAST_DOORS || !ctx.L.plate[at]) return;
  if (ctx.doorsOpen) {
    // Doors never slam shut on something standing in a doorway.
    const L = ctx.L;
    if (L.door[ctx.pos] || (ctx.drone >= 0 && L.door[ctx.drone]) || (ctx.echo >= 0 && L.door[ctx.echo])) return;
    if (ctx.crates.some((c) => L.door[c])) return;
  }
  ctx.doorsOpen = !ctx.doorsOpen;
  ctx.events.push({ t: 'doors', open: ctx.doorsOpen, at });
}

/** Moves the courier into `to`, recording the event and applying arrival effects. */
function courierEnter(ctx: Ctx, to: number, ev: StepEvent): void {
  ctx.left.push(ctx.pos);
  ctx.events.push(ev);
  if (ctx.w.has.WRAPAROUND && ev.t !== 'portal' && manhattan(ctx.pos, to) > 2) ctx.events.push({ t: 'wrap', from: ctx.pos, to });
  ctx.pos = to;
  collectAt(ctx, to);
  pressPlate(ctx, to);
}

/** Crates move onto plain ground, plates, ice or cracked floor; never onto objectives. */
function pushCrate(ctx: Ctx, at: number, d: Dir): boolean {
  const w = ctx.w;
  const L = ctx.L;
  const to = nb(w, at, d);
  if (to < 0 || ctx.crates.includes(to)) return false;
  if (to === w.exit || ctx.cells.includes(to) || to === ctx.pos) return false;
  if ((w.portalAt[to] as number) >= 0 || (L.conv[to] as number) >= 0 || (L.vent[to] as number) >= 0) return false;
  if (L.refl[to] || L.rotor[to] || (L.oneway[to] as number) >= 0) return false;
  if (!w.has.SKITTISH_CELLS && w.has.ORBITAL_CELLS && w.cellTiles[to]) return false;
  // Temporarily lift the crate so it does not block itself.
  ctx.crates = ctx.crates.filter((c) => c !== at);
  if (blocked(ctx, to, d, 'echo') || to === ctx.echo) {
    ctx.crates = [...ctx.crates, at].sort((a, b) => a - b);
    return false;
  }
  ctx.crates = [...ctx.crates, to].sort((a, b) => a - b);
  ctx.events.push({ t: 'crate', from: at, to });
  pressPlate(ctx, to);
  return true;
}

function resolveTileEffects(ctx: Ctx, travelIn: Dir | null): void {
  const w = ctx.w;
  const L = ctx.L;
  let travel = travelIn;
  for (let iter = 0; iter < 24; iter++) {
    let moved = false;
    const here = ctx.pos;

    if (w.has.PORTALS && !ctx.portalUsed) {
      const label = w.portalAt[here] as number;
      if (label >= 0) {
        const dest = w.portalPos[portalPartner(label, portalMode(ctx.turn))] as number;
        if (dest >= 0 && !blocked(ctx, dest, travel, 'courier')) {
          ctx.portalUsed = true;
          courierEnter(ctx, dest, { t: 'portal', from: here, to: dest });
          moved = true;
        }
      }
    }

    if (w.has.CONVEYOR) {
      const p = ctx.pos;
      const cv = L.conv[p] as number;
      if (cv >= 0 && markUsed(p, 1)) {
        const tier = massTier(w, ctx.got);
        const pushes = tier === 'light' ? 2 : tier === 'heavy' ? 0 : 1;
        const d = DIRS[cv] as Dir;
        for (let k = 0; k < pushes; k++) {
          const nxt = nb(w, ctx.pos, d);
          if (blocked(ctx, nxt, d, 'courier')) break;
          courierEnter(ctx, nxt, { t: 'conveyor', from: ctx.pos, to: nxt });
          travel = d;
          moved = true;
          if ((L.conv[ctx.pos] as number) >= 0) break;
          if (w.has.PORTALS && !ctx.portalUsed && (w.portalAt[ctx.pos] as number) >= 0) break;
        }
      }
    }

    if (w.has.VENTILATION && !moved && ventsActive(ctx.turn)) {
      const p = ctx.pos;
      const v = L.vent[p] as number;
      if (v >= 0 && markUsed(p, 2)) {
        const d = DIRS[v] as Dir;
        const nxt = nb(w, p, d);
        if (!blocked(ctx, nxt, d, 'courier')) {
          courierEnter(ctx, nxt, { t: 'vent', from: p, to: nxt });
          travel = d;
          moved = true;
        }
      }
    }

    if (w.has.REFLECTORS && !moved && travel) {
      const p = ctx.pos;
      const rf = L.refl[p] as number;
      if (rf !== 0 && markUsed(p, 4)) {
        const d = rotateDir(travel, rf);
        const nxt = nb(w, p, d);
        if (!blocked(ctx, nxt, d, 'courier')) {
          courierEnter(ctx, nxt, { t: 'reflect', from: p, to: nxt });
          travel = d;
          moved = true;
        }
      }
    }

    if (w.has.ROTORS && !moved) {
      const p = ctx.pos;
      const rt = L.rotor[p] as number;
      if (rt !== 0 && markUsed(p, 8)) {
        ctx.pendingRot = rt;
        ctx.events.push({ t: 'rotor', at: p, rot: rt });
      }
    }

    if (w.has.CRYO_SLICK && !moved && travel && L.ice[ctx.pos]) {
      const p = ctx.pos;
      const nxt = nb(w, p, travel);
      if (!blocked(ctx, nxt, travel, 'courier')) {
        courierEnter(ctx, nxt, { t: 'slide', from: p, to: nxt });
        moved = true;
      }
    }

    if (!moved) break;
  }
}

function chargedCells(ctx: Ctx): Dir | null {
  const w = ctx.w;
  const wrap = w.has.WRAPAROUND === true;
  let movedDir: Dir | null = null;
  if (!(ctx.got & 1)) {
    const c0 = cellAt(w, ctx, 0);
    const { dr, dc } = delta(c0, ctx.pos, wrap);
    if (Math.abs(dr) + Math.abs(dc) === 1) {
      const away: Dir = dr === -1 ? 'U' : dr === 1 ? 'D' : dc === -1 ? 'L' : 'R';
      const tgt = nb(w, ctx.pos, away);
      if (!blocked(ctx, tgt, away, 'courier')) {
        courierEnter(ctx, tgt, { t: 'repel', from: ctx.pos, to: tgt });
        movedDir = away;
      }
    }
  }
  if (!(ctx.got & 2)) {
    const c1 = cellAt(w, ctx, 1);
    const p = ctx.pos;
    const { dr, dc } = delta(p, c1, wrap);
    let pull: Dir | null = null;
    if (dr === 0 && dc !== 0 && Math.abs(dc) <= 2) pull = dc > 0 ? 'R' : 'L';
    else if (dc === 0 && dr !== 0 && Math.abs(dr) <= 2) pull = dr > 0 ? 'D' : 'U';
    if (pull) {
      const tgt = nb(w, p, pull);
      if (!blocked(ctx, tgt, pull, 'courier')) {
        courierEnter(ctx, tgt, { t: 'attract', from: p, to: tgt });
        movedDir = pull;
      }
    }
  }
  return movedDir;
}

function magnetPull(ctx: Ctx): Dir | null {
  const p = ctx.pos;
  for (const mag of ctx.w.magnets) {
    let d: Dir | null = null;
    if (rowOf(p) === rowOf(mag) && p !== mag) d = colOf(mag) > colOf(p) ? 'R' : 'L';
    else if (colOf(p) === colOf(mag) && p !== mag) d = rowOf(mag) > rowOf(p) ? 'D' : 'U';
    if (!d) continue;
    let clear = true;
    for (let t = stepIdx(p, d); t >= 0 && t !== mag; t = stepIdx(t, d)) {
      if (blocked(ctx, t, d, 'courier')) {
        clear = false;
        break;
      }
    }
    if (!clear) continue;
    const nxt = stepIdx(p, d);
    if (nxt === mag || blocked(ctx, nxt, d, 'courier')) continue;
    courierEnter(ctx, nxt, { t: 'magnet', from: p, to: nxt });
    return d;
  }
  return null;
}

export function step(w: World, s: GameState, action: Action): StepResult {
  try {
    return stepInner(w, s, action);
  } finally {
    resetUsed();
  }
}

function stepInner(w: World, s: GameState, action: Action): StepResult {
  if (s.solved) return { ok: false, reason: 'Already solved' };
  const turn = s.turn;
  const L = layerFor(w, turn);
  const hold = action === 'W';
  const moveDir: Dir | null = hold ? null : s.pendingRot ? rotateDir(action as Dir, s.pendingRot) : (action as Dir);

  const ctx: Ctx = {
    w,
    L,
    turn,
    pos: s.pos,
    drone: s.drone,
    echo: s.echo,
    after: s.after,
    doorsOpen: s.doorsOpen,
    got: s.got,
    cells: [...s.cells],
    crates: [...s.crates],
    pendingRot: hold ? s.pendingRot : 0,
    decay: w.has.DECAY ? s.decay.slice() : s.decay,
    blight: w.has.INFECTION ? s.blight.slice() : s.blight,
    beam: beamLine(w, turn),
    flood: floodDepth(w, turn),
    phaseLayer: activePhaseLayer(turn),
    closedPol: closedPolarity(turn),
    portalUsed: false,
    left: [],
    events: []
  };

  // 1. Voluntary movement.
  if (hold || !moveDir) {
    ctx.events.push({ t: 'hold', at: ctx.pos });
  } else {
    const overclock = w.has.OVERCLOCK === true && isOverclock(turn);
    const inertia = w.has.INERTIA === true && s.inertia === moveDir;
    const phaseNow = w.has.PHASE_SHIFT === true && isPhaseShift(turn);
    const steps = overclock || inertia ? 2 : 1;
    const kind = overclock ? 'overclock' : inertia ? 'inertia' : 'walk';
    let moved = false;
    for (let k = 0; k < steps; k++) {
      const from = ctx.pos;
      const nxt = nb(w, from, moveDir);
      if (nxt < 0) break;
      if (w.tether >= 0 && chebyshev(from, w.tether) <= 2 && chebyshev(nxt, w.tether) > 2) break;
      if (L.wall[nxt] && phaseNow && k === 0) {
        const beyond = nb(w, nxt, moveDir);
        const leash = w.tether >= 0 && beyond >= 0 && chebyshev(from, w.tether) <= 2 && chebyshev(beyond, w.tether) > 2;
        if (beyond >= 0 && !leash && !blocked(ctx, beyond, moveDir, 'courier')) {
          courierEnter(ctx, beyond, { t: 'move', from, to: beyond, kind: 'phase' });
          moved = true;
          break;
        }
      }
      // Crates: walking into one pushes it a tile, if the tile beyond is free.
      if (ctx.crates.includes(nxt) && !pushCrate(ctx, nxt, moveDir)) break;
      if (blocked(ctx, nxt, moveDir, 'courier')) break;
      courierEnter(ctx, nxt, { t: 'move', from, to: nxt, kind: k === 0 && kind === 'inertia' ? 'walk' : kind });
      if ((L.oneway[nxt] as number) >= 0) ctx.events.push({ t: 'oneway', at: nxt });
      moved = true;
    }
    if (!moved) return { ok: false, reason: 'blocked' };
  }

  // 2. Echo (repeats the previous action) and Mirror Drone (mirrors this one).
  if (w.has.ECHO && ctx.echo >= 0 && s.last && s.last !== 'W') {
    const d = s.last as Dir;
    const tgt = nb(w, ctx.echo, d);
    if (!blocked(ctx, tgt, d, 'echo')) {
      ctx.events.push({ t: 'echo', from: ctx.echo, to: tgt });
      ctx.echo = tgt;
      pressPlate(ctx, tgt);
    }
  }
  if (w.has.MIRROR_DRONE && ctx.drone >= 0 && moveDir) {
    const d = opposite(moveDir);
    const tgt = nb(w, ctx.drone, d);
    if (!blocked(ctx, tgt, d, 'drone')) {
      ctx.events.push({ t: 'drone', from: ctx.drone, to: tgt });
      ctx.drone = tgt;
      pressPlate(ctx, tgt);
    }
  }

  // 3. Tile effects on the tile you walked into.
  if (moveDir) resolveTileEffects(ctx, moveDir);

  // 4. Charged cells, then magnets.
  if (w.has.MAGNETIC_CELLS) {
    const d = chargedCells(ctx);
    if (d) resolveTileEffects(ctx, d);
  }
  if (w.has.MAGNETISM && massTier(w, ctx.got) !== 'heavy') {
    const d = magnetPull(ctx);
    if (d) resolveTileEffects(ctx, d);
  }

  // 5. Gravity.
  if (w.has.GRAVITY) {
    const tier = massTier(w, ctx.got);
    const falls = tier === 'light' ? 2 : tier === 'heavy' ? 0 : 1;
    const gd = gravityDir(turn);
    for (let k = 0; k < falls; k++) {
      const tgt = nb(w, ctx.pos, gd);
      if (blocked(ctx, tgt, gd, 'courier')) break;
      courierEnter(ctx, tgt, { t: 'gravity', from: ctx.pos, to: tgt });
      resolveTileEffects(ctx, gd);
    }
  }

  // 6. Tether snap-back.
  if (w.tether >= 0 && chebyshev(ctx.pos, w.tether) > 2) {
    const dr = rowOf(w.tether) - rowOf(ctx.pos);
    const dc = colOf(w.tether) - colOf(ctx.pos);
    const d: Dir = Math.abs(dr) >= Math.abs(dc) ? (dr > 0 ? 'D' : 'U') : dc > 0 ? 'R' : 'L';
    const tgt = stepIdx(ctx.pos, d);
    if (!blocked(ctx, tgt, d, 'courier')) {
      courierEnter(ctx, tgt, { t: 'tether', from: ctx.pos, to: tgt });
    }
  }

  // 7. The world advances.
  const next = turn + 1;
  const pos0 = ctx.pos;

  if (w.has.ORBITAL_CELLS && !w.has.SKITTISH_CELLS) {
    for (let k = 0; k < 2; k++) {
      if (ctx.got & (1 << k)) continue;
      const from = cellPosAt(w, k, turn);
      const to = cellPosAt(w, k, next);
      if (from !== to) ctx.events.push({ t: 'orbit', index: k, from, to });
    }
  }

  if (w.has.SKITTISH_CELLS) fleeCells(ctx, pos0);

  let after = -1;
  if (w.has.AFTERIMAGE && s.prevPos >= 0) {
    const cand = s.prevPos;
    if (cand !== pos0 && cand !== ctx.drone && cand !== ctx.echo && cand !== w.exit) {
      after = cand;
      ctx.events.push({ t: 'after', at: cand });
    }
  }

  if (w.has.DECAY) {
    // Cracked tiles hold for one crossing: they fall in once you are off them.
    for (const l of ctx.left) {
      if (l === pos0 || !canCrumble(w, l)) continue;
      if (ctx.decay[l] === -1) ctx.decay[l] = 1;
    }
    for (let i = 0; i < CELLS; i++) {
      const v = ctx.decay[i] as number;
      if (v <= 0) continue;
      const nv = v - 1;
      if (nv === 0 && (i === pos0 || i === ctx.drone || i === ctx.echo)) {
        ctx.decay[i] = 1;
        continue;
      }
      ctx.decay[i] = nv;
      if (nv === 0) ctx.events.push({ t: 'collapse', at: i });
    }
  }

  if (w.has.INFECTION && next % 2 === 0) {
    const target = blightTarget(w, ctx.L, ctx.blight, ctx.decay, pos0, ctx.drone, ctx.echo, after, ctx.doorsOpen, next, ctx.crates);
    if (target >= 0) {
      ctx.blight[target] = 1;
      ctx.events.push({ t: 'blight', at: target });
    }
  }

  let pos = pos0;
  if (w.hubs.length > 0 && next % 3 === 0) {
    for (const hub of w.hubs) {
      const np = spinAround(hub, pos);
      if (np !== pos) {
        ctx.events.push({ t: 'spinRide', from: pos, to: np });
        pos = np;
      }
      ctx.drone = spinAround(hub, ctx.drone);
      ctx.echo = spinAround(hub, ctx.echo);
      after = spinAround(hub, after);
      if (ctx.crates.length) ctx.crates = ctx.crates.map((c) => spinAround(hub, c)).sort((a, b) => a - b);
      if (w.has.SKITTISH_CELLS) ctx.cells = ctx.cells.map((c) => spinAround(hub, c));
      const ring = [stepIdx(hub, 'U'), stepIdx(hub, 'R'), stepIdx(hub, 'D'), stepIdx(hub, 'L')];
      if (w.has.DECAY) {
        const vals = ring.map((p) => ctx.decay[p] as number);
        ring.forEach((p, k) => (ctx.decay[p] = vals[(k + 3) % 4] as number));
      }
      if (w.has.INFECTION) {
        const vals = ring.map((p) => ctx.blight[p] as number);
        ring.forEach((p, k) => (ctx.blight[p] = vals[(k + 3) % 4] as number));
      }
      ctx.events.push({ t: 'spin', hub });
    }
  }

  // Orbiting cells that swing into you are caught.
  if (w.has.ORBITAL_CELLS && !w.has.SKITTISH_CELLS) {
    for (let k = 0; k < 2; k++) {
      const bit = 1 << k;
      if (!(ctx.got & bit) && cellPosAt(w, k, next) === pos) {
        ctx.got |= bit;
        ctx.events.push({ t: 'collect', index: k, at: pos });
      }
    }
  }

  const solved = ctx.got === 3 && pos === w.exit;
  if (solved) ctx.events.push({ t: 'solved' });

  return {
    ok: true,
    events: ctx.events,
    state: {
      turn: next,
      pos,
      drone: ctx.drone,
      echo: ctx.echo,
      last: hold ? 'W' : moveDir,
      inertia: w.has.INERTIA && moveDir ? moveDir : null,
      pendingRot: ctx.pendingRot,
      prevPos: pos,
      after,
      doorsOpen: ctx.doorsOpen,
      got: ctx.got,
      cells: ctx.cells,
      crates: ctx.crates,
      decay: ctx.decay,
      blight: ctx.blight,
      solved
    }
  };
}

/**
 * Skittish cells: an uncollected cell within 2 tiles of you steps one tile
 * directly away, along the longer axis first, if it has room.
 */
function fleeCells(ctx: Ctx, you: number): void {
  const w = ctx.w;
  const L = ctx.L;
  for (let k = 0; k < 2; k++) {
    if (ctx.got & (1 << k)) continue;
    const c = ctx.cells[k] as number;
    const { dr, dc } = delta(you, c, w.has.WRAPAROUND === true);
    if (Math.abs(dr) + Math.abs(dc) > 2) continue;
    const vert: Dir | null = dr > 0 ? 'D' : dr < 0 ? 'U' : null;
    const horiz: Dir | null = dc > 0 ? 'R' : dc < 0 ? 'L' : null;
    const order = (Math.abs(dr) >= Math.abs(dc) ? [vert, horiz] : [horiz, vert]).filter((d): d is Dir => d !== null);
    for (const d of order) {
      const to = nb(w, c, d);
      if (to < 0 || to === you || to === w.exit || to === ctx.drone || to === ctx.echo) continue;
      if (ctx.cells.includes(to) || ctx.crates.includes(to)) continue;
      if (L.wall[to] || L.special[to] || (w.portalAt[to] as number) >= 0) continue;
      if (ctx.decay[to] === 0 || ctx.blight[to] || ctx.after === to) continue;
      if (ctx.flood > 0 && isFloodedAt(w, ctx.turn, to, ctx.flood)) continue;
      ctx.cells[k] = to;
      ctx.events.push({ t: 'flee', index: k, from: c, to });
      break;
    }
  }
}

/** Cracked floor that crumbles under Decay. */
export function canCrumble(w: World, i: number): boolean {
  return i >= 0 && w.fragile[i] === 1;
}

function canBlight(w: World, L: Layer, i: number): boolean {
  if (i < 0) return false;
  if (L.wall[i] || L.special[i] || w.cellTiles[i]) return false;
  if (i === w.start || i === w.exit) return false;
  if ((w.portalAt[i] as number) >= 0) return false;
  return true;
}

/**
 * The tile blight will claim when it next spreads. Sources are scanned in
 * reading order (top-left first) and each tries the day's spread order.
 */
export function blightTarget(
  w: World,
  L: Layer,
  blight: Uint8Array,
  decay: Int8Array,
  pos: number,
  drone: number,
  echo: number,
  after: number,
  doorsOpen: boolean,
  spreadTurn: number,
  crates: readonly number[] = []
): number {
  const closed = closedPolarity(spreadTurn);
  for (let src = 0; src < CELLS; src++) {
    if (!blight[src]) continue;
    for (const d of w.blightOrder) {
      const cand = stepIdx(src, d);
      if (cand < 0 || blight[cand]) continue;
      if (cand === pos || cand === drone || cand === echo || cand === after || crates.includes(cand)) continue;
      if (decay[cand] === 0) continue;
      const g = L.gate[cand] as number;
      if (w.has.PHASE_GATES && g >= 0 && g === closed) continue;
      if (w.has.BLAST_DOORS && L.door[cand] && !doorsOpen) continue;
      if (!canBlight(w, L, cand)) continue;
      return cand;
    }
  }
  return -1;
}

export type Replay = {
  ok: boolean;
  /** States after each accepted action; states[0] is the initial state. */
  states: GameState[];
  events: StepEvent[][];
  /** Index of the first rejected action, or -1. */
  failedAt: number;
  solved: boolean;
  /** Turn on which the puzzle was solved (moves used), or -1. */
  solvedAt: number;
};

export function replay(w: World, actions: readonly Action[]): Replay {
  const states: GameState[] = [initialState(w)];
  const events: StepEvent[][] = [];
  let solvedAt = -1;
  for (let i = 0; i < actions.length; i++) {
    const cur = states[states.length - 1] as GameState;
    if (cur.solved) return { ok: false, states, events, failedAt: i, solved: true, solvedAt };
    const res = step(w, cur, actions[i] as Action);
    if (!res.ok) return { ok: false, states, events, failedAt: i, solved: false, solvedAt };
    states.push(res.state);
    events.push(res.events);
    if (res.state.solved) solvedAt = res.state.turn;
  }
  const last = states[states.length - 1] as GameState;
  return { ok: true, states, events, failedAt: -1, solved: last.solved, solvedAt };
}

/** Deterministic fingerprint of a state (used by the solver and tests). */
export function stateKey(w: World, s: GameState): string {
  let k =
    (w.timed ? s.turn : 0) +
    ',' + s.pos + ',' + s.got + ',' + s.drone + ',' + s.echo + ',' + (s.last ?? '-') + (s.inertia ?? '-') +
    s.pendingRot + ',' + s.after + (s.doorsOpen ? 'o' : 'c');
  if (w.has.AFTERIMAGE) k += ',' + s.prevPos;
  if (w.has.SKITTISH_CELLS) k += ',c' + s.cells.join('.');
  if (w.has.CRATES) k += ',x' + s.crates.join('.');
  if (w.has.DECAY) {
    k += '|';
    const d = s.decay;
    for (let i = 0; i < CELLS; i++) {
      const v = d[i] as number;
      if (v >= 0) k += String.fromCharCode(48 + i, 48 + v);
    }
  }
  if (w.has.INFECTION) {
    k += '|';
    const b = s.blight;
    for (let i = 0; i < CELLS; i++) if (b[i]) k += String.fromCharCode(48 + i);
  }
  return k;
}
