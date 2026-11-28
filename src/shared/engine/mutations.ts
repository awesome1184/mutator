import type { MutationId } from './types.ts';

export type MutationMeta = {
  id: MutationId;
  name: string;
  /** Riso ink used for this mutation's tiles and cards. */
  ink: string;
  /** Whether text on top of the ink should be dark. */
  darkText: boolean;
  /** One-line rule shown on chips and the splash. */
  short: string;
  /** Precise rule text (what the engine actually does). */
  rule: string;
  /** Strategy hint. */
  tip: string;
  /** True when the mutation changes over time (shown in the forecast strip). */
  timed: boolean;
  /** Mutations that need one of these present to matter. */
  hosts?: MutationId[];
  /** Mutations that cannot share a puzzle with this one. */
  clashes?: MutationId[];
  /**
   * Hidden from players. 'mild' mutations are simple obstacles or timers that
   * are dull on their own, so a puzzle never has two of them (and a Monday,
   * which has just one mutation, never uses one).
   */
  pool: 'core' | 'mild';
};

export const ALL_MUTATIONS: readonly MutationId[] = [
  'GRAVITY',
  'DECAY',
  'INFECTION',
  'CONVEYOR',
  'PORTALS',
  'PHASE_GATES',
  'CRYO_SLICK',
  'OVERCLOCK',
  'MAGNETISM',
  'MIRROR_DRONE',
  'PHASE_SHIFT',
  'PAYLOAD_MASS',
  'AFTERIMAGE',
  'MAGNETIC_CELLS',
  'TURNTABLES',
  'TETHER_PYLON',
  'BLAST_DOORS',
  'REFLECTORS',
  'ECHO',
  'ONE_WAY_GATES',
  'ORBITAL_CELLS',
  'PULSE_BEAM',
  'VENTILATION',
  'INERTIA',
  'FLOOD',
  'PHASE_LAYERS',
  'ROTORS',
  'WRAPAROUND',
  'SKITTISH_CELLS',
  'CRATES',
  'SPRINGS',
  'PAINT',
  'KEYS',
  'MUD'
];

