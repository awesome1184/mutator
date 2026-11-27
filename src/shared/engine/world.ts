// Compiles a Puzzle into flat typed-array layers for fast, allocation-light
// simulation. One layer set is pre-computed per turntable phase (0..3).

import { CELLS, DIRS, N, ringOf, rotateDir, stepIdx, toIdx } from './grid.ts';
import type { Dir, MutationId, Puzzle } from './types.ts';

export type Layer = {
  wall: Uint8Array;
  /** -1 none, else index into DIRS. */
  conv: Int8Array;
  ice: Uint8Array;
  /** -1 none, 0 closed on even turns, 1 closed on odd turns. */
  gate: Int8Array;
  door: Uint8Array;
  plate: Uint8Array;
  /** 0 none, ±1 quarter turn. */
  refl: Int8Array;
  /** -1 none, else index into DIRS. */
  oneway: Int8Array;
  /** -1 none, else index into DIRS. */
  vent: Int8Array;
  /** -1 none, else phase layer. */
  phase: Int8Array;
  /** 0 none, ±1 quarter turn. */
  rotor: Int8Array;
  /** 1 when the tile can never crumble / be blighted. */
  special: Uint8Array;
};

export type World = {
  puzzle: Puzzle;
  has: Record<MutationId, boolean>;
  layers: Layer[];
  start: number;
  exit: number;
  /** For each cell, its position per orbit step (length 1 when static). */
  cellPaths: number[][];
  /** Tiles a cell can ever occupy (never crumble / blight). */
  cellTiles: Uint8Array;
  /** Cracked floor that crumbles under Decay. */
  fragile: Uint8Array;
  /** portalAt[i] = label 0..3 or -1. */
  portalAt: Int8Array;
  portalPos: number[];
  magnets: number[];
  hubs: number[];
  tether: number;
  droneStart: number;
  echoStart: number;
  crateStart: number[];
  blightStart: number[];
  blightOrder: Dir[];
  /** Whether the state key must include the turn number. */
  timed: boolean;
};

function emptyLayer(): Layer {
  return {
    wall: new Uint8Array(CELLS),
    conv: new Int8Array(CELLS).fill(-1),
    ice: new Uint8Array(CELLS),
    gate: new Int8Array(CELLS).fill(-1),
    door: new Uint8Array(CELLS),
    plate: new Uint8Array(CELLS),
    refl: new Int8Array(CELLS),
    oneway: new Int8Array(CELLS).fill(-1),
    vent: new Int8Array(CELLS).fill(-1),
    phase: new Int8Array(CELLS).fill(-1),
    rotor: new Int8Array(CELLS),
    special: new Uint8Array(CELLS)
  };
}

function cloneLayer(l: Layer): Layer {
  return {
    wall: l.wall.slice(),
    conv: l.conv.slice(),
    ice: l.ice.slice(),
    gate: l.gate.slice(),
    door: l.door.slice(),
    plate: l.plate.slice(),
    refl: l.refl.slice(),
    oneway: l.oneway.slice(),
    vent: l.vent.slice(),
    phase: l.phase.slice(),
    rotor: l.rotor.slice(),
    special: l.special.slice()
  };
}

const dirIndex = (d: Dir): number => DIRS.indexOf(d);

/** Rotate a ring of slots one step clockwise (N→E→S→W→N). */
function spinLayer(l: Layer, hub: number): void {
  const ring = ringOf(hub);
  const rotateDirVal = (v: number): number => (v < 0 ? v : (v + 1) % 4);
  const moveArr = (arr: Uint8Array | Int8Array, transform?: (v: number) => number): void => {
    const vals = ring.map((p) => arr[p] as number);
    for (let k = 0; k < 4; k++) {
      const src = vals[(k + 3) % 4] as number;
      arr[ring[k] as number] = transform ? transform(src) : src;
    }
  };
  moveArr(l.wall);
  moveArr(l.conv, rotateDirVal);
  moveArr(l.ice);
  moveArr(l.gate);
  moveArr(l.door);
  moveArr(l.plate);
  moveArr(l.refl);
  moveArr(l.oneway, rotateDirVal);
  moveArr(l.vent, rotateDirVal);
  moveArr(l.phase);
  moveArr(l.rotor);
  moveArr(l.special);
}

