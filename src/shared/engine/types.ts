// Core domain types for the MUTATOR engine.
// The engine is pure and deterministic: the same puzzle + the same action
// sequence always yields the same states and events, on client and server.

export type Dir = 'U' | 'R' | 'D' | 'L';
export type Action = Dir | 'W';

export type Coord = { r: number; c: number };

export type MutationId =
  | 'GRAVITY'
  | 'DECAY'
  | 'INFECTION'
  | 'CONVEYOR'
  | 'PORTALS'
  | 'PHASE_GATES'
  | 'CRYO_SLICK'
  | 'OVERCLOCK'
  | 'MAGNETISM'
  | 'MIRROR_DRONE'
  | 'PHASE_SHIFT'
  | 'PAYLOAD_MASS'
  | 'AFTERIMAGE'
  | 'MAGNETIC_CELLS'
  | 'TURNTABLES'
  | 'TETHER_PYLON'
  | 'BLAST_DOORS'
  | 'REFLECTORS'
  | 'ECHO'
  | 'ONE_WAY_GATES'
  | 'ORBITAL_CELLS'
  | 'PULSE_BEAM'
  | 'VENTILATION'
  | 'INERTIA'
  | 'FLOOD'
  | 'PHASE_LAYERS'
  | 'ROTORS'
  | 'WRAPAROUND'
  | 'SKITTISH_CELLS'
  | 'CRATES';

export type DirTile = Coord & { dir: Dir };
export type RotTile = Coord & { rot: 1 | -1 };
export type PortalTile = Coord & { label: 0 | 1 | 2 | 3 };
export type GateTile = Coord & { polarity: 0 | 1 };
export type LayerTile = Coord & { layer: 0 | 1 };

export type PulseBeam = { axis: 'row' | 'col'; start: number; step: 1 | -1 };
export type Flood = { edge: Dir };

export type Puzzle = {
  /** Engine rules version used to generate and verify this puzzle. */
  v: number;
  dateKey: string;
  number: number;
  /** 0 = Sunday … 6 = Saturday (UTC). */
  weekday: number;
  tier: TierId;
  mutations: MutationId[];
  /** The mutation that was chosen by the community vote (if any). */
  communityPick: MutationId | null;
  seed: string;
  /** 7 strings of 7 chars: '#' wall, '.' floor. */
  grid: string[];
  start: Coord;
  exit: Coord;
  cells: [Coord, Coord];
  orbits: Coord[][];
  /** Cracked floor (Decay). */
  cracked: Coord[];
  conveyors: DirTile[];
  portals: PortalTile[];
  gates: GateTile[];
  doors: Coord[];
  plates: Coord[];
  ice: Coord[];
  magnets: Coord[];
  turntables: Coord[];
  tether: Coord | null;
  blight: Coord[];
  blightOrder: Dir[];
  reflectors: RotTile[];
  oneWays: DirTile[];
  vents: DirTile[];
  phaseTiles: LayerTile[];
  rotors: RotTile[];
  /** Pushable crates (Crates). Optional for puzzles stored before crates existed. */
  crates?: Coord[];
  droneStart: Coord | null;
  echoStart: Coord | null;
  beam: PulseBeam | null;
  flood: Flood | null;
  /** Fewest moves to solve (computed by exhaustive BFS). */
  par: number;
  /** The par route. Stripped before sending to clients that have not solved. */
  solution?: string;
};

export type TierId = 'warmup' | 'standard' | 'tricky' | 'hard' | 'expert' | 'anomaly';

export type GameState = {
  /** Number of completed turns. Periodic mutations are keyed off this value. */
  turn: number;
  pos: number;
  drone: number;
  echo: number;
  /** The previous action actually taken (after rotor rotation). */
  last: Action | null;
  /** Direction carried by Inertia (null when momentum is reset). */
  inertia: Dir | null;
  /** Rotor queue: rotation applied to the next directional input. */
  pendingRot: number;
  /** Where the courier ended the previous turn (Afterimage source). */
  prevPos: number;
  /** Tile that is currently solid hard-light (Afterimage). */
  after: number;
  doorsOpen: boolean;
  /** Bitmask of collected cells (1 = cell A, 2 = cell B). */
  got: number;
  /** Current cell positions (they only move with Skittish Cells). */
  cells: number[];
  /** Crate positions, sorted (Crates). */
  crates: number[];
  /** -1 untouched, -2 pit filled by a crate, 0 collapsed pit, >0 turns until collapse. */
  decay: Int8Array;
  /** 1 = infected by blight. */
  blight: Uint8Array;
  solved: boolean;
};

export type StepEvent =
  | { t: 'move'; from: number; to: number; kind: 'walk' | 'overclock' | 'inertia' | 'phase' }
  | { t: 'portal'; from: number; to: number }
  | { t: 'conveyor'; from: number; to: number }
  | { t: 'vent'; from: number; to: number }
  | { t: 'reflect'; from: number; to: number }
  | { t: 'slide'; from: number; to: number }
  | { t: 'repel'; from: number; to: number }
  | { t: 'attract'; from: number; to: number }
  | { t: 'magnet'; from: number; to: number }
  | { t: 'gravity'; from: number; to: number }
  | { t: 'tether'; from: number; to: number }
  | { t: 'spinRide'; from: number; to: number }
  | { t: 'hold'; at: number }
  | { t: 'rotor'; at: number; rot: number }
  | { t: 'oneway'; at: number }
  | { t: 'collect'; index: number; at: number }
  | { t: 'doors'; open: boolean; at: number }
  | { t: 'echo'; from: number; to: number }
  | { t: 'drone'; from: number; to: number }
  | { t: 'orbit'; index: number; from: number; to: number }
  | { t: 'flee'; index: number; from: number; to: number }
  | { t: 'crate'; from: number; to: number }
  | { t: 'fill'; at: number }
  | { t: 'wrap'; from: number; to: number }
  | { t: 'after'; at: number }
  | { t: 'collapse'; at: number }
  | { t: 'blight'; at: number }
  | { t: 'spin'; hub: number }
  | { t: 'solved' };

export type StepResult =
  | { ok: true; state: GameState; events: StepEvent[] }
  | { ok: false; reason: string };