export const MUTATIONS: Record<MutationId, MutationMeta> = {
  GRAVITY: {
    id: 'GRAVITY',
    name: 'Gravity',
    ink: '#1F6FD1',
    darkText: false,
    short: 'After every move you fall 1 tile. Gravity swings clockwise every 3 moves.',
    rule: 'At the end of each move you are pulled 1 tile in the gravity direction unless something blocks you. Gravity starts pointing down and swings clockwise (↓ ← ↑ →) after every 3 moves.',
    tip: 'Walls are footholds. Line up a fall to land exactly where you want.',
    pool: 'core',
    timed: true
  },
  DECAY: {
    id: 'DECAY',
    name: 'Decay',
    ink: '#9C5B2E',
    darkText: false,
    short: 'Cracked tiles hold for one crossing, then fall in.',
    rule: 'A cracked tile gives way as soon as you step off it and becomes a permanent pit. Drones and echoes do not crack it, and it will not fall while something stands on it.',
    tip: 'Each cracked tile gets used once. Work out the order before you move.',
    pool: 'mild',
    timed: false
  },
  INFECTION: {
    id: 'INFECTION',
    name: 'Blight',
    ink: '#7B4FB8',
    darkText: false,
    short: 'Every 2 moves blight grows onto 1 tile. The next target is marked.',
    rule: 'After every 2nd move, blight spreads onto one neighbouring plain floor tile. The blight tile nearest the top-left spreads first, trying directions in the day’s spread order. It cannot grow onto you, drones, echoes, hard-light, or closed gates and doors. The next target is outlined on the board.',
    tip: 'Stand on the marked tile to stall it, or race through before the corridor seals.',
    pool: 'mild',
    timed: true
  },
  CONVEYOR: {
    id: 'CONVEYOR',
    name: 'Conveyors',
    ink: '#109B5A',
    darkText: false,
    short: 'Entering a belt pushes you 1 tile along its arrow.',
    rule: 'When you enter a belt you are pushed 1 tile along its arrow, and belts chain into each other. Each belt pushes at most once per move. A blocked belt simply holds you.',
    tip: 'Belts are free movement. A chain can carry you three tiles for one move.',
    pool: 'core',
    timed: false
  },
  PORTALS: {
    id: 'PORTALS',
    name: 'Portals',
    ink: '#14A3C7',
    darkText: true,
    short: 'Pads teleport you to their partner. Pairs swap every 3 moves.',
    rule: 'Entering a pad teleports you to its partner (once per move). Pairs start A↔B and C↔D, then switch to A↔C and B↔D every 3 moves. Pads of the same colour are partners right now.',
    tip: 'Check the forecast. The same pad leads somewhere else three moves from now.',
    pool: 'core',
    timed: true
  },
  PHASE_GATES: {
    id: 'PHASE_GATES',
    name: 'Phase Gates',
    ink: '#E8579B',
    darkText: true,
    short: 'Pink and blue gates take turns being closed.',
    rule: 'Gates alternate every move: pink gates are closed on moves 1, 3, 5…, blue gates on moves 2, 4, 6…. A closed gate cannot be entered. Standing on a gate when it closes is safe.',
    tip: 'Hold for one move and the other colour opens.',
    pool: 'mild',
    timed: true
  },
  CRYO_SLICK: {
    id: 'CRYO_SLICK',
    name: 'Ice',
    ink: '#7FD3EE',
    darkText: true,
    short: 'On ice you keep sliding until something stops you.',
    rule: 'While you are on ice you keep moving in your travel direction, 1 tile at a time, until you hit something or reach non-ice ground.',
    tip: 'Plan where the slide ends, not where it starts.',
    pool: 'core',
    timed: false
  },
  OVERCLOCK: {
    id: 'OVERCLOCK',
    name: 'Overclock',
    ink: '#C2185B',
    darkText: false,
    short: 'Every 3rd move goes 2 tiles.',
    rule: 'On moves 3, 6, 9… your step covers up to 2 tiles (it stops after 1 if the second is blocked). Moves marked ⚡ in the forecast are overclocked.',
    tip: 'Use the surge for long straights. Hold once to line it up.',
    pool: 'mild',
    timed: true
  },
  MAGNETISM: {
    id: 'MAGNETISM',
    name: 'Magnets',
    ink: '#2D3C9E',
    darkText: false,
    short: 'In a clear line of sight to a magnet, you get pulled 1 tile toward it.',
    rule: 'At the end of your move, if you share a row or column with a magnet and nothing stands between you, you are pulled 1 tile toward it.',
    tip: 'Break line of sight with walls, or ride the pull.',
    pool: 'core',
    timed: false
  },
  MIRROR_DRONE: {
    id: 'MIRROR_DRONE',
    name: 'Mirror Drone',
    ink: '#F06EAA',
    darkText: true,
    short: 'A drone copies your moves in reverse. It is solid.',
    rule: 'Every time you move, the drone moves 1 tile in the opposite direction (it holds when you hold). It is a real robot: belts carry it, it slides on ice, and magnets and gravity pull it 1 tile, just like you. It is solid, blocks blight and presses plates.',
    tip: 'Park the drone in a doorway, or use it as a wall to stop a slide.',
    pool: 'core',
    timed: false
  },
  PHASE_SHIFT: {
    id: 'PHASE_SHIFT',
    name: 'Phase Shift',
    ink: '#5FA83A',
    darkText: true,
    short: 'Every 4th move you can step through one wall.',
    rule: 'On moves 4, 8, 12… walking into a single wall (or crate) carries you through it, if the tile behind is open.',
    tip: 'Shortcuts open on a schedule. Count your moves.',
    pool: 'mild',
    timed: true
  },
  PAYLOAD_MASS: {
    id: 'PAYLOAD_MASS',
    name: 'Payload Mass',
    ink: '#8A4F7D',
    darkText: false,
    short: 'Cells you carry change your weight: light, normal, heavy.',
    rule: 'With 0 cells you are light: gravity and belts move you 2 tiles. With 1 cell, 1 tile. With 2 cells you are heavy, and gravity, belts and magnets cannot move you at all.',
    tip: 'Pick up the cells in an order that suits the forces on the map.',
    pool: 'core',
    timed: false,
    hosts: ['GRAVITY', 'CONVEYOR', 'MAGNETISM']
  },
  AFTERIMAGE: {
    id: 'AFTERIMAGE',
    name: 'Afterimage',
    ink: '#6E7FD6',
    darkText: false,
    short: 'The tile you just left goes solid for 1 move. No doubling back.',
    rule: 'At the end of each move, the tile you started that move on becomes solid hard-light for the next move. It stops slides and blocks blight.',
    tip: 'Afterimages make great brakes on ice.',
    pool: 'mild',
    timed: false
  },
  MAGNETIC_CELLS: {
    id: 'MAGNETIC_CELLS',
    name: 'Charged Cells',
    ink: '#FF8A7A',
    darkText: true,
    short: 'Cell A pushes you away when you are next to it. Cell B pulls you in.',
    rule: 'Before they are collected, Cell A (+) pushes you 1 tile away when you end next to it, and Cell B (−) pulls you 1 tile closer from up to 2 tiles away in a straight line.',
    tip: 'Step onto A in one move from 2 tiles out, or brace against a wall.',
    pool: 'core',
    timed: false
  },
  TURNTABLES: {
    id: 'TURNTABLES',
    name: 'Turntables',
    ink: '#C98A12',
    darkText: true,
    short: 'Every 3 moves the 4 tiles around each gear rotate clockwise.',
    rule: 'After every 3rd move, the 4 tiles touching each gear rotate 90° clockwise, along with anything standing on them. Arrows on those tiles rotate too.',
    tip: 'Ride a turntable to get around a wall.',
    pool: 'core',
    timed: true
  },
  TETHER_PYLON: {
    id: 'TETHER_PYLON',
    name: 'Tether',
    ink: '#D2147C',
    darkText: false,
    short: 'You cannot walk out of the 5×5 zone. Forced moves can fling you out, then you snap back.',
    rule: 'You cannot walk out of the dashed 5×5 zone around the pylon. If a force pushes you outside, you snap 1 tile back toward the pylon at the end of the move.',
    tip: 'Belts and portals can carry you out to reach far tiles.',
    pool: 'mild',
    timed: false
  },
  BLAST_DOORS: {
    id: 'BLAST_DOORS',
    name: 'Blast Doors',
    ink: '#56663F',
    darkText: false,
    short: 'Entering a plate toggles every door open or closed.',
    rule: 'Doors start closed. Every time anything enters a pressure plate, all doors toggle. Doors will not close on something standing in them.',
    tip: 'Count your plate presses. Even numbers mean the doors are shut again.',
    pool: 'mild',
    timed: false
  },
  REFLECTORS: {
    id: 'REFLECTORS',
    name: 'Prisms',
    ink: '#B48BEA',
    darkText: true,
    short: 'Entering a prism turns you 90° and carries you 1 tile.',
    rule: 'Entering a prism turns your travel direction 90° (the arrow shows which way) and moves you 1 tile in the new direction. Each prism works once per move.',
    tip: 'Prisms combine with ice for sharp turns.',
    pool: 'core',
    timed: false
  },
  ECHO: {
    id: 'ECHO',
    name: 'Echo',
    ink: '#7E8BA3',
    darkText: false,
    short: 'A ghost repeats your previous move, one move late. It is solid.',
    rule: 'The echo repeats your previous move one move later (it holds when you held). It is solid, can press plates, and cannot collect cells.',
    tip: 'Your echo is a delayed key. Walk the route you want it to take.',
    pool: 'core',
    timed: false
  },
  ONE_WAY_GATES: {
    id: 'ONE_WAY_GATES',
    name: 'One-Way',
    ink: '#00897B',
    darkText: false,
    short: 'Arrow gates can only be entered moving with the arrow.',
    rule: 'You can enter an arrow gate only while moving in the arrow’s direction. This applies to forced movement too. Leaving is always allowed.',
    tip: 'Forced moves still count. A belt can push you through.',
    pool: 'mild',
    timed: false
  },
  ORBITAL_CELLS: {
    id: 'ORBITAL_CELLS',
    name: 'Orbiting Cells',
    ink: '#E6B800',
    darkText: true,
    clashes: ['SKITTISH_CELLS'],
    short: 'Cells you have not collected circle a 2×2 loop after every move.',
    rule: 'After every move, each uncollected cell steps clockwise around its 4-tile loop. A dashed outline shows where it goes next. If it swings into you, you catch it.',
    tip: 'Do not chase the cell. Go to where it will be.',
    pool: 'core',
    timed: true
  },
  PULSE_BEAM: {
    id: 'PULSE_BEAM',
    name: 'Pulse Beam',
    ink: '#FF2E88',
    darkText: true,
    short: 'A beam sweeps across the grid and blocks its line every other move.',
    rule: 'The beam is live on moves 1, 3, 5… and blocks entry into its row or column. After every 2 moves it advances one line.',
    tip: 'Cross the beam’s line on its off moves.',
    pool: 'mild',
    timed: true
  },
  VENTILATION: {
    id: 'VENTILATION',
    name: 'Vents',
    ink: '#4DB6AC',
    darkText: true,
    short: 'On odd moves, entering a vent blows you 1 tile along its arrow.',
    rule: 'Vents blow on moves 1, 3, 5…: entering a live vent pushes you 1 tile along its arrow. On moves 2, 4, 6… they are plain floor.',
    tip: 'Hold once to change whether a vent fires.',
    pool: 'core',
    timed: true
  },
  INERTIA: {
    id: 'INERTIA',
    name: 'Inertia',
    ink: '#F29F05',
    darkText: true,
    short: 'Repeat your last direction and you move 2 tiles.',
    rule: 'Moving in the same direction as your previous move carries you up to 2 tiles. Changing direction or holding resets your momentum.',
    tip: 'Zig-zag to take single steps.',
    pool: 'core',
    timed: false
  },
  FLOOD: {
    id: 'FLOOD',
    name: 'Flood',
    ink: '#2E86DE',
    darkText: false,
    short: 'Water rises from one edge every 3 moves, up to 2 lines deep.',
    rule: 'After moves 3 and 6, water covers one more line from its edge (2 lines at most). Flooded tiles cannot be entered, and blight cannot grow into water. The next line to flood is marked.',
    tip: 'Clear the low ground before the second wave.',
    pool: 'mild',
    timed: true
  },
  PHASE_LAYERS: {
    id: 'PHASE_LAYERS',
    name: 'Phase Layers',
    ink: '#6C4AB6',
    darkText: false,
    short: 'Two sets of blocks take turns being solid, 2 moves each.',
    rule: 'Layer-1 blocks are solid on moves 1–2, 5–6, 9–10…; layer-2 blocks on moves 3–4, 7–8… Solid blocks cannot be entered.',
    tip: 'Each layer is open every other pair of moves. Time your entrance.',
    pool: 'mild',
    timed: true
  },
  ROTORS: {
    id: 'ROTORS',
    name: 'Rotors',
    ink: '#00B3A4',
    darkText: true,
    short: 'Stepping on a rotor twists your next input by 90°.',
    rule: 'Entering a rotor queues a 90° twist (clockwise or anticlockwise) for your next directional input. While it is queued, the pad arrows show where each press will really take you.',
    tip: 'Press the direction that will rotate into the one you want.',
    pool: 'core',
    timed: false
  },
  WRAPAROUND: {
    id: 'WRAPAROUND',
    name: 'Wraparound',
    ink: '#3FA34D',
    darkText: false,
    short: 'Walk off one edge and you come back in on the opposite edge.',
    rule: 'The board wraps: anything that moves off an edge (you, the drone, the echo, fleeing cells, belt pushes, slides, gravity) reappears on the opposite edge, and charged cells reach across too. Magnets, beams and blight still stop at the edges.',
    tip: 'The far side of the board is often one step away.',
    pool: 'core',
    timed: false
  },
  SKITTISH_CELLS: {
    id: 'SKITTISH_CELLS',
    name: 'Skittish Cells',
    ink: '#E3A008',
    darkText: true,
    short: 'Cells run from you when you get within 2 tiles.',
    rule: 'After each move, an uncollected cell within 2 tiles of you steps one tile directly away, along the longer axis first. It only moves onto plain floor, so walls, corners and other objects trap it. The dashed zone around a cell shows how close you can get.',
    tip: 'Herd the cell into a corner, then step onto it.',
    pool: 'core',
    timed: false
  },
  CRATES: {
    id: 'CRATES',
    name: 'Crates',
    ink: '#A0652B',
    darkText: false,
    short: 'Walk into a crate to push it. You can never pull it.',
    rule: 'Walking into a crate pushes it one tile. Once moving, a crate slides on ice, rides belts and warps through portals. Pushed into a pit, it fills the pit and becomes floor. Gravity and magnets do not move crates, and crates block everything else. A crate on a plate presses it.',
    tip: 'Before every push, check you can still get behind the crate later.',
    pool: 'core',
    timed: false
  },
  SPRINGS: {
    id: 'SPRINGS',
    name: 'Springs',
    ink: '#D9480F',
    darkText: false,
    short: 'Land on a spring and it throws you 2 tiles onward, over anything in between.',
    rule: 'Entering a spring launches you 2 tiles further in the direction you were travelling, clearing whatever is on the tile in between. If the landing tile is blocked or off the board, the spring does nothing. Each spring fires once per move.',
    tip: 'Springs hop walls. Falling or sliding onto one counts too.',
    pool: 'core',
    timed: false
  },
  PAINT: {
    id: 'PAINT',
    name: 'Paint',
    ink: '#12A37E',
    darkText: false,
    short: 'Step on a paint splash to take its colour. Coloured barriers only let that colour through.',
    rule: 'Walking onto a green or violet splash paints you that colour (your ring shows it). A barrier of one colour only lets you through while you are that colour. Drones, echoes and crates can never pass a barrier.',
    tip: 'Plan the order: each splash you cross repaints you.',
    pool: 'mild',
    timed: false
  },
  KEYS: {
    id: 'KEYS',
    name: 'Keys & Locks',
    ink: '#B7860B',
    darkText: true,
    short: 'Pick up keys. Each key opens one lock for good.',
    rule: 'Walking onto a key picks it up. A lock is a wall unless you are holding a key; stepping into it uses the key and opens the lock for good. Keys are counted next to your moves.',
    tip: 'Any key opens any lock. Decide which lock is worth it.',
    pool: 'mild',
    timed: false
  },
  MUD: {
    id: 'MUD',
    name: 'Mud',
    ink: '#7A5230',
    darkText: false,
    short: 'Mud stops you dead and holds you for one move.',
    rule: 'Entering mud stops you on the spot. Your next move is spent pulling free: you stay put while the rest of the board takes its turn. Nothing moves you while you are stuck, not even gravity or magnets.',
    tip: 'Mud is a brake. Use it to stop a slide or a fall exactly where you want.',
    pool: 'mild',
    timed: false
  }
};

export function mutationName(id: MutationId): string {
  return MUTATIONS[id].name;
}

/** Mutations whose behaviour depends on the turn counter. */
export const TIMED_MUTATIONS: ReadonlySet<MutationId> = new Set(
  ALL_MUTATIONS.filter((m) => MUTATIONS[m].timed)
);