export function compileWorld(puzzle: Puzzle): World {
  const has = {} as Record<MutationId, boolean>;
  for (const m of puzzle.mutations) has[m] = true;
  const on = (m: MutationId): boolean => has[m] === true;

  const base = emptyLayer();
  for (let r = 0; r < N; r++) {
    const row = puzzle.grid[r] ?? '';
    for (let c = 0; c < N; c++) {
      if (row[c] === '#') base.wall[r * N + c] = 1;
    }
  }
  if (on('CONVEYOR')) for (const t of puzzle.conveyors) base.conv[toIdx(t)] = dirIndex(t.dir);
  if (on('CRYO_SLICK')) for (const t of puzzle.ice) base.ice[toIdx(t)] = 1;
  if (on('PHASE_GATES')) for (const t of puzzle.gates) base.gate[toIdx(t)] = t.polarity;
  if (on('BLAST_DOORS')) {
    for (const t of puzzle.doors) base.door[toIdx(t)] = 1;
    for (const t of puzzle.plates) base.plate[toIdx(t)] = 1;
  }
  if (on('REFLECTORS')) for (const t of puzzle.reflectors) base.refl[toIdx(t)] = t.rot;
  if (on('ONE_WAY_GATES')) for (const t of puzzle.oneWays) base.oneway[toIdx(t)] = dirIndex(t.dir);
  if (on('VENTILATION')) for (const t of puzzle.vents) base.vent[toIdx(t)] = dirIndex(t.dir);
  if (on('PHASE_LAYERS')) for (const t of puzzle.phaseTiles) base.phase[toIdx(t)] = t.layer;
  if (on('ROTORS')) for (const t of puzzle.rotors) base.rotor[toIdx(t)] = t.rot;

  // Feature tiles never crumble and are never blighted.
  for (let i = 0; i < CELLS; i++) {
    if (
      base.wall[i] ||
      base.conv[i]! >= 0 ||
      base.ice[i] ||
      base.gate[i]! >= 0 ||
      base.door[i] ||
      base.plate[i] ||
      base.refl[i] ||
      base.oneway[i]! >= 0 ||
      base.vent[i]! >= 0 ||
      base.phase[i]! >= 0 ||
      base.rotor[i]
    ) {
      base.special[i] = 1;
    }
  }

  const hubs = on('TURNTABLES') ? puzzle.turntables.map(toIdx) : [];
  const layers: Layer[] = [base];
  if (hubs.length > 0) {
    for (let phase = 1; phase < 4; phase++) {
      const next = cloneLayer(layers[phase - 1] as Layer);
      for (const hub of hubs) spinLayer(next, hub);
      layers.push(next);
    }
  }

  const cellPaths: number[][] = puzzle.cells.map((cell, i) => {
    const orbit = on('ORBITAL_CELLS') ? puzzle.orbits[i] : undefined;
    if (orbit && orbit.length >= 2) return orbit.map(toIdx);
    return [toIdx(cell)];
  });
  const cellTiles = new Uint8Array(CELLS);
  for (const path of cellPaths) for (const p of path) cellTiles[p] = 1;

  const fragile = new Uint8Array(CELLS);
  if (on('DECAY')) {
    for (const t of puzzle.cracked ?? []) {
      const i = toIdx(t);
      if (!base.special[i] && !cellTiles[i] && i !== toIdx(puzzle.start) && i !== toIdx(puzzle.exit)) fragile[i] = 1;
    }
  }

  const portalAt = new Int8Array(CELLS).fill(-1);
  const portalPos = [-1, -1, -1, -1];
  if (on('PORTALS')) {
    for (const p of puzzle.portals) {
      portalAt[toIdx(p)] = p.label;
      portalPos[p.label] = toIdx(p);
    }
  }

  const timed = puzzle.mutations.some((m) =>
    [
      'GRAVITY',
      'INFECTION',
      'PORTALS',
      'PHASE_GATES',
      'OVERCLOCK',
      'PHASE_SHIFT',
      'TURNTABLES',
      'ORBITAL_CELLS',
      'PULSE_BEAM',
      'VENTILATION',
      'FLOOD',
      'PHASE_LAYERS'
    ].includes(m)
  );

  return {
    puzzle,
    has,
    layers,
    start: toIdx(puzzle.start),
    exit: toIdx(puzzle.exit),
    cellPaths,
    cellTiles,
    fragile,
    portalAt,
    portalPos,
    magnets: on('MAGNETISM') ? puzzle.magnets.map(toIdx) : [],
    hubs,
    tether: on('TETHER_PYLON') && puzzle.tether ? toIdx(puzzle.tether) : -1,
    droneStart: on('MIRROR_DRONE') && puzzle.droneStart ? toIdx(puzzle.droneStart) : -1,
    crateStart: on('CRATES') ? (puzzle.crates ?? []).map(toIdx).sort((a, b) => a - b) : [],
    echoStart: on('ECHO') && puzzle.echoStart ? toIdx(puzzle.echoStart) : -1,
    blightStart: on('INFECTION') ? puzzle.blight.map(toIdx) : [],
    blightOrder: puzzle.blightOrder.length === 4 ? puzzle.blightOrder : ['U', 'R', 'D', 'L'],
    timed
  };
}

// ---------------------------------------------------------------------------
// Turn-indexed schedules (pure functions of the completed-turn counter).
// ---------------------------------------------------------------------------

export function layerFor(w: World, turn: number): Layer {
  if (w.layers.length === 1) return w.layers[0] as Layer;
  return w.layers[Math.floor(turn / 3) % 4] as Layer;
}

const GRAVITY_CYCLE: readonly Dir[] = ['D', 'L', 'U', 'R'];

export function gravityDir(turn: number): Dir {
  return GRAVITY_CYCLE[Math.floor(turn / 3) % 4] as Dir;
}

export function isOverclock(turn: number): boolean {
  return turn % 3 === 2;
}

export function isPhaseShift(turn: number): boolean {
  return turn % 4 === 3;
}

/** Gate polarity that is CLOSED on this turn. */
export function closedPolarity(turn: number): 0 | 1 {
  return turn % 2 === 0 ? 0 : 1;
}

export function portalMode(turn: number): 0 | 1 {
  return (Math.floor(turn / 3) % 2) as 0 | 1;
}

/** Label of the pad paired with `label` under `mode`. */
export function portalPartner(label: number, mode: 0 | 1): number {
  if (mode === 0) return label ^ 1; // A↔B, C↔D
  return label === 0 ? 2 : label === 2 ? 0 : label === 1 ? 3 : 1; // A↔C, B↔D
}

export function activePhaseLayer(turn: number): 0 | 1 {
  return (Math.floor(turn / 2) % 2) as 0 | 1;
}

export function ventsActive(turn: number): boolean {
  return turn % 2 === 0;
}

export type BeamLine = { axis: 'row' | 'col'; index: number; live: boolean };

export function beamLine(w: World, turn: number): BeamLine | null {
  const b = w.puzzle.beam;
  if (!w.has.PULSE_BEAM || !b) return null;
  const k = Math.floor(turn / 2);
  const index = (((b.start + b.step * k) % N) + N) % N;
  return { axis: b.axis, index, live: turn % 2 === 0 };
}

export function floodDepth(w: World, turn: number): number {
  if (!w.has.FLOOD || !w.puzzle.flood) return 0;
  return Math.min(2, Math.floor(turn / 3));
}

export function isFloodedAt(w: World, turn: number, i: number, depth = floodDepth(w, turn)): boolean {
  if (depth <= 0 || !w.puzzle.flood) return false;
  const r = Math.floor(i / N);
  const c = i % N;
  switch (w.puzzle.flood.edge) {
    case 'U':
      return r < depth;
    case 'D':
      return r >= N - depth;
    case 'L':
      return c < depth;
    default:
      return c >= N - depth;
  }
}

export function cellPosAt(w: World, index: number, turn: number): number {
  const path = w.cellPaths[index] as number[];
  return path[turn % path.length] as number;
}

export function turnsUntil(turn: number, period: number, offset: number): number {
  // Smallest k >= 0 with (turn + k) % period === offset
  return (((offset - turn) % period) + period) % period;
}

export { rotateDir, stepIdx };
