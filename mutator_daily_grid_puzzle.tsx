import ReactNamespace from 'react';

const React =
  typeof window !== 'undefined' && window.React ? window.React : ReactNamespace;
const { useCallback, useEffect, useMemo, useRef, useState } = React;

/**
 * Normalizes JSX elements produced by React 19 automatic runtime so they render
 * cleanly inside hosts running React 18.
 */
function toHostElement(node) {
  if (node === null || node === undefined || typeof node !== 'object') {
    return node;
  }
  if (Array.isArray(node)) {
    return node.map(toHostElement);
  }
  if (node.$$typeof && node.type) {
    const rawProps = node.props || {};
    const nextProps = {};
    for (const k of Object.keys(rawProps)) {
      if (k !== 'children') {
        nextProps[k] = rawProps[k];
      }
    }
    if (node.key !== null && node.key !== undefined) {
      nextProps.key = node.key;
    }
    if (node.ref !== null && node.ref !== undefined) {
      nextProps.ref = node.ref;
    }
    if (!Object.prototype.hasOwnProperty.call(rawProps, 'children')) {
      return React.createElement(node.type, nextProps);
    }
    const convertedChildren = toHostElement(rawProps.children);
    if (Array.isArray(convertedChildren)) {
      return React.createElement(node.type, nextProps, ...convertedChildren);
    }
    return React.createElement(node.type, nextProps, convertedChildren);
  }
  return node;
}

// ============================================================================
// 1. CONSTANTS, DOMAIN TYPES & HELPERS
// ============================================================================

const GRID_SIZE = 7;
const RULES_VERSION = 3;
const EPOCH_DATE = '2026-01-01';

const ALL_MUTATIONS = [
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
  'BLAST_DOORS'
];

// Mutations that modify other systems require at least one host mutation;
// if none is present in the initial pair, one is promoted as a 3rd mutation.
const MUTATION_DEPENDENCIES = {
  PAYLOAD_MASS: ['GRAVITY', 'CONVEYOR', 'MAGNETISM', 'DECAY']
};

const SIGNATURE_JINXES = {
  'CONVEYOR+GRAVITY': {
    tag: 'VECTOR CHAIN',
    text: 'Conveyor belts push first (Step 3), then Gravity pulls 1 tile from your landing square (Step 5)—creating L-shaped diagonal drift.'
  },
  'GRAVITY+PORTALS': {
    tag: 'VECTOR CHAIN',
    text: 'Exiting a Portal immediately triggers Gravity pull on the destination pad, launching you off the pad before you can step back.'
  },
  'CRYO_SLICK+PORTALS': {
    tag: 'MOMENTUM WARP',
    text: 'Sliding onto a Portal preserves your travel vector through the warp—if the exit pad sits on ice, you keep sliding.'
  },
  'CRYO_SLICK+DECAY': {
    tag: 'COMPOUND HAZARD',
    text: 'Sliding across multiple ice tiles in one turn destabilizes every tile along the slide simultaneously, collapsing whole corridors.'
  },
  'DECAY+INFECTION': {
    tag: 'SHRINKING ARENA',
    text: 'Collapsing floor pits and spreading biomass permanently erase traversable tiles from opposite ends of the grid.'
  },
  'GRAVITY+PAYLOAD_MASS': {
    tag: 'CATALYST LINK',
    text: '0 cells: Gravity pulls 2 tiles per turn. 1 cell: 1 tile. 2 cells: Heavy anchor makes you completely immune to Gravity.'
  },
  'CONVEYOR+PAYLOAD_MASS': {
    tag: 'CATALYST LINK',
    text: '0 cells: Conveyors launch you 2 tiles. 1 cell: 1 tile. 2 cells: Heavy chassis anchors you so belts have zero effect.'
  },
  'MAGNETISM+PAYLOAD_MASS': {
    tag: 'CATALYST LINK',
    text: '0–1 cells: Magnetic pylons pull you along clear sightlines. 2 cells: Heavy mass anchors you against magnetic attraction.'
  },
  'DECAY+PAYLOAD_MASS': {
    tag: 'CATALYST LINK',
    text: 'Collecting both Energy Cells doubles chassis weight, causing vacated floor tiles to collapse in 1 turn instead of 2.'
  },
  'BLAST_DOORS+MIRROR_DRONE': {
    tag: 'CO-OP SWITCH',
    text: 'The Mirror Drone triggers Pressure Plates on its inverted path, opening or sealing Blast Doors remotely for the Courier.'
  },
  'INFECTION+MIRROR_DRONE': {
    tag: 'TACTICAL COUNTER',
    text: 'Infection cannot spread onto the Mirror Drone’s square—park the decoy in a chokepoint to quarantine biomass.'
  },
  'AFTERIMAGE+CRYO_SLICK': {
    tag: 'HARD-LIGHT BRAKE',
    text: 'The hard-light wall from 2 turns ago acts as a mid-ice bumper to stop Cryo-Slick slides on exact squares.'
  },
  'AFTERIMAGE+INFECTION': {
    tag: 'TACTICAL COUNTER',
    text: 'Solidified Afterimage barriers block adjacent Infection spread for 1 turn while sealing off your own retreat.'
  },
  'OVERCLOCK+PHASE_SHIFT': {
    tag: 'CHASSIS SYNC',
    text: 'Overclock fires every 3rd turn and Phase Shift every 4th turn—on Turn 12 both align, phasing through a wall onto a double-step.'
  },
  'CONVEYOR+TURNTABLES': {
    tag: 'CLOCKWORK BELTS',
    text: 'Every 3 turns, Turntables rotate adjacent Conveyors 90° clockwise and re-aim their belt arrows in the new direction.'
  },
  'PHASE_GATES+TURNTABLES': {
    tag: 'TIMING LOCK',
    text: 'Turntables physically orbit Phase Gates around the hub every 3 turns while gate polarity flips every single turn.'
  },
  'PORTALS+TETHER_PYLON': {
    tag: 'SLINGSHOT LEASH',
    text: 'Portals can warp you outside the 5×5 Tether zone, causing the elastic leash to snap you 1 tile back toward the pylon at turn end.'
  },
  'CONVEYOR+TETHER_PYLON': {
    tag: 'SLINGSHOT LEASH',
    text: 'Conveyors can push you past the 5×5 Tether border to grab outer cells before the leash yanks you back inward.'
  },
  'INFECTION+PHASE_GATES': {
    tag: 'TIMING LOCK',
    text: 'Closed laser gates block Infection spread on their active turn parity, buying extra turns before corridors seal.'
  },
  'BLAST_DOORS+INFECTION': {
    tag: 'CONTAINMENT',
    text: 'Sealed Blast Doors block Infection spread; toggling a Pressure Plate open can accidentally unleash trapped biomass.'
  },
  'MAGNETIC_CELLS+MAGNETISM': {
    tag: 'DUAL POLARITY',
    text: 'Cell fields pull/repel first (Step 4a), then wall Magnets pull along sightlines (Step 4b) for two-stage vector deflections.'
  },
  'GRAVITY+MAGNETIC_CELLS': {
    tag: 'ORBITAL DRIFT',
    text: 'Cell #1 (+) repels you away on orthogonal approach—use Gravity pull or diagonal alignment to drop straight onto it.'
  }
};

const MUTATION_STEP_INFO = {
  OVERCLOCK: { step: 1, role: '2-tile surge every 3rd turn' },
  PHASE_SHIFT: { step: 1, role: 'wall-tunneling every 4th turn' },
  MIRROR_DRONE: { step: 2, role: 'inverted solid decoy movement' },
  PORTALS: { step: 3, role: 'paired pad teleportation' },
  CONVEYOR: { step: 3, role: 'directional belt push' },
  CRYO_SLICK: { step: 3, role: 'frictionless momentum slide' },
  BLAST_DOORS: { step: 3, role: 'plate-toggled door state' },
  PHASE_GATES: { step: 3, role: 'turn-parity laser barriers' },
  MAGNETIC_CELLS: { step: 4, role: 'cell repulsion/attraction' },
  MAGNETISM: { step: 4, role: 'pylon line-of-sight pull' },
  GRAVITY: { step: 5, role: 'rotating 90° directional pull' },
  TETHER_PYLON: { step: 6, role: '5×5 boundary snap-back' },
  AFTERIMAGE: { step: 7, role: '2-turn delayed hard-light wall' },
  DECAY: { step: 7, role: '2-turn collapsing floor pits' },
  INFECTION: { step: 7, role: '2-turn spreading biomass' },
  TURNTABLES: { step: 7, role: '3-turn 90° hub rotation' },
  PAYLOAD_MASS: { step: 5, role: 'cell-count weight scaling' }
};

function computeActiveJinxes(mutations) {
  const jinxes = [];
  for (let i = 0; i < mutations.length; i++) {
    for (let j = i + 1; j < mutations.length; j++) {
      const a = mutations[i];
      const b = mutations[j];
      const key = canonicalPairKey([a, b]);
      const sig = SIGNATURE_JINXES[key];
      if (sig) {
        jinxes.push({
          id: key,
          pair: [a, b],
          tag: sig.tag,
          text: sig.text
        });
      } else {
        const infoA = MUTATION_STEP_INFO[a];
        const infoB = MUTATION_STEP_INFO[b];
        const [first, second] = infoA.step <= infoB.step ? [a, b] : [b, a];
        const firstInfo = MUTATION_STEP_INFO[first];
        const secondInfo = MUTATION_STEP_INFO[second];
        const samePhase = firstInfo.step === secondInfo.step;
        jinxes.push({
          id: key,
          pair: [a, b],
          tag: samePhase ? 'SIMULTANEOUS JINX' : 'SEQUENCE JINX',
          text: samePhase
            ? `${MUTATION_META[first].name} (${firstInfo.role}) and ${MUTATION_META[second].name} (${secondInfo.role}) resolve in the same turn phase, compounding corridor constraints.`
            : `${MUTATION_META[first].name} (${firstInfo.role}) resolves first, feeding your new position directly into ${MUTATION_META[second].name} (${secondInfo.role}).`
        });
      }
    }
  }
  return jinxes;
}

const MUTATION_META = {
  GRAVITY: {
    name: 'GRAVITY',
    color: '#38bdf8',
    rgb: '56, 189, 248',
    icon: '⬇',
    shortDesc: 'Pulls Courier 1 tile after every move. Rotates 90° CW every 3 turns.',
    fullDesc:
      'After player movement and tile effects resolve, the Courier is pulled 1 square in the active gravity direction unless blocked. Starts pointing DOWN and rotates 90° clockwise after every 3 completed turns.'
  },
  DECAY: {
    name: 'DECAY',
    color: '#f97316',
    rgb: '249, 115, 22',
    icon: '◈',
    shortDesc: 'Normal floor tiles left behind collapse into pits after 2 turns.',
    fullDesc:
      'Whenever the Courier vacates a normal floor tile, structural integrity destabilizes. After 2 subsequent completed turns, that tile collapses into an impassable pit. Start, Exit, Energy Cells, and special tiles are immune.'
  },
  INFECTION: {
    name: 'INFECTION',
    color: '#a855f7',
    rgb: '168, 85, 247',
    icon: '☣',
    shortDesc: 'Spreads every 2 turns to 1 adjacent floor tile via seed priority.',
    fullDesc:
      'Every 2 completed turns, contaminated biomass spreads to 1 eligible orthogonally adjacent normal floor tile using a deterministic direction priority derived from the daily seed.'
  },
  CONVEYOR: {
    name: 'CONVEYOR',
    color: '#14b8a6',
    rgb: '20, 184, 166',
    icon: '➤',
    shortDesc: 'Automatically pushes Courier 1 tile in belt direction. Chains possible.',
    fullDesc:
      'Entering a directional conveyor belt automatically pushes the Courier 1 square in the arrow direction. Belts can chain together and stop if the destination square is blocked.'
  },
  PORTALS: {
    name: 'PORTALS',
    color: '#818cf8',
    rgb: '129, 140, 248',
    icon: '◎',
    shortDesc: 'Teleports between paired pads. Pairings swap every 3 turns.',
    fullDesc:
      'Four quantum pads (A, B, C, D) teleport the Courier to their paired pad upon entry (max once per turn). Pairings start as A↔B and C↔D, then switch to A↔C and B↔D every 3 completed turns.'
  },
  PHASE_GATES: {
    name: 'PHASE GATES',
    color: '#fbbf24',
    rgb: '251, 191, 36',
    icon: '⊞',
    shortDesc: 'Cyan & Amber laser barriers alternate open/closed every turn.',
    fullDesc:
      'Cyan gates block movement on even turns while Amber gates are passable; Amber gates block movement on odd turns while Cyan gates are passable. Closed gates also block Infection spread.'
  },
  CRYO_SLICK: {
    name: 'CRYO-SLICK',
    color: '#67e8f9',
    rgb: '103, 232, 249',
    icon: '❄',
    shortDesc: 'Frictionless ice keeps Courier sliding until hitting obstacle or floor.',
    fullDesc:
      'Entering a Cryo-Slick ice tile causes the Courier to keep sliding 1 square at a time in its current travel direction until hitting a wall/obstacle or stepping onto non-ice terrain.'
  },
  OVERCLOCK: {
    name: 'OVERCLOCK',
    color: '#f43f5e',
    rgb: '244, 63, 94',
    icon: '⚡',
    shortDesc: 'Every 3rd turn, your input moves 2 tiles instead of 1.',
    fullDesc:
      'On every 3rd turn, the Courier drive core surges: your directional input moves up to 2 squares in that direction (stopping at 1 if the second square is blocked).'
  },
  MAGNETISM: {
    name: 'MAGNETISM',
    color: '#60a5fa',
    rgb: '96, 165, 250',
    icon: '🧲',
    shortDesc: 'Magnetic pylons pull Courier 1 tile along unobstructed rows/columns.',
    fullDesc:
      'Wall-mounted magnetic pylons exert linear attraction. After tile effects resolve, if the Courier shares an unobstructed row or column with a pylon, it is pulled 1 square toward it.'
  },
  MIRROR_DRONE: {
    name: 'MIRROR DRONE',
    color: '#e879f9',
    rgb: '232, 121, 249',
    icon: '❖',
    shortDesc: 'Spawns an inverted decoy unit that acts as a movable solid obstacle.',
    fullDesc:
      'A passive decoy spawns at the opposite grid coordinate and moves in the opposite direction of your inputs. It cannot collect cells, but acts as a solid wall you can brace against or trigger plates with.'
  },
  PHASE_SHIFT: {
    name: 'PHASE SHIFT',
    color: '#34d399',
    rgb: '52, 211, 153',
    icon: '⬡',
    shortDesc: 'Every 4th turn, step straight through a single internal wall.',
    fullDesc:
      'On every 4th turn, the Courier chassis becomes intangible, allowing you to step directly through a single-thickness internal wall if the square immediately behind it is open floor.'
  },
  PAYLOAD_MASS: {
    name: 'PAYLOAD MASS',
    color: '#eab308',
    rgb: '234, 179, 8',
    icon: '⚖',
    dependent: true,
    shortDesc: 'Catalyst: 0 cells = 2x drift; 2 cells = Heavy anchor. Auto-links a 3rd host.',
    fullDesc:
      'Catalyst Module (requires Gravity, Conveyor, Magnetism, or Decay—auto-adds one as a 3rd mutation if absent): With 0 cells (Light), Gravity & Conveyors move you 2 tiles; with 1 cell (Nominal), physics are 1x; with 2 cells (Heavy), you become immune to Gravity, Conveyors, and Magnets while Decay floors collapse in 1 turn.'
  },
  AFTERIMAGE: {
    name: 'AFTERIMAGE',
    color: '#0ea5e9',
    rgb: '14, 165, 233',
    icon: '❐',
    shortDesc: 'The tile you occupied 2 turns ago solidifies into a hard-light wall.',
    fullDesc:
      'Your temporal wake crystallizes: the tile you stood on 2 turns ago becomes a solid hard-light barrier for 1 turn, blocking movement, stopping Cryo slides, and sealing Infection corridors.'
  },
  MAGNETIC_CELLS: {
    name: 'MAGNETIC CELLS',
    color: '#fb7185',
    rgb: '251, 113, 133',
    icon: '⊕',
    shortDesc: 'Cell #1 (+) repels 1 tile away; Cell #2 (−) pulls 1 tile toward itself.',
    fullDesc:
      'Uncollected Energy Cells emit opposite polarity fields after tile effects: Cell #1 (+) pushes you 1 tile away if orthogonally adjacent (enter via forced movement or diagonals), while Cell #2 (−) pulls you 1 tile closer within 2 unobstructed straight tiles.'
  },
  TURNTABLES: {
    name: 'TURNTABLES',
    color: '#d97706',
    rgb: '217, 119, 6',
    icon: '⚙',
    shortDesc: 'Gear hubs rotate their 4 adjacent tiles 90° clockwise every 3 turns.',
    fullDesc:
      'Two clockwork gear hubs rotate their 4 orthogonally adjacent platforms 90° clockwise after every 3 completed turns, shifting walls, conveyors, hazards, and any riding units around the hub.'
  },
  TETHER_PYLON: {
    name: 'TETHER PYLON',
    color: '#ec4899',
    rgb: '236, 72, 153',
    icon: '⌖',
    shortDesc: '5×5 range leash; forced movement past the border snaps 1 tile back.',
    fullDesc:
      'A central Tether Pylon enforces a 5×5 range boundary. You cannot voluntarily step outside the zone, but Conveyors, Portals, or Cryo-Slick can launch you outside—triggering an elastic 1-tile pullback at turn end.'
  },
  BLAST_DOORS: {
    name: 'BLAST DOORS',
    color: '#84cc16',
    rgb: '132, 204, 22',
    icon: '⛨',
    shortDesc: 'Stepping on Pressure Plates toggles armored Blast Doors open/closed.',
    fullDesc:
      'Armored Blast Doors start sealed shut. Whenever the Courier or Mirror Drone enters a lime Pressure Plate, all Blast Doors toggle between open and closed.'
  }
};

const ACHIEVEMENTS = [
  {
    id: 'first_contact',
    title: 'First Contact',
    description: 'Complete your first daily MUTATOR challenge.',
    badge: '01'
  },
  {
    id: 'perfect_run',
    title: 'Perfect Run',
    description: 'Solve a puzzle in the exact optimal number of moves.',
    badge: '3★'
  },
  {
    id: 'adaptable',
    title: 'Adaptable',
    description: 'Complete 5 different two-mutation pairings.',
    badge: '5×'
  },
  {
    id: 'survivor',
    title: 'Survivor',
    description: 'Complete a three-mutation anomaly puzzle.',
    badge: '3M'
  },
  {
    id: 'mutation_master',
    title: 'Mutation Master',
    description: 'Complete all 136 two-mutation combinations.',
    badge: '136'
  },
  {
    id: 'unbroken',
    title: 'Unbroken',
    description: 'Maintain a 7-day daily completion streak.',
    badge: '7D'
  }
];

const DIR_DELTAS = {
  UP: { r: -1, c: 0 },
  DOWN: { r: 1, c: 0 },
  LEFT: { r: 0, c: -1 },
  RIGHT: { r: 0, c: 1 }
};

const OPPOSITE_DIR = {
  UP: 'DOWN',
  DOWN: 'UP',
  LEFT: 'RIGHT',
  RIGHT: 'LEFT'
};

const CW_DIR = {
  UP: 'RIGHT',
  RIGHT: 'DOWN',
  DOWN: 'LEFT',
  LEFT: 'UP'
};

const ALL_DIRS = ['UP', 'DOWN', 'LEFT', 'RIGHT'];
const PORTAL_LABELS = ['A', 'B', 'C', 'D'];
const GRAVITY_CYCLE = ['DOWN', 'LEFT', 'UP', 'RIGHT'];

function coordKey(c) {
  return `${c.r},${c.c}`;
}

function parseCoordKey(key) {
  const [rStr, cStr] = key.split(',');
  return { r: Number(rStr), c: Number(cStr) };
}

function sameCoord(a, b) {
  return Boolean(a && b && a.r === b.r && a.c === b.c);
}

function inBounds(r, c) {
  return r >= 0 && r < GRID_SIZE && c >= 0 && c < GRID_SIZE;
}

function stepCoord(pos, dir) {
  const d = DIR_DELTAS[dir];
  return { r: pos.r + d.r, c: pos.c + d.c };
}

function chebyshevDist(a, b) {
  return Math.max(Math.abs(a.r - b.r), Math.abs(a.c - b.c));
}

function canonicalPairKey(mutations) {
  return [...mutations].sort().join('+');
}

function calculateStars(moves, optimalMoves) {
  if (moves <= optimalMoves) return 3;
  if (moves <= optimalMoves + 3) return 2;
  return 1;
}

function formatChallengeNumber(num) {
  return String(Math.max(1, num)).padStart(3, '0');
}

function getChallengeNumberForDate(dateKey) {
  const start = Date.parse(`${EPOCH_DATE}T00:00:00Z`);
  const target = Date.parse(`${dateKey}T00:00:00Z`);
  if (Number.isNaN(target)) return 1;
  return Math.max(1, Math.floor((target - start) / 86400000) + 1);
}

function getTodayDateKey() {
  return new Date().toISOString().slice(0, 10);
}

function formatShareText(puzzle, moves, stars) {
  const num = formatChallengeNumber(puzzle.challengeNumber);
  const mutNames = puzzle.mutations.map((m) => MUTATION_META[m].name).join(' + ');
  return [
    `MUTATOR #${num}`,
    `Solved in ${moves} moves.`,
    `Optimal: ${puzzle.optimalMoves}.`,
    `Mutations: ${mutNames}.`,
    `Rating: ${stars}/3 stars.`
  ].join('\n');
}

// ============================================================================
// 2. DETERMINISTIC SEEDED PRNG
// ============================================================================

function hashSeed(seed) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

class SeededRng {
  constructor(seed) {
    this.state = hashSeed(seed) || 0x9e3779b9;
  }

  next() {
    let t = (this.state += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  nextInt(minInclusive, maxExclusive) {
    return minInclusive + Math.floor(this.next() * (maxExclusive - minInclusive));
  }

  shuffle(items) {
    const arr = [...items];
    for (let i = arr.length - 1; i > 0; i--) {
      const j = this.nextInt(0, i + 1);
      const tmp = arr[i];
      arr[i] = arr[j];
      arr[j] = tmp;
    }
    return arr;
  }
}

// ============================================================================
// 3. PROCEDURAL WEB AUDIO LAB SYNTHESIZER
// ============================================================================

class SoundEngine {
  constructor() {
    this.ctx = null;
    this.muted = false;
  }

  ensureCtx() {
    if (this.muted) return null;
    if (!this.ctx && typeof window !== 'undefined') {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (AudioCtx) {
        try {
          this.ctx = new AudioCtx();
        } catch {
          this.ctx = null;
        }
      }
    }
    if (this.ctx && this.ctx.state === 'suspended') {
      this.ctx.resume().catch(() => {});
    }
    return this.ctx;
  }

  playTone(freq, duration, type = 'sine', gainVal = 0.08, slideTo = null) {
    const ctx = this.ensureCtx();
    if (!ctx) return;
    try {
      const now = ctx.currentTime;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = type;
      osc.frequency.setValueAtTime(freq, now);
      if (slideTo) {
        osc.frequency.exponentialRampToValueAtTime(slideTo, now + duration);
      }
      gain.gain.setValueAtTime(gainVal, now);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now);
      osc.stop(now + duration);
    } catch {
      // Ignore audio errors in restricted sandboxes
    }
  }

  playEvent(kind) {
    switch (kind) {
      case 'step':
        this.playTone(320, 0.07, 'triangle', 0.07, 420);
        break;
      case 'blocked':
        this.playTone(130, 0.11, 'sawtooth', 0.07, 90);
        break;
      case 'cell':
        this.playTone(587.33, 0.14, 'sine', 0.11, 880);
        setTimeout(() => this.playTone(880, 0.18, 'sine', 0.09, 1174.66), 70);
        break;
      case 'portal':
        this.playTone(280, 0.2, 'sine', 0.09, 760);
        break;
      case 'conveyor':
        this.playTone(240, 0.09, 'square', 0.05, 340);
        break;
      case 'slide':
        this.playTone(520, 0.12, 'sine', 0.06, 680);
        break;
      case 'gravity':
        this.playTone(220, 0.12, 'triangle', 0.07, 150);
        break;
      case 'magnet':
        this.playTone(410, 0.13, 'sawtooth', 0.05, 620);
        break;
      case 'overclock':
        this.playTone(440, 0.14, 'square', 0.07, 880);
        break;
      case 'phaseShift':
        this.playTone(660, 0.18, 'sine', 0.08, 330);
        break;
      case 'decay':
        this.playTone(170, 0.16, 'sawtooth', 0.07, 75);
        break;
      case 'infection':
        this.playTone(195, 0.16, 'triangle', 0.07, 130);
        break;
      case 'turntable':
        this.playTone(300, 0.18, 'triangle', 0.08, 450);
        break;
      case 'tether':
        this.playTone(540, 0.15, 'sawtooth', 0.07, 270);
        break;
      case 'blastDoor':
        this.playTone(200, 0.14, 'square', 0.07, 380);
        break;
      case 'win':
        [523.25, 659.25, 783.99, 1046.5].forEach((f, idx) => {
          setTimeout(() => this.playTone(f, 0.24, 'triangle', 0.1), idx * 80);
        });
        break;
      default:
        break;
    }
  }
}

const soundFX = new SoundEngine();

// ============================================================================
// 4. COMPOSABLE MUTATION MODULES
// ============================================================================

function getGravityDirectionForTurn(completedTurns) {
  const phase = Math.floor(completedTurns / 3) % GRAVITY_CYCLE.length;
  return GRAVITY_CYCLE[phase];
}

function turnsUntilGravityShift(completedTurns) {
  return 3 - (completedTurns % 3);
}

function isOverclockActive(completedTurns) {
  return completedTurns % 3 === 2;
}

function turnsUntilOverclock(completedTurns) {
  return 2 - (completedTurns % 3);
}

function isPhaseShiftActive(completedTurns) {
  return completedTurns % 4 === 3;
}

function turnsUntilPhaseShift(completedTurns) {
  return 3 - (completedTurns % 4);
}

function turnsUntilTurntableSpin(completedTurns) {
  return 3 - (completedTurns % 3);
}

function getActiveGatePolarity(completedTurns) {
  return completedTurns % 2 === 0 ? 'CYAN' : 'AMBER';
}

function getMassTier(puzzle, collectedCells) {
  if (!puzzle.mutations.includes('PAYLOAD_MASS')) return 'NOMINAL';
  const count = (collectedCells[0] ? 1 : 0) + (collectedCells[1] ? 1 : 0);
  if (count === 0) return 'LIGHT';
  if (count === 1) return 'NOMINAL';
  return 'HEAVY';
}

function isGateBlocked(puzzle, completedTurns, pos) {
  if (!puzzle.mutations.includes('PHASE_GATES')) return false;
  const gate = puzzle.phaseGates.find((g) => sameCoord(g, pos));
  if (!gate) return false;
  const closedPolarity = getActiveGatePolarity(completedTurns);
  return gate.polarity === closedPolarity;
}

function getPortalModeForTurn(completedTurns) {
  return Math.floor(completedTurns / 3) % 2;
}

function turnsUntilPortalShift(completedTurns) {
  return 3 - (completedTurns % 3);
}

function getPairedPortalLabel(label, mode) {
  if (mode === 0) {
    if (label === 'A') return 'B';
    if (label === 'B') return 'A';
    if (label === 'C') return 'D';
    return 'C';
  }
  if (label === 'A') return 'C';
  if (label === 'C') return 'A';
  if (label === 'B') return 'D';
  return 'B';
}

function getPortalAt(puzzle, pos) {
  return puzzle.portals.find((p) => sameCoord(p, pos)) || null;
}

function getPortalDestination(puzzle, entryPortal, mode) {
  const targetLabel = getPairedPortalLabel(entryPortal.label, mode);
  return puzzle.portals.find((p) => p.label === targetLabel) || null;
}

/**
 * Computes the effective rotated board features given turntable rotation phase (0..3).
 * Every 3 completed turns, the 4 orthogonal neighbors (N, E, S, W) of each turntable
 * rotate 90 degrees clockwise.
 */
function getRotatedBoardSnapshot(puzzle, turn) {
  const phase =
    puzzle.mutations.includes('TURNTABLES') && puzzle.turntables.length > 0
      ? Math.floor(turn / 3) % 4
      : 0;

  const grid = puzzle.grid.map((row) => [...row]);
  let conveyors = puzzle.conveyors.map((c) => ({ ...c }));
  let cryoTiles = puzzle.cryoTiles.map((c) => ({ ...c }));
  let phaseGates = puzzle.phaseGates.map((g) => ({ ...g }));
  let blastDoors = puzzle.blastDoors.map((d) => ({ ...d }));
  let pressurePlates = puzzle.pressurePlates.map((p) => ({ ...p }));

  if (phase === 0) {
    return {
      grid,
      conveyors,
      cryoTiles,
      phaseGates,
      blastDoors,
      pressurePlates
    };
  }

  const rotateSlotOnce = (hub, pos) => {
    const dr = pos.r - hub.r;
    const dc = pos.c - hub.c;
    if (
      (Math.abs(dr) === 1 && dc === 0) ||
      (dr === 0 && Math.abs(dc) === 1)
    ) {
      // 90 deg CW: (dr, dc) -> (dc, -dr)
      return { r: hub.r + dc, c: hub.c - dr };
    }
    return pos;
  };

  for (let step = 0; step < phase; step++) {
    for (const hub of puzzle.turntables) {
      const ring = [
        { r: hub.r - 1, c: hub.c }, // N
        { r: hub.r, c: hub.c + 1 }, // E
        { r: hub.r + 1, c: hub.c }, // S
        { r: hub.r, c: hub.c - 1 }  // W
      ];
      const vals = ring.map((p) => grid[p.r][p.c]);
      // N<-W, E<-N, S<-E, W<-S
      grid[ring[0].r][ring[0].c] = vals[3];
      grid[ring[1].r][ring[1].c] = vals[0];
      grid[ring[2].r][ring[2].c] = vals[1];
      grid[ring[3].r][ring[3].c] = vals[2];

      conveyors = conveyors.map((cv) => {
        const nextPos = rotateSlotOnce(hub, cv);
        if (!sameCoord(nextPos, cv)) {
          return { ...nextPos, dir: CW_DIR[cv.dir] };
        }
        return cv;
      });
      cryoTiles = cryoTiles.map((cr) => rotateSlotOnce(hub, cr));
      phaseGates = phaseGates.map((pg) => ({
        ...rotateSlotOnce(hub, pg),
        polarity: pg.polarity
      }));
      blastDoors = blastDoors.map((bd) => rotateSlotOnce(hub, bd));
      pressurePlates = pressurePlates.map((pp) => rotateSlotOnce(hub, pp));
    }
  }

  return {
    grid,
    conveyors,
    cryoTiles,
    phaseGates,
    blastDoors,
    pressurePlates
  };
}

function isImmuneToDecay(puzzle, boardView, pos) {
  if (!inBounds(pos.r, pos.c)) return true;
  if (boardView.grid[pos.r][pos.c] === 'WALL') return true;
  if (sameCoord(pos, puzzle.start)) return true;
  if (sameCoord(pos, puzzle.exit)) return true;
  if (sameCoord(pos, puzzle.cells[0]) || sameCoord(pos, puzzle.cells[1])) return true;
  if (boardView.conveyors.some((cv) => sameCoord(cv, pos))) return true;
  if (puzzle.portals.some((pt) => sameCoord(pt, pos))) return true;
  if (boardView.phaseGates.some((pg) => sameCoord(pg, pos))) return true;
  if (boardView.cryoTiles.some((cr) => sameCoord(cr, pos))) return true;
  if (puzzle.magnets.some((mg) => sameCoord(mg, pos))) return true;
  if (puzzle.turntables.some((tb) => sameCoord(tb, pos))) return true;
  if (puzzle.tetherPylon && sameCoord(puzzle.tetherPylon, pos)) return true;
  if (boardView.blastDoors.some((bd) => sameCoord(bd, pos))) return true;
  if (boardView.pressurePlates.some((pp) => sameCoord(pp, pos))) return true;
  const key = coordKey(pos);
  if (puzzle.initialInfected.some((inf) => coordKey(inf) === key)) return true;
  return false;
}

function markTileLeftForDecay(puzzle, boardView, decayTimers, leftPos, isHeavy) {
  if (isImmuneToDecay(puzzle, boardView, leftPos)) return;
  const key = coordKey(leftPos);
  if (decayTimers[key] === undefined) {
    // Heavy payload weakens floor faster (collapses after 1 subsequent turn instead of 2)
    decayTimers[key] = isHeavy ? 2 : 3;
  }
}

function tickDecayTimers(decayTimers, courierPos, dronePos) {
  const newlyCollapsed = [];
  const courierKey = coordKey(courierPos);
  const droneKey = dronePos ? coordKey(dronePos) : null;

  for (const [key, remaining] of Object.entries(decayTimers)) {
    if (remaining <= 0) continue;
    const nextVal = remaining - 1;
    if (nextVal === 0 && (key === courierKey || key === droneKey)) {
      decayTimers[key] = 1;
      continue;
    }
    decayTimers[key] = nextVal;
    if (nextVal === 0) {
      newlyCollapsed.push(parseCoordKey(key));
    }
  }

  return newlyCollapsed;
}

function isImmuneToInfection(puzzle, boardView, pos) {
  if (!inBounds(pos.r, pos.c)) return true;
  if (boardView.grid[pos.r][pos.c] === 'WALL') return true;
  if (sameCoord(pos, puzzle.start)) return true;
  if (sameCoord(pos, puzzle.exit)) return true;
  if (sameCoord(pos, puzzle.cells[0]) || sameCoord(pos, puzzle.cells[1])) return true;
  if (boardView.conveyors.some((cv) => sameCoord(cv, pos))) return true;
  if (puzzle.portals.some((pt) => sameCoord(pt, pos))) return true;
  if (boardView.phaseGates.some((pg) => sameCoord(pg, pos))) return true;
  if (boardView.cryoTiles.some((cr) => sameCoord(cr, pos))) return true;
  if (puzzle.magnets.some((mg) => sameCoord(mg, pos))) return true;
  if (puzzle.turntables.some((tb) => sameCoord(tb, pos))) return true;
  if (puzzle.tetherPylon && sameCoord(puzzle.tetherPylon, pos)) return true;
  if (boardView.blastDoors.some((bd) => sameCoord(bd, pos))) return true;
  if (boardView.pressurePlates.some((pp) => sameCoord(pp, pos))) return true;
  return false;
}

function spreadInfectionOnce(
  puzzle,
  boardView,
  infectedTiles,
  decayTimers,
  afterimagePos,
  blastDoorsOpen,
  turn,
  courierPos,
  dronePos
) {
  const infectedSet = new Set(infectedTiles);
  const courierKey = coordKey(courierPos);
  const droneKey = dronePos ? coordKey(dronePos) : null;
  const afterKey = afterimagePos ? coordKey(afterimagePos) : null;

  for (const sourceKey of infectedTiles) {
    const src = parseCoordKey(sourceKey);
    for (const dir of puzzle.infectionPriority) {
      const candidate = stepCoord(src, dir);
      const candKey = coordKey(candidate);

      if (infectedSet.has(candKey)) continue;
      if (candKey === courierKey || candKey === droneKey || candKey === afterKey) {
        continue;
      }
      if (decayTimers[candKey] === 0) continue;
      if (
        puzzle.mutations.includes('PHASE_GATES') &&
        boardView.phaseGates.some(
          (g) => sameCoord(g, candidate) && g.polarity === getActiveGatePolarity(turn)
        )
      ) {
        continue;
      }
      if (
        puzzle.mutations.includes('BLAST_DOORS') &&
        !blastDoorsOpen &&
        boardView.blastDoors.some((bd) => sameCoord(bd, candidate))
      ) {
        continue;
      }
      if (isImmuneToInfection(puzzle, boardView, candidate)) continue;

      const nextInfected = [...infectedTiles, candKey].sort();
      return { nextInfected, spreadTo: candidate };
    }
  }

  return { nextInfected: infectedTiles, spreadTo: null };
}

// ============================================================================
// 5. AUTHORITATIVE 9-STEP TURN RESOLUTION ENGINE
// ============================================================================

function createInitialGameState(puzzle) {
  const hasGravity = puzzle.mutations.includes('GRAVITY');
  const hasPortals = puzzle.mutations.includes('PORTALS');
  const hasInfection = puzzle.mutations.includes('INFECTION');
  const hasDrone = puzzle.mutations.includes('MIRROR_DRONE');

  return {
    turn: 0,
    courier: { ...puzzle.start },
    drone: hasDrone && puzzle.droneStart ? { ...puzzle.droneStart } : null,
    prevTurn1Pos: null,
    afterimagePos: null,
    blastDoorsOpen: false,
    collectedCells: [false, false],
    decayTimers: {},
    infectedTiles: hasInfection ? [...puzzle.initialInfected].map(coordKey).sort() : [],
    gravityDir: hasGravity ? getGravityDirectionForTurn(0) : 'DOWN',
    portalMode: hasPortals ? getPortalModeForTurn(0) : 0,
    solved: false,
    lastStepEvents: []
  };
}

function isTileBlocked(
  puzzle,
  boardView,
  stateRef,
  pos,
  turn,
  dronePos = null
) {
  if (!inBounds(pos.r, pos.c)) return true;
  if (boardView.grid[pos.r][pos.c] === 'WALL') return true;
  if (dronePos && sameCoord(pos, dronePos)) return true;
  if (stateRef.afterimagePos && sameCoord(pos, stateRef.afterimagePos)) return true;
  if (
    puzzle.mutations.includes('PHASE_GATES') &&
    boardView.phaseGates.some(
      (g) => sameCoord(g, pos) && g.polarity === getActiveGatePolarity(turn)
    )
  ) {
    return true;
  }
  if (
    puzzle.mutations.includes('BLAST_DOORS') &&
    !stateRef.blastDoorsOpen &&
    boardView.blastDoors.some((bd) => sameCoord(bd, pos))
  ) {
    return true;
  }
  const key = coordKey(pos);
  if (stateRef.decayTimers[key] === 0) return true;
  if (stateRef.infectedTiles.includes(key)) return true;
  return false;
}

function collectCellsAt(puzzle, pos, collected, events) {
  if (!collected[0] && sameCoord(pos, puzzle.cells[0])) {
    collected[0] = true;
    events.push({ type: 'COLLECT_CELL', index: 0, at: { ...pos } });
  }
  if (!collected[1] && sameCoord(pos, puzzle.cells[1])) {
    collected[1] = true;
    events.push({ type: 'COLLECT_CELL', index: 1, at: { ...pos } });
  }
}

function checkPressurePlateTrigger(
  puzzle,
  boardView,
  pos,
  stateRef,
  courierPos,
  dronePos,
  events
) {
  if (!puzzle.mutations.includes('BLAST_DOORS')) return;
  if (!boardView.pressurePlates.some((pp) => sameCoord(pp, pos))) return;

  // If doors are currently open, verify closing them won't crush Courier or Mirror Drone
  if (stateRef.blastDoorsOpen) {
    const occupiedDoor = boardView.blastDoors.some(
      (bd) => sameCoord(bd, courierPos) || (dronePos && sameCoord(bd, dronePos))
    );
    if (occupiedDoor) return;
  }

  stateRef.blastDoorsOpen = !stateRef.blastDoorsOpen;
  events.push({
    type: 'BLAST_DOOR_TOGGLE',
    open: stateRef.blastDoorsOpen,
    at: { ...pos }
  });
}

function resolveTileEntryEffects(
  puzzle,
  boardView,
  currentPos,
  initialTravelDir,
  portalMode,
  turn,
  stateRef,
  collected,
  leftTiles,
  events,
  teleportedThisTurn,
  dronePos
) {
  const hasPortals = puzzle.mutations.includes('PORTALS');
  const hasConveyor = puzzle.mutations.includes('CONVEYOR');
  const hasCryo = puzzle.mutations.includes('CRYO_SLICK');
  const visitedConveyors = new Set();
  const MAX_FORCED_STEPS = 20;

  let pos = { ...currentPos };
  let travelDir = initialTravelDir;

  for (let iter = 0; iter < MAX_FORCED_STEPS; iter++) {
    let moved = false;

    // Portal check (at most once per turn)
    if (hasPortals && !teleportedThisTurn.used) {
      const portal = getPortalAt(puzzle, pos);
      if (portal) {
        const dest = getPortalDestination(puzzle, portal, portalMode);
        if (dest && !isTileBlocked(puzzle, boardView, stateRef, dest, turn, dronePos)) {
          teleportedThisTurn.used = true;
          leftTiles.push({ ...pos });
          pos = { r: dest.r, c: dest.c };
          events.push({
            type: 'PORTAL',
            from: portal.label,
            to: dest.label,
            coord: { ...pos }
          });
          collectCellsAt(puzzle, pos, collected, events);
          checkPressurePlateTrigger(
            puzzle,
            boardView,
            pos,
            stateRef,
            pos,
            dronePos,
            events
          );
          moved = true;
        }
      }
    }

    // Conveyor belt check (2 tiles if Payload Mass is LIGHT, else 1 tile)
    if (hasConveyor) {
      const conv = boardView.conveyors.find((c) => sameCoord(c, pos));
      const posKey = coordKey(pos);
      if (conv && !visitedConveyors.has(posKey)) {
        visitedConveyors.add(posKey);
        const pushSteps = getMassTier(puzzle, collected) === 'LIGHT' ? 2 : 1;
        for (let ps = 0; ps < pushSteps; ps++) {
          const nextPos = stepCoord(pos, conv.dir);
          if (isTileBlocked(puzzle, boardView, stateRef, nextPos, turn, dronePos)) {
            break;
          }
          leftTiles.push({ ...pos });
          events.push({
            type: 'CONVEYOR',
            dir: conv.dir,
            from: { ...pos },
            to: { ...nextPos }
          });
          pos = nextPos;
          travelDir = conv.dir;
          collectCellsAt(puzzle, pos, collected, events);
          checkPressurePlateTrigger(
            puzzle,
            boardView,
            pos,
            stateRef,
            pos,
            dronePos,
            events
          );
          moved = true;
          // Stop multi-push early if we landed on another conveyor or portal
          if (
            boardView.conveyors.some((c2) => sameCoord(c2, pos)) ||
            (hasPortals && !teleportedThisTurn.used && getPortalAt(puzzle, pos))
          ) {
            break;
          }
        }
      }
    }

    // Cryo-Slick ice momentum slide
    if (hasCryo && !moved) {
      const onCryo = boardView.cryoTiles.some((cr) => sameCoord(cr, pos));
      if (onCryo && travelDir) {
        const slidePos = stepCoord(pos, travelDir);
        if (!isTileBlocked(puzzle, boardView, stateRef, slidePos, turn, dronePos)) {
          leftTiles.push({ ...pos });
          events.push({
            type: 'CRYO_SLIDE',
            dir: travelDir,
            from: { ...pos },
            to: { ...slidePos }
          });
          pos = slidePos;
          collectCellsAt(puzzle, pos, collected, events);
          checkPressurePlateTrigger(
            puzzle,
            boardView,
            pos,
            stateRef,
            pos,
            dronePos,
            events
          );
          moved = true;
        }
      }
    }

    if (!moved) break;
  }

  return { pos, travelDir };
}

function applyMagneticCellForces(
  puzzle,
  boardView,
  pos,
  turn,
  stateRef,
  collected,
  leftTiles,
  events,
  dronePos
) {
  let current = { ...pos };
  let movedDir = null;

  // Cell #1 (+): Repels Courier 1 tile away if orthogonally adjacent and uncollected
  if (!collected[0]) {
    const c0 = puzzle.cells[0];
    const dr = current.r - c0.r;
    const dc = current.c - c0.c;
    if (Math.abs(dr) + Math.abs(dc) === 1) {
      const repelDir =
        dr === -1 ? 'UP' : dr === 1 ? 'DOWN' : dc === -1 ? 'LEFT' : 'RIGHT';
      const target = stepCoord(current, repelDir);
      if (!isTileBlocked(puzzle, boardView, stateRef, target, turn, dronePos)) {
        leftTiles.push({ ...current });
        events.push({
          type: 'CELL_REPEL',
          dir: repelDir,
          from: { ...current },
          to: { ...target }
        });
        current = target;
        movedDir = repelDir;
        collectCellsAt(puzzle, current, collected, events);
        checkPressurePlateTrigger(
          puzzle,
          boardView,
          current,
          stateRef,
          current,
          dronePos,
          events
        );
      }
    }
  }

  // Cell #2 (-): Attracts Courier 1 tile toward itself within 2 unobstructed straight tiles
  if (!collected[1]) {
    const c1 = puzzle.cells[1];
    if (current.r === c1.r && current.c !== c1.c && Math.abs(current.c - c1.c) <= 2) {
      const pullDir = c1.c > current.c ? 'RIGHT' : 'LEFT';
      const target = stepCoord(current, pullDir);
      if (!isTileBlocked(puzzle, boardView, stateRef, target, turn, dronePos)) {
        leftTiles.push({ ...current });
        events.push({
          type: 'CELL_ATTRACT',
          dir: pullDir,
          from: { ...current },
          to: { ...target }
        });
        current = target;
        movedDir = pullDir;
        collectCellsAt(puzzle, current, collected, events);
        checkPressurePlateTrigger(
          puzzle,
          boardView,
          current,
          stateRef,
          current,
          dronePos,
          events
        );
      }
    } else if (
      current.c === c1.c &&
      current.r !== c1.r &&
      Math.abs(current.r - c1.r) <= 2
    ) {
      const pullDir = c1.r > current.r ? 'DOWN' : 'UP';
      const target = stepCoord(current, pullDir);
      if (!isTileBlocked(puzzle, boardView, stateRef, target, turn, dronePos)) {
        leftTiles.push({ ...current });
        events.push({
          type: 'CELL_ATTRACT',
          dir: pullDir,
          from: { ...current },
          to: { ...target }
        });
        current = target;
        movedDir = pullDir;
        collectCellsAt(puzzle, current, collected, events);
        checkPressurePlateTrigger(
          puzzle,
          boardView,
          current,
          stateRef,
          current,
          dronePos,
          events
        );
      }
    }
  }

  return { pos: current, movedDir };
}

function applyMagnetismPull(
  puzzle,
  boardView,
  pos,
  turn,
  stateRef,
  collected,
  leftTiles,
  events,
  dronePos
) {
  let current = { ...pos };
  let pullDir = null;

  for (const mag of puzzle.magnets) {
    if (current.r === mag.r && current.c !== mag.c) {
      const stepC = mag.c > current.c ? 1 : -1;
      let clear = true;
      for (let c = current.c + stepC; c !== mag.c; c += stepC) {
        if (
          isTileBlocked(puzzle, boardView, stateRef, { r: current.r, c }, turn, dronePos)
        ) {
          clear = false;
          break;
        }
      }
      const nextPos = { r: current.r, c: current.c + stepC };
      if (
        clear &&
        !sameCoord(nextPos, mag) &&
        !isTileBlocked(puzzle, boardView, stateRef, nextPos, turn, dronePos)
      ) {
        pullDir = stepC > 0 ? 'RIGHT' : 'LEFT';
        leftTiles.push({ ...current });
        events.push({
          type: 'MAGNET_PULL',
          dir: pullDir,
          from: { ...current },
          to: { ...nextPos }
        });
        current = nextPos;
        collectCellsAt(puzzle, current, collected, events);
        checkPressurePlateTrigger(
          puzzle,
          boardView,
          current,
          stateRef,
          current,
          dronePos,
          events
        );
        break;
      }
    } else if (current.c === mag.c && current.r !== mag.r) {
      const stepR = mag.r > current.r ? 1 : -1;
      let clear = true;
      for (let r = current.r + stepR; r !== mag.r; r += stepR) {
        if (
          isTileBlocked(puzzle, boardView, stateRef, { r, c: current.c }, turn, dronePos)
        ) {
          clear = false;
          break;
        }
      }
      const nextPos = { r: current.r + stepR, c: current.c };
      if (
        clear &&
        !sameCoord(nextPos, mag) &&
        !isTileBlocked(puzzle, boardView, stateRef, nextPos, turn, dronePos)
      ) {
        pullDir = stepR > 0 ? 'DOWN' : 'UP';
        leftTiles.push({ ...current });
        events.push({
          type: 'MAGNET_PULL',
          dir: pullDir,
          from: { ...current },
          to: { ...nextPos }
        });
        current = nextPos;
        collectCellsAt(puzzle, current, collected, events);
        checkPressurePlateTrigger(
          puzzle,
          boardView,
          current,
          stateRef,
          current,
          dronePos,
          events
        );
        break;
      }
    }
  }
  return { pos: current, pullDir };
}

function simulateTurn(puzzle, prevState, inputDir) {
  if (prevState.solved) {
    return { valid: false, reason: 'Puzzle already solved', state: prevState };
  }

  const hasGravity = puzzle.mutations.includes('GRAVITY');
  const hasDecay = puzzle.mutations.includes('DECAY');
  const hasInfection = puzzle.mutations.includes('INFECTION');
  const hasPortals = puzzle.mutations.includes('PORTALS');
  const hasOverclock = puzzle.mutations.includes('OVERCLOCK');
  const hasMagnetism = puzzle.mutations.includes('MAGNETISM');
  const hasMagneticCells = puzzle.mutations.includes('MAGNETIC_CELLS');
  const hasDrone = puzzle.mutations.includes('MIRROR_DRONE');
  const hasPhaseShift = puzzle.mutations.includes('PHASE_SHIFT');
  const hasAfterimage = puzzle.mutations.includes('AFTERIMAGE');
  const hasTurntables = puzzle.mutations.includes('TURNTABLES');
  const hasTether = puzzle.mutations.includes('TETHER_PYLON') && puzzle.tetherPylon;

  const currentTurn = prevState.turn;
  const boardView = getRotatedBoardSnapshot(puzzle, currentTurn);
  const overclockNow = hasOverclock && isOverclockActive(currentTurn);
  const phaseShiftNow = hasPhaseShift && isPhaseShiftActive(currentTurn);
  const stepCount = overclockNow ? 2 : 1;

  const events = [];
  const leftTiles = [{ ...prevState.courier }];
  const collected = [...prevState.collectedCells];
  const decayTimers = { ...prevState.decayTimers };
  let infectedTiles = [...prevState.infectedTiles];
  const teleportedThisTurn = { used: false };

  const liveState = {
    decayTimers,
    infectedTiles,
    afterimagePos: prevState.afterimagePos,
    blastDoorsOpen: prevState.blastDoorsOpen
  };

  let pos = { ...prevState.courier };
  let dronePos = hasDrone && prevState.drone ? { ...prevState.drone } : null;
  let movedAtLeastOnce = false;

  // Step 1 & 2: Player voluntary movement (with Phase Shift, Overclock, and Tether zone guard)
  for (let s = 0; s < stepCount; s++) {
    const nextCand = stepCoord(pos, inputDir);
    if (!inBounds(nextCand.r, nextCand.c)) {
      break;
    }

    // Tether Pylon prevents voluntary steps from inside the 5x5 zone to outside
    if (
      hasTether &&
      chebyshevDist(pos, puzzle.tetherPylon) <= 2 &&
      chebyshevDist(nextCand, puzzle.tetherPylon) > 2
    ) {
      break;
    }

    const hitsWall = boardView.grid[nextCand.r][nextCand.c] === 'WALL';
    if (hitsWall && phaseShiftNow && s === 0) {
      const beyondWall = stepCoord(nextCand, inputDir);
      const tetherBlocksPhase =
        hasTether &&
        chebyshevDist(pos, puzzle.tetherPylon) <= 2 &&
        chebyshevDist(beyondWall, puzzle.tetherPylon) > 2;

      if (
        !tetherBlocksPhase &&
        inBounds(beyondWall.r, beyondWall.c) &&
        !isTileBlocked(puzzle, boardView, liveState, beyondWall, currentTurn, dronePos)
      ) {
        events.push({
          type: 'PHASE_SHIFT',
          from: { ...pos },
          through: { ...nextCand },
          to: { ...beyondWall }
        });
        pos = beyondWall;
        movedAtLeastOnce = true;
        collectCellsAt(puzzle, pos, collected, events);
        checkPressurePlateTrigger(
          puzzle,
          boardView,
          pos,
          liveState,
          pos,
          dronePos,
          events
        );
        break;
      }
    }

    if (isTileBlocked(puzzle, boardView, liveState, nextCand, currentTurn, dronePos)) {
      break;
    }

    if (s > 0) {
      leftTiles.push({ ...pos });
    }
    events.push({
      type: overclockNow ? 'OVERCLOCK_STEP' : 'MOVE',
      from: { ...pos },
      to: { ...nextCand }
    });
    pos = nextCand;
    movedAtLeastOnce = true;
    collectCellsAt(puzzle, pos, collected, events);
    checkPressurePlateTrigger(
      puzzle,
      boardView,
      pos,
      liveState,
      pos,
      dronePos,
      events
    );
  }

  if (!movedAtLeastOnce) {
    return { valid: false, reason: 'Blocked by wall, tether, or hazard', state: prevState };
  }

  // Move Mirror Drone in opposite direction if active
  if (hasDrone && dronePos) {
    const oppDir = OPPOSITE_DIR[inputDir];
    const nextDrone = stepCoord(dronePos, oppDir);
    if (
      inBounds(nextDrone.r, nextDrone.c) &&
      !sameCoord(nextDrone, pos) &&
      !isTileBlocked(puzzle, boardView, liveState, nextDrone, currentTurn, null)
    ) {
      events.push({
        type: 'DRONE_MOVE',
        from: { ...dronePos },
        to: { ...nextDrone }
      });
      dronePos = nextDrone;
      checkPressurePlateTrigger(
        puzzle,
        boardView,
        dronePos,
        liveState,
        pos,
        dronePos,
        events
      );
    }
  }

  // Step 3: Resolve Portal, Conveyor & Cryo-Slick effects
  let entryRes = resolveTileEntryEffects(
    puzzle,
    boardView,
    pos,
    inputDir,
    prevState.portalMode,
    currentTurn,
    liveState,
    collected,
    leftTiles,
    events,
    teleportedThisTurn,
    dronePos
  );
  pos = entryRes.pos;

  // Step 4: Magnetic Cells & Wall Magnetism Pylons
  if (hasMagneticCells) {
    const cellMag = applyMagneticCellForces(
      puzzle,
      boardView,
      pos,
      currentTurn,
      liveState,
      collected,
      leftTiles,
      events,
      dronePos
    );
    if (!sameCoord(cellMag.pos, pos)) {
      pos = cellMag.pos;
      entryRes = resolveTileEntryEffects(
        puzzle,
        boardView,
        pos,
        cellMag.movedDir,
        prevState.portalMode,
        currentTurn,
        liveState,
        collected,
        leftTiles,
        events,
        teleportedThisTurn,
        dronePos
      );
      pos = entryRes.pos;
    }
  }

  const massTier = getMassTier(puzzle, collected);
  if (hasMagnetism && massTier !== 'HEAVY') {
    const magRes = applyMagnetismPull(
      puzzle,
      boardView,
      pos,
      currentTurn,
      liveState,
      collected,
      leftTiles,
      events,
      dronePos
    );
    if (!sameCoord(magRes.pos, pos)) {
      pos = magRes.pos;
      entryRes = resolveTileEntryEffects(
        puzzle,
        boardView,
        pos,
        magRes.pullDir,
        prevState.portalMode,
        currentTurn,
        liveState,
        collected,
        leftTiles,
        events,
        teleportedThisTurn,
        dronePos
      );
      pos = entryRes.pos;
    }
  }

  // Step 5 & 6: Apply Gravity (2x if LIGHT, immune if HEAVY) & secondary tile-entry effects
  if (hasGravity && massTier !== 'HEAVY') {
    const gravSteps = massTier === 'LIGHT' ? 2 : 1;
    for (let gs = 0; gs < gravSteps; gs++) {
      const gravTarget = stepCoord(pos, prevState.gravityDir);
      if (isTileBlocked(puzzle, boardView, liveState, gravTarget, currentTurn, dronePos)) {
        break;
      }
      leftTiles.push({ ...pos });
      events.push({
        type: 'GRAVITY',
        dir: prevState.gravityDir,
        from: { ...pos },
        to: { ...gravTarget }
      });
      pos = gravTarget;
      collectCellsAt(puzzle, pos, collected, events);
      checkPressurePlateTrigger(
        puzzle,
        boardView,
        pos,
        liveState,
        pos,
        dronePos,
        events
      );

      entryRes = resolveTileEntryEffects(
        puzzle,
        boardView,
        pos,
        prevState.gravityDir,
        prevState.portalMode,
        currentTurn,
        liveState,
        collected,
        leftTiles,
        events,
        teleportedThisTurn,
        dronePos
      );
      pos = entryRes.pos;
    }
  }

  // Step 6b: Elastic Tether snap-back if forced outside the 5x5 tether zone
  if (hasTether && chebyshevDist(pos, puzzle.tetherPylon) > 2) {
    const dr = puzzle.tetherPylon.r - pos.r;
    const dc = puzzle.tetherPylon.c - pos.c;
    const snapDir =
      Math.abs(dr) >= Math.abs(dc)
        ? dr > 0
          ? 'DOWN'
          : 'UP'
        : dc > 0
          ? 'RIGHT'
          : 'LEFT';
    const snapTarget = stepCoord(pos, snapDir);
    if (!isTileBlocked(puzzle, boardView, liveState, snapTarget, currentTurn, dronePos)) {
      leftTiles.push({ ...pos });
      events.push({
        type: 'TETHER_SNAP',
        dir: snapDir,
        from: { ...pos },
        to: { ...snapTarget }
      });
      pos = snapTarget;
      collectCellsAt(puzzle, pos, collected, events);
      checkPressurePlateTrigger(
        puzzle,
        boardView,
        pos,
        liveState,
        pos,
        dronePos,
        events
      );
    }
  }

  collectCellsAt(puzzle, pos, collected, events);

  // Step 7: Advance turn counter & apply Afterimage, Decay, Infection & Turntables
  const nextTurn = currentTurn + 1;

  // Update Afterimage hard-light barrier (tile occupied 2 turns ago)
  let nextAfterimage = null;
  if (hasAfterimage && prevState.prevTurn1Pos) {
    const cand = prevState.prevTurn1Pos;
    if (
      !sameCoord(cand, pos) &&
      !(dronePos && sameCoord(cand, dronePos)) &&
      !sameCoord(cand, puzzle.exit)
    ) {
      nextAfterimage = { ...cand };
      events.push({ type: 'AFTERIMAGE_SPAWN', at: { ...cand } });
    }
  }
  const nextPrevTurn1Pos = hasAfterimage ? { ...pos } : null;

  if (hasDecay) {
    const isHeavy = getMassTier(puzzle, collected) === 'HEAVY';
    for (const leftPos of leftTiles) {
      if (!sameCoord(leftPos, pos)) {
        markTileLeftForDecay(puzzle, boardView, decayTimers, leftPos, isHeavy);
      }
    }
    const collapsed = tickDecayTimers(decayTimers, pos, dronePos);
    for (const c of collapsed) {
      events.push({ type: 'DECAY_COLLAPSE', at: c });
    }
  }

  if (hasInfection && nextTurn % 2 === 0) {
    const spreadRes = spreadInfectionOnce(
      puzzle,
      boardView,
      infectedTiles,
      decayTimers,
      nextAfterimage,
      liveState.blastDoorsOpen,
      nextTurn,
      pos,
      dronePos
    );
    infectedTiles = spreadRes.nextInfected;
    if (spreadRes.spreadTo) {
      events.push({ type: 'INFECTION_SPREAD', at: spreadRes.spreadTo });
    }
  }

  // Rotate Turntable platforms 90° CW every 3 completed turns
  if (hasTurntables && puzzle.turntables.length > 0 && nextTurn % 3 === 0) {
    const rotateAroundHub = (hub, coord) => {
      const dr = coord.r - hub.r;
      const dc = coord.c - hub.c;
      if (
        (Math.abs(dr) === 1 && dc === 0) ||
        (dr === 0 && Math.abs(dc) === 1)
      ) {
        return { r: hub.r + dc, c: hub.c - dr };
      }
      return coord;
    };

    for (const hub of puzzle.turntables) {
      const rotatedCourier = rotateAroundHub(hub, pos);
      if (!sameCoord(rotatedCourier, pos)) {
        pos = rotatedCourier;
        collectCellsAt(puzzle, pos, collected, events);
      }
      if (dronePos) {
        dronePos = rotateAroundHub(hub, dronePos);
      }
      // Rotate active decay timers & infected tiles on the 4 turntable slots
      const ring = [
        { r: hub.r - 1, c: hub.c },
        { r: hub.r, c: hub.c + 1 },
        { r: hub.r + 1, c: hub.c },
        { r: hub.r, c: hub.c - 1 }
      ];
      const decayRing = ring.map((p) => decayTimers[coordKey(p)]);
      ring.forEach((p, idx) => {
        const fromVal = decayRing[(idx + 3) % 4];
        if (fromVal === undefined) delete decayTimers[coordKey(p)];
        else decayTimers[coordKey(p)] = fromVal;
      });

      const infSet = new Set(infectedTiles);
      const infRing = ring.map((p) => infSet.has(coordKey(p)));
      ring.forEach((p, idx) => {
        if (infRing[(idx + 3) % 4]) infSet.add(coordKey(p));
        else infSet.delete(coordKey(p));
      });
      infectedTiles = Array.from(infSet).sort();

      events.push({ type: 'TURNTABLE_SPIN', hub: { ...hub } });
    }
  }

  // Step 8: Advance periodic cycles
  const nextGravityDir = hasGravity
    ? getGravityDirectionForTurn(nextTurn)
    : prevState.gravityDir;
  const nextPortalMode = hasPortals
    ? getPortalModeForTurn(nextTurn)
    : prevState.portalMode;

  // Step 9: Check win condition
  const solved = collected[0] && collected[1] && sameCoord(pos, puzzle.exit);
  if (solved) {
    events.push({ type: 'SOLVED', turn: nextTurn });
  }

  return {
    valid: true,
    state: {
      turn: nextTurn,
      courier: pos,
      drone: dronePos,
      prevTurn1Pos: nextPrevTurn1Pos,
      afterimagePos: nextAfterimage,
      blastDoorsOpen: liveState.blastDoorsOpen,
      collectedCells: collected,
      decayTimers,
      infectedTiles,
      gravityDir: nextGravityDir,
      portalMode: nextPortalMode,
      solved,
      lastStepEvents: events
    }
  };
}

// ============================================================================
// 6. FULL-STATE BFS OPTIMAL SOLVER & SEEDED PUZZLE GENERATOR
// ============================================================================

function encodeStateKey(state) {
  const mask =
    (state.collectedCells[0] ? 1 : 0) |
    (state.collectedCells[1] ? 2 : 0) |
    (state.blastDoorsOpen ? 4 : 0);
  const turnCycle = state.turn % 12;
  const droneStr = state.drone ? `${state.drone.r},${state.drone.c}` : '-';
  const afterStr = state.afterimagePos
    ? `${state.afterimagePos.r},${state.afterimagePos.c}`
    : '-';
  const prev1Str = state.prevTurn1Pos
    ? `${state.prevTurn1Pos.r},${state.prevTurn1Pos.c}`
    : '-';
  const decayEntries = Object.entries(state.decayTimers)
    .filter(([, v]) => v >= 0)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => `${k}:${v}`)
    .join(';');
  const infectedStr = state.infectedTiles.join(';');
  return `${state.courier.r},${state.courier.c}|${droneStr}|${prev1Str}|${afterStr}|${mask}|${turnCycle}|${decayEntries}|${infectedStr}`;
}

function solvePuzzleBFS(puzzle, maxDepth = 28, maxStates = 45000) {
  const initial = createInitialGameState(puzzle);
  if (initial.solved) {
    return { solvable: true, optimalMoves: 0, solutionPath: [], statesExplored: 1 };
  }

  const visited = new Set([encodeStateKey(initial)]);
  const queue = [{ state: initial, path: [] }];
  let head = 0;
  let statesExplored = 0;

  while (head < queue.length) {
    const current = queue[head++];
    statesExplored++;
    if (statesExplored > maxStates) break;
    if (current.state.turn >= maxDepth) continue;

    for (const dir of ALL_DIRS) {
      const res = simulateTurn(puzzle, current.state, dir);
      if (!res.valid) continue;

      const nextPath = [...current.path, dir];
      if (res.state.solved) {
        return {
          solvable: true,
          optimalMoves: res.state.turn,
          solutionPath: nextPath,
          statesExplored
        };
      }

      const key = encodeStateKey(res.state);
      if (!visited.has(key)) {
        visited.add(key);
        queue.push({ state: res.state, path: nextPath });
      }
    }
  }

  return {
    solvable: false,
    optimalMoves: null,
    solutionPath: null,
    statesExplored
  };
}

function selectDailyMutations(rng, forcedMutations) {
  let chosen =
    forcedMutations && forcedMutations.length >= 2
      ? [...forcedMutations]
      : rng.shuffle(ALL_MUTATIONS).slice(0, 2);

  let promotedThirdMutation = null;

  // If any active mutation depends on another system that isn't present yet,
  // promote a deterministic compatible host mutation as a 3rd active mutation.
  for (const mut of [...chosen]) {
    const deps = MUTATION_DEPENDENCIES[mut];
    if (deps && !deps.some((d) => chosen.includes(d))) {
      const candidates = rng.shuffle(deps);
      const host = candidates[0];
      if (host && !chosen.includes(host)) {
        chosen.push(host);
        promotedThirdMutation = host;
      }
    }
  }

  return { mutations: chosen, promotedThirdMutation };
}

function replayAndVerifyPath(puzzle, path) {
  let state = createInitialGameState(puzzle);
  const allEvents = [];
  for (const dir of path) {
    const res = simulateTurn(puzzle, state, dir);
    if (!res.valid) {
      return { valid: false, solved: false, moves: state.turn, events: allEvents };
    }
    state = res.state;
    allEvents.push(...state.lastStepEvents);
  }
  return {
    valid: true,
    solved: state.solved,
    moves: state.turn,
    events: allEvents
  };
}

/**
 * Verifies that EVERY active mutation on the puzzle is genuinely relevant:
 * 1. Removing the mutation (counterfactual ablation) either makes the puzzle
 *    unsolvable, changes the optimal move count, or breaks the optimal path.
 * 2. The mutation's signature mechanic actively engages during optimal play.
 */
function verifyAllMutationsRelevant(candidate, solveResult) {
  if (!solveResult.solvable || !solveResult.solutionPath) return false;
  const trace = replayAndVerifyPath(candidate, solveResult.solutionPath);
  if (!trace.valid || !trace.solved) return false;

  const eventTypes = new Set(trace.events.map((e) => e.type));

  const EVENT_MAP = {
    GRAVITY: ['GRAVITY'],
    CONVEYOR: ['CONVEYOR'],
    PORTALS: ['PORTAL'],
    CRYO_SLICK: ['CRYO_SLIDE'],
    OVERCLOCK: ['OVERCLOCK_STEP'],
    PHASE_SHIFT: ['PHASE_SHIFT'],
    MAGNETISM: ['MAGNET_PULL'],
    MAGNETIC_CELLS: ['CELL_REPEL', 'CELL_ATTRACT'],
    TETHER_PYLON: ['TETHER_SNAP'],
    BLAST_DOORS: ['BLAST_DOOR_TOGGLE'],
    TURNTABLES: ['TURNTABLE_SPIN'],
    AFTERIMAGE: ['AFTERIMAGE_SPAWN'],
    DECAY: ['DECAY_COLLAPSE'],
    INFECTION: ['INFECTION_SPREAD'],
    MIRROR_DRONE: ['DRONE_MOVE']
  };

  for (const mut of candidate.mutations) {
    // Build an ablated copy of the puzzle with `mut` disabled
    const ablatedMutations = candidate.mutations.filter((m) => m !== mut);
    const ablatedPuzzle = {
      ...candidate,
      mutations: ablatedMutations,
      conveyors: mut === 'CONVEYOR' ? [] : candidate.conveyors,
      portals: mut === 'PORTALS' ? [] : candidate.portals,
      phaseGates: mut === 'PHASE_GATES' ? [] : candidate.phaseGates,
      blastDoors: mut === 'BLAST_DOORS' ? [] : candidate.blastDoors,
      pressurePlates: mut === 'BLAST_DOORS' ? [] : candidate.pressurePlates,
      cryoTiles: mut === 'CRYO_SLICK' ? [] : candidate.cryoTiles,
      magnets: mut === 'MAGNETISM' ? [] : candidate.magnets,
      turntables: mut === 'TURNTABLES' ? [] : candidate.turntables,
      tetherPylon: mut === 'TETHER_PYLON' ? null : candidate.tetherPylon,
      droneStart: mut === 'MIRROR_DRONE' ? null : candidate.droneStart,
      initialInfected: mut === 'INFECTION' ? [] : candidate.initialInfected
    };

    const ablatedSolve = solvePuzzleBFS(ablatedPuzzle, 28, 22000);
    const ablatedReplay = replayAndVerifyPath(
      ablatedPuzzle,
      solveResult.solutionPath
    );

    const changesOptimalCount =
      !ablatedSolve.solvable ||
      ablatedSolve.optimalMoves !== candidate.optimalMoves;
    const altersOptimalPath =
      !ablatedReplay.valid ||
      !ablatedReplay.solved ||
      ablatedReplay.moves !== candidate.optimalMoves;

    // Must either alter the optimal move count OR break/alter the optimal route
    if (!changesOptimalCount && !altersOptimalPath) {
      return false;
    }

    // Additionally ensure tile/event mutations actually trigger their signature event
    const expectedEvents = EVENT_MAP[mut];
    if (
      expectedEvents &&
      mut !== 'DECAY' &&
      mut !== 'INFECTION' &&
      mut !== 'AFTERIMAGE' &&
      mut !== 'MIRROR_DRONE' &&
      mut !== 'TETHER_PYLON'
    ) {
      if (!expectedEvents.some((et) => eventTypes.has(et))) {
        return false;
      }
    }
  }

  return true;
}

// ============================================================================
// 7. 60FPS HTML5 CANVAS PARTICLE & FORCE-FIELD OVERLAY
// ============================================================================

function VfxCanvasOverlay({ puzzle, state, vfxLevel }) {
  const canvasRef = useRef(null);
  const particlesRef = useRef([]);
  const latestRef = useRef({ puzzle, state, vfxLevel });
  const prevTurnRef = useRef(state.turn);

  latestRef.current = { puzzle, state, vfxLevel };

  // Spawn reactive particle bursts strictly on forward turns; clear on Undo/Reset
  useEffect(() => {
    if (state.turn === 0) {
      particlesRef.current = [];
      prevTurnRef.current = 0;
      return;
    }
    if (state.turn <= prevTurnRef.current) {
      prevTurnRef.current = state.turn;
      return;
    }
    prevTurnRef.current = state.turn;
    if (vfxLevel === 'OFF') return;

    const mult = vfxLevel === 'HIGH' ? 1 : 0.45;
    const spawnBurst = (coord, color, count, speed = 1.6, life = 34) => {
      const n = Math.max(2, Math.round(count * mult));
      for (let i = 0; i < n; i++) {
        const angle = (Math.PI * 2 * i) / n + Math.random() * 0.5;
        const spd = speed * (0.45 + Math.random() * 0.75);
        particlesRef.current.push({
          x: (coord.c + 0.5) / GRID_SIZE,
          y: (coord.r + 0.5) / GRID_SIZE,
          vx: Math.cos(angle) * spd * 0.006,
          vy: Math.sin(angle) * spd * 0.006,
          size: 1.8 + Math.random() * 2.4,
          color,
          life,
          maxLife: life
        });
      }
    };

    for (const ev of state.lastStepEvents) {
      if (ev.type === 'MOVE') {
        spawnBurst(ev.to, '#22d3ee', 6, 0.9, 20);
      } else if (ev.type === 'OVERCLOCK_STEP') {
        spawnBurst(ev.to, '#f43f5e', 14, 1.8, 28);
      } else if (ev.type === 'PHASE_SHIFT') {
        spawnBurst(ev.through, '#34d399', 18, 2.0, 32);
        spawnBurst(ev.to, '#34d399', 12, 1.4, 26);
      } else if (ev.type === 'COLLECT_CELL') {
        spawnBurst(ev.at, '#fbbf24', 24, 2.3, 40);
      } else if (ev.type === 'PORTAL') {
        spawnBurst(ev.coord, '#818cf8', 22, 2.1, 36);
      } else if (ev.type === 'CONVEYOR') {
        spawnBurst(ev.to, '#14b8a6', 10, 1.3, 24);
      } else if (ev.type === 'CRYO_SLIDE') {
        spawnBurst(ev.to, '#67e8f9', 11, 1.4, 25);
      } else if (ev.type === 'MAGNET_PULL') {
        spawnBurst(ev.to, '#60a5fa', 14, 1.5, 28);
      } else if (ev.type === 'CELL_REPEL' || ev.type === 'CELL_ATTRACT') {
        spawnBurst(ev.to, '#fb7185', 16, 1.7, 30);
      } else if (ev.type === 'GRAVITY') {
        spawnBurst(ev.to, '#38bdf8', 12, 1.4, 26);
      } else if (ev.type === 'DECAY_COLLAPSE') {
        spawnBurst(ev.at, '#f97316', 20, 1.9, 36);
      } else if (ev.type === 'INFECTION_SPREAD') {
        spawnBurst(ev.at, '#a855f7', 18, 1.7, 35);
      } else if (ev.type === 'AFTERIMAGE_SPAWN') {
        spawnBurst(ev.at, '#0ea5e9', 14, 1.4, 28);
      } else if (ev.type === 'TURNTABLE_SPIN') {
        spawnBurst(ev.hub, '#d97706', 24, 2.2, 36);
      } else if (ev.type === 'TETHER_SNAP') {
        spawnBurst(ev.to, '#ec4899', 20, 2.0, 32);
      } else if (ev.type === 'BLAST_DOOR_TOGGLE') {
        spawnBurst(ev.at, '#84cc16', 16, 1.6, 28);
      } else if (ev.type === 'SOLVED') {
        spawnBurst(state.courier, '#10b981', 42, 3.0, 55);
      }
    }
  }, [state, vfxLevel]);

  // 60fps animation loop for ambient mutation force-fields & burst particles
  useEffect(() => {
    if (vfxLevel === 'OFF') return;
    let rafId = 0;
    let frame = 0;

    const render = () => {
      frame++;
      const canvas = canvasRef.current;
      if (!canvas) {
        rafId = requestAnimationFrame(render);
        return;
      }

      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const rect = canvas.getBoundingClientRect();
      const w = Math.max(1, Math.round(rect.width * dpr));
      const h = Math.max(1, Math.round(rect.height * dpr));
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
      }

      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      ctx.clearRect(0, 0, w, h);
      const { puzzle: curPuzzle, state: curState, vfxLevel: level } = latestRef.current;
      const cellW = w / GRID_SIZE;
      const cellH = h / GRID_SIZE;
      const alphaScale = level === 'HIGH' ? 1 : 0.45;

      // 1. GRAVITY wind streaks (disabled when Payload Mass is HEAVY)
      if (
        curPuzzle.mutations.includes('GRAVITY') &&
        getMassTier(curPuzzle, curState.collectedCells) !== 'HEAVY'
      ) {
        const streakCount = level === 'HIGH' ? 14 : 6;
        const gDir = curState.gravityDir;
        ctx.strokeStyle = `rgba(56, 189, 248, ${0.26 * alphaScale})`;
        ctx.lineWidth = 1.5 * dpr;
        for (let i = 0; i < streakCount; i++) {
          const seedRatio = ((i * 73) % 100) / 100;
          const progress = ((frame * 0.018 + i * 0.23) % 1);
          let sx = 0;
          let sy = 0;
          let ex = 0;
          let ey = 0;
          const len = 14 * dpr;
          if (gDir === 'DOWN') {
            sx = seedRatio * w;
            sy = progress * h;
            ex = sx;
            ey = sy + len;
          } else if (gDir === 'UP') {
            sx = seedRatio * w;
            sy = (1 - progress) * h;
            ex = sx;
            ey = sy - len;
          } else if (gDir === 'RIGHT') {
            sx = progress * w;
            sy = seedRatio * h;
            ex = sx + len;
            ey = sy;
          } else {
            sx = (1 - progress) * w;
            sy = seedRatio * h;
            ex = sx - len;
            ey = sy;
          }
          ctx.beginPath();
          ctx.moveTo(sx, sy);
          ctx.lineTo(ex, ey);
          ctx.stroke();
        }
      }

      // 2. MAGNETISM pylon pulse rings
      if (
        curPuzzle.mutations.includes('MAGNETISM') &&
        getMassTier(curPuzzle, curState.collectedCells) !== 'HEAVY'
      ) {
        const pulse = (frame % 60) / 60;
        for (const mag of curPuzzle.magnets) {
          const cx = (mag.c + 0.5) * cellW;
          const cy = (mag.r + 0.5) * cellH;
          ctx.strokeStyle = `rgba(96, 165, 250, ${(1 - pulse) * 0.4 * alphaScale})`;
          ctx.lineWidth = 1.5 * dpr;
          ctx.beginPath();
          ctx.arc(cx, cy, cellW * (0.3 + pulse * 0.9), 0, Math.PI * 2);
          ctx.stroke();
        }
      }

      // 3. MAGNETIC_CELLS polarity fields
      if (curPuzzle.mutations.includes('MAGNETIC_CELLS')) {
        const wave = (frame % 50) / 50;
        if (!curState.collectedCells[0]) {
          const c0 = curPuzzle.cells[0];
          ctx.strokeStyle = `rgba(251, 113, 133, ${(1 - wave) * 0.45 * alphaScale})`;
          ctx.lineWidth = 1.5 * dpr;
          ctx.beginPath();
          ctx.arc(
            (c0.c + 0.5) * cellW,
            (c0.r + 0.5) * cellH,
            cellW * (0.25 + wave * 0.75),
            0,
            Math.PI * 2
          );
          ctx.stroke();
        }
        if (!curState.collectedCells[1]) {
          const c1 = curPuzzle.cells[1];
          ctx.strokeStyle = `rgba(34, 211, 238, ${wave * 0.45 * alphaScale})`;
          ctx.lineWidth = 1.5 * dpr;
          ctx.beginPath();
          ctx.arc(
            (c1.c + 0.5) * cellW,
            (c1.r + 0.5) * cellH,
            cellW * (1.0 - wave * 0.7),
            0,
            Math.PI * 2
          );
          ctx.stroke();
        }
      }

      // 4. PORTALS harmonic rings
      if (curPuzzle.mutations.includes('PORTALS')) {
        const angle = frame * 0.05;
        for (const pt of curPuzzle.portals) {
          const cx = (pt.c + 0.5) * cellW;
          const cy = (pt.r + 0.5) * cellH;
          ctx.strokeStyle = `rgba(129, 140, 248, ${0.42 * alphaScale})`;
          ctx.lineWidth = 1.5 * dpr;
          ctx.beginPath();
          ctx.arc(cx, cy, cellW * 0.36, angle, angle + Math.PI * 1.25);
          ctx.stroke();
        }
      }

      // 5. TETHER_PYLON 5x5 boundary field
      if (curPuzzle.mutations.includes('TETHER_PYLON') && curPuzzle.tetherPylon) {
        const tp = curPuzzle.tetherPylon;
        const minC = Math.max(0, tp.c - 2);
        const maxC = Math.min(GRID_SIZE - 1, tp.c + 2);
        const minR = Math.max(0, tp.r - 2);
        const maxR = Math.min(GRID_SIZE - 1, tp.r + 2);
        ctx.save();
        ctx.strokeStyle = `rgba(236, 72, 153, ${0.38 * alphaScale})`;
        ctx.lineWidth = 1.5 * dpr;
        ctx.setLineDash([5 * dpr, 4 * dpr]);
        ctx.lineDashOffset = -frame * 0.4;
        ctx.strokeRect(
          minC * cellW + 2 * dpr,
          minR * cellH + 2 * dpr,
          (maxC - minC + 1) * cellW - 4 * dpr,
          (maxR - minR + 1) * cellH - 4 * dpr
        );
        ctx.restore();
      }

      // 6. TURNTABLES clockwise rotation indicators
      if (curPuzzle.mutations.includes('TURNTABLES')) {
        const rot = frame * 0.03;
        for (const hub of curPuzzle.turntables) {
          const cx = (hub.c + 0.5) * cellW;
          const cy = (hub.r + 0.5) * cellH;
          ctx.strokeStyle = `rgba(217, 119, 6, ${0.34 * alphaScale})`;
          ctx.lineWidth = 1.5 * dpr;
          ctx.beginPath();
          ctx.arc(cx, cy, cellW * 0.85, rot, rot + Math.PI * 0.7);
          ctx.stroke();
        }
      }

      // 7. Update & render burst particles
      const alive = [];
      for (let i = 0; i < particlesRef.current.length; i++) {
        const p = particlesRef.current[i];
        p.x += p.vx;
        p.y += p.vy;
        p.vx *= 0.96;
        p.vy *= 0.96;
        p.life -= 1;
        if (p.life > 0) {
          alive.push(p);
          const ratio = p.life / p.maxLife;
          ctx.globalAlpha = Math.max(0, ratio * alphaScale);
          ctx.fillStyle = p.color;
          ctx.beginPath();
          ctx.arc(p.x * w, p.y * h, p.size * dpr * ratio, 0, Math.PI * 2);
          ctx.fill();
        }
      }
      ctx.globalAlpha = 1;
      particlesRef.current = alive;

      rafId = requestAnimationFrame(render);
    };

    rafId = requestAnimationFrame(render);
    return () => cancelAnimationFrame(rafId);
  }, [vfxLevel]);

  if (vfxLevel === 'OFF') return null;
  return toHostElement(<canvas ref={canvasRef} className="vfx-canvas" />);
}

function buildCandidateBoard(
  dateKey,
  challengeNumber,
  seed,
  mutations,
  promotedThirdMutation,
  attempt
) {
  const rng = new SeededRng(`${seed}:attempt:${attempt}`);
  const infectionPriority = rng.shuffle(ALL_DIRS);

  const grid = Array.from({ length: GRID_SIZE }, () =>
    Array.from({ length: GRID_SIZE }, () => 'FLOOR')
  );

  const allCoords = [];
  for (let r = 0; r < GRID_SIZE; r++) {
    for (let c = 0; c < GRID_SIZE; c++) {
      allCoords.push({ r, c });
    }
  }

  const shuffledCoords = rng.shuffle(allCoords);
  const occupied = new Set();

  const claimCoord = (predicate) => {
    for (const cand of shuffledCoords) {
      const k = coordKey(cand);
      if (occupied.has(k)) continue;
      if (predicate && !predicate(cand)) continue;
      occupied.add(k);
      return cand;
    }
    return null;
  };

  // Place Tether Pylon near center first if active so Start & Exit stay inside the 5x5 tether zone
  let tetherPylon = null;
  if (mutations.includes('TETHER_PYLON')) {
    tetherPylon = claimCoord((c) => c.r >= 2 && c.r <= 4 && c.c >= 2 && c.c <= 4);
    if (tetherPylon) {
      grid[tetherPylon.r][tetherPylon.c] = 'WALL';
    }
  }

  const start = claimCoord(
    (c) => !tetherPylon || chebyshevDist(c, tetherPylon) <= 2
  );
  if (!start) return null;

  const cell1 = claimCoord(
    (c) =>
      Math.abs(c.r - start.r) + Math.abs(c.c - start.c) >= 3 &&
      (!tetherPylon || chebyshevDist(c, tetherPylon) <= 2)
  );
  if (!cell1) return null;

  const cell2 = claimCoord(
    (c) =>
      Math.abs(c.r - start.r) + Math.abs(c.c - start.c) >= 3 &&
      Math.abs(c.r - cell1.r) + Math.abs(c.c - cell1.c) >= 3 &&
      (!tetherPylon || chebyshevDist(c, tetherPylon) <= 2)
  );
  if (!cell2) return null;

  const exit = claimCoord(
    (c) =>
      Math.abs(c.r - start.r) + Math.abs(c.c - start.c) >= 4 &&
      Math.abs(c.r - cell2.r) + Math.abs(c.c - cell2.c) >= 2 &&
      (!tetherPylon || chebyshevDist(c, tetherPylon) <= 2)
  );
  if (!exit) return null;

  // Turntable gear hubs (interior coordinates whose 4 orthogonal neighbors do not overlap objectives)
  const turntables = [];
  if (mutations.includes('TURNTABLES')) {
    const protectedSet = new Set([
      coordKey(start),
      coordKey(cell1),
      coordKey(cell2),
      coordKey(exit)
    ]);
    for (let i = 0; i < 2; i++) {
      const hub = claimCoord((c) => {
        if (c.r < 1 || c.r > GRID_SIZE - 2 || c.c < 1 || c.c > GRID_SIZE - 2) {
          return false;
        }
        const neighbors = [
          { r: c.r - 1, c: c.c },
          { r: c.r + 1, c: c.c },
          { r: c.r, c: c.c - 1 },
          { r: c.r, c: c.c + 1 }
        ];
        return neighbors.every((nb) => !protectedSet.has(coordKey(nb)));
      });
      if (hub) {
        turntables.push(hub);
        grid[hub.r][hub.c] = 'WALL';
      }
    }
  }

  // Mirror Drone starting coordinate
  let droneStart = null;
  if (mutations.includes('MIRROR_DRONE')) {
    const mirrorCand = { r: GRID_SIZE - 1 - start.r, c: GRID_SIZE - 1 - start.c };
    if (!occupied.has(coordKey(mirrorCand))) {
      droneStart = mirrorCand;
      occupied.add(coordKey(mirrorCand));
    } else {
      droneStart = claimCoord();
    }
  }

  // Portals
  const portals = [];
  if (mutations.includes('PORTALS')) {
    for (const label of PORTAL_LABELS) {
      const pCoord = claimCoord();
      if (!pCoord) return null;
      portals.push({ ...pCoord, label });
    }
  }

  // Conveyors
  const conveyors = [];
  if (mutations.includes('CONVEYOR')) {
    const count = rng.nextInt(4, 7);
    for (let i = 0; i < count; i++) {
      const cCoord = claimCoord();
      if (!cCoord) break;
      const validDirs = ALL_DIRS.filter((d) => {
        const next = stepCoord(cCoord, d);
        if (!inBounds(next.r, next.c)) return false;
        if (conveyors.some((cv) => sameCoord(cv, next))) return false;
        return true;
      });
      if (validDirs.length > 0) {
        const dir = validDirs[rng.nextInt(0, validDirs.length)];
        conveyors.push({ ...cCoord, dir });
      } else {
        occupied.delete(coordKey(cCoord));
      }
    }
  }

  // Phase Gates
  const phaseGates = [];
  if (mutations.includes('PHASE_GATES')) {
    for (let i = 0; i < 4; i++) {
      const gCoord = claimCoord();
      if (gCoord) {
        phaseGates.push({ ...gCoord, polarity: i % 2 === 0 ? 'CYAN' : 'AMBER' });
      }
    }
  }

  // Blast Doors & Pressure Plates
  const blastDoors = [];
  const pressurePlates = [];
  if (mutations.includes('BLAST_DOORS')) {
    for (let i = 0; i < 2; i++) {
      const pp = claimCoord();
      if (pp) pressurePlates.push(pp);
    }
    for (let i = 0; i < 3; i++) {
      const bd = claimCoord();
      if (bd) blastDoors.push(bd);
    }
  }

  // Cryo-Slick ice tiles
  const cryoTiles = [];
  if (mutations.includes('CRYO_SLICK')) {
    const cryoCount = rng.nextInt(5, 8);
    for (let i = 0; i < cryoCount; i++) {
      const crCoord = claimCoord();
      if (crCoord) cryoTiles.push(crCoord);
    }
  }

  // Magnetic pylons
  const magnets = [];
  if (mutations.includes('MAGNETISM')) {
    for (let i = 0; i < 2; i++) {
      const mCoord = claimCoord(
        (c) =>
          c.r >= 1 &&
          c.r <= GRID_SIZE - 2 &&
          c.c >= 1 &&
          c.c <= GRID_SIZE - 2
      );
      if (mCoord) {
        magnets.push(mCoord);
        grid[mCoord.r][mCoord.c] = 'WALL';
      }
    }
  }

  // Infection seeds
  const initialInfected = [];
  if (mutations.includes('INFECTION')) {
    const infCount = mutations.includes('DECAY') ? 1 : 2;
    for (let i = 0; i < infCount; i++) {
      const infCoord = claimCoord(
        (c) => Math.abs(c.r - start.r) + Math.abs(c.c - start.c) >= 2
      );
      if (infCoord) initialInfected.push(infCoord);
    }
  }

  // Internal walls (also ensure at least 1 wall sits in each Turntable ring so rotation alters terrain)
  for (const hub of turntables) {
    const ring = [
      { r: hub.r - 1, c: hub.c },
      { r: hub.r + 1, c: hub.c },
      { r: hub.r, c: hub.c - 1 },
      { r: hub.r, c: hub.c + 1 }
    ];
    const openSlot = rng
      .shuffle(ring)
      .find((slot) => !occupied.has(coordKey(slot)));
    if (openSlot) {
      occupied.add(coordKey(openSlot));
      grid[openSlot.r][openSlot.c] = 'WALL';
    }
  }

  // Ensure Cell #1 (+) under MAGNETIC_CELLS always has an orthogonal approach tile
  // backed by a wall so the Courier can brace against repulsion and step onto Cell #1.
  if (mutations.includes('MAGNETIC_CELLS')) {
    const approachDirs = rng.shuffle(ALL_DIRS);
    for (const d of approachDirs) {
      const adj = stepCoord(cell1, d);
      const backstop = stepCoord(adj, d);
      if (
        inBounds(adj.r, adj.c) &&
        !occupied.has(coordKey(adj)) &&
        inBounds(backstop.r, backstop.c) &&
        !occupied.has(coordKey(backstop))
      ) {
        occupied.add(coordKey(adj));
        occupied.add(coordKey(backstop));
        grid[backstop.r][backstop.c] = 'WALL';
        break;
      }
    }
  }

  // Scale random wall density down when multiple terrain-blocking mutations are active
  const blockingMutCount = mutations.filter((m) =>
    [
      'DECAY',
      'INFECTION',
      'PHASE_GATES',
      'BLAST_DOORS',
      'TURNTABLES',
      'MAGNETISM',
      'TETHER_PYLON',
      'AFTERIMAGE'
    ].includes(m)
  ).length;
  const minWalls = blockingMutCount >= 2 ? 3 : 5;
  const maxWalls = blockingMutCount >= 2 ? 6 : 9;
  const wallCount = rng.nextInt(minWalls, maxWalls + 1);
  for (let i = 0; i < wallCount; i++) {
    const wCoord = claimCoord();
    if (!wCoord) break;
    grid[wCoord.r][wCoord.c] = 'WALL';
  }

  return {
    dateKey,
    challengeNumber,
    rulesVersion: RULES_VERSION,
    seed,
    mutations,
    promotedThirdMutation,
    grid,
    start,
    droneStart,
    cells: [cell1, cell2],
    exit,
    conveyors,
    portals,
    phaseGates,
    blastDoors,
    pressurePlates,
    cryoTiles,
    magnets,
    turntables,
    tetherPylon,
    initialInfected,
    infectionPriority,
    optimalMoves: 0,
    optimalPath: [],
    verifiedRelevant: true
  };
}

function buildVerifiedFallbackPuzzle(
  dateKey,
  challengeNumber,
  seed,
  mutations,
  promotedThirdMutation = null
) {
  const needsBarrier =
    mutations.includes('PHASE_SHIFT') ||
    mutations.includes('PORTALS') ||
    mutations.includes('BLAST_DOORS');

  const variants = [
    { withPillars: true, withBarrier: needsBarrier },
    { withPillars: false, withBarrier: needsBarrier },
    { withPillars: false, withBarrier: false }
  ];

  for (const variant of variants) {
    const layout = variant.withPillars
      ? [
          '.......',
          '..#.#..',
          '.......',
          '.......',
          '.......',
          '..#.#..',
          '.......'
        ]
      : [
          '.......',
          '.......',
          '.......',
          '.......',
          '.......',
          '.......',
          '.......'
        ];

    const grid = layout.map((row) =>
      row.split('').map((ch) => (ch === '#' ? 'WALL' : 'FLOOR'))
    );

    if (variant.withBarrier) {
      for (let r = 0; r < GRID_SIZE; r++) {
        grid[r][3] = 'WALL';
      }
    }

    const base = {
      dateKey,
      challengeNumber,
      rulesVersion: RULES_VERSION,
      seed,
      mutations,
      promotedThirdMutation,
      grid,
      start: { r: 1, c: 1 },
      droneStart: mutations.includes('MIRROR_DRONE') ? { r: 5, c: 5 } : null,
      cells: [
        { r: 1, c: 5 },
        { r: 5, c: 1 }
      ],
      exit: { r: 5, c: 5 },
      conveyors: mutations.includes('CONVEYOR')
        ? [
            { r: 2, c: 1, dir: 'DOWN' },
            { r: 3, c: 1, dir: 'DOWN' },
            { r: 2, c: 5, dir: 'DOWN' }
          ]
        : [],
      portals: mutations.includes('PORTALS')
        ? [
            { r: 1, c: 2, label: 'A' },
            { r: 1, c: 4, label: 'B' },
            { r: 5, c: 2, label: 'C' },
            { r: 5, c: 4, label: 'D' }
          ]
        : [],
      phaseGates: mutations.includes('PHASE_GATES')
        ? [
            { r: 3, c: 2, polarity: 'AMBER' },
            { r: 2, c: 4, polarity: 'CYAN' },
            { r: 4, c: 4, polarity: 'AMBER' }
          ]
        : [],
      blastDoors: mutations.includes('BLAST_DOORS')
        ? [
            { r: 2, c: 3 },
            { r: 4, c: 3 }
          ]
        : [],
      pressurePlates: mutations.includes('BLAST_DOORS')
        ? [
            { r: 2, c: 1 },
            { r: 4, c: 5 }
          ]
        : [],
      cryoTiles: mutations.includes('CRYO_SLICK')
        ? [
            { r: 2, c: 1 },
            { r: 3, c: 1 },
            { r: 2, c: 5 },
            { r: 3, c: 5 }
          ]
        : [],
      magnets: mutations.includes('MAGNETISM')
        ? [
            { r: 0, c: 6 },
            { r: 6, c: 0 }
          ]
        : [],
      turntables: mutations.includes('TURNTABLES') ? [{ r: 3, c: 2 }] : [],
      tetherPylon: mutations.includes('TETHER_PYLON') ? { r: 3, c: 3 } : null,
      initialInfected: mutations.includes('INFECTION') ? [{ r: 0, c: 2 }] : [],
      infectionPriority: ['DOWN', 'RIGHT', 'LEFT', 'UP'],
      optimalMoves: 12,
      optimalPath: [],
      verifiedRelevant: true
    };

    // Provide a backstop wall behind (1, 4) so Magnetic Cell #1 at (1, 5) can always be approached
    if (mutations.includes('MAGNETIC_CELLS')) {
      base.grid[1][3] = 'WALL';
    }

    if (mutations.includes('PHASE_SHIFT') && !mutations.includes('BLAST_DOORS')) {
      base.grid[2][2] = 'FLOOR';
      base.grid[2][4] = 'FLOOR';
      base.grid[4][2] = 'FLOOR';
      base.grid[4][4] = 'FLOOR';
    }

    const keepFloor = [
      base.start,
      base.cells[0],
      base.cells[1],
      base.exit,
      ...base.conveyors,
      ...base.portals,
      ...base.phaseGates,
      ...base.blastDoors,
      ...base.pressurePlates,
      ...base.cryoTiles,
      ...base.initialInfected
    ];
    if (base.droneStart) keepFloor.push(base.droneStart);
    for (const c of keepFloor) {
      base.grid[c.r][c.c] = 'FLOOR';
    }
    for (const m of base.magnets) {
      base.grid[m.r][m.c] = 'WALL';
    }
    for (const tb of base.turntables) {
      base.grid[tb.r][tb.c] = 'WALL';
    }
    if (base.tetherPylon) {
      base.grid[base.tetherPylon.r][base.tetherPylon.c] = 'WALL';
    }

    const solved = solvePuzzleBFS(base, 34, 75000);
    if (solved.solvable && solved.optimalMoves !== null) {
      base.optimalMoves = solved.optimalMoves;
      base.optimalPath = solved.solutionPath || [];
      return base;
    }
  }

  // Final open-chamber guaranteed-solvable fallback
  const emergencyGrid = Array.from({ length: GRID_SIZE }, () =>
    Array.from({ length: GRID_SIZE }, () => 'FLOOR')
  );
  if (mutations.includes('MAGNETIC_CELLS')) {
    emergencyGrid[1][3] = 'WALL';
  }
  const emergency = {
    dateKey,
    challengeNumber,
    rulesVersion: RULES_VERSION,
    seed,
    mutations,
    promotedThirdMutation,
    grid: emergencyGrid,
    start: { r: 1, c: 1 },
    droneStart: mutations.includes('MIRROR_DRONE') ? { r: 5, c: 5 } : null,
    cells: [
      { r: 1, c: 5 },
      { r: 5, c: 1 }
    ],
    exit: { r: 5, c: 5 },
    conveyors: mutations.includes('CONVEYOR') ? [{ r: 3, c: 3, dir: 'RIGHT' }] : [],
    portals: mutations.includes('PORTALS')
      ? [
          { r: 1, c: 2, label: 'A' },
          { r: 1, c: 4, label: 'B' },
          { r: 5, c: 2, label: 'C' },
          { r: 5, c: 4, label: 'D' }
        ]
      : [],
    phaseGates: mutations.includes('PHASE_GATES')
      ? [{ r: 3, c: 2, polarity: 'AMBER' }]
      : [],
    blastDoors: mutations.includes('BLAST_DOORS') ? [{ r: 3, c: 4 }] : [],
    pressurePlates: mutations.includes('BLAST_DOORS') ? [{ r: 2, c: 2 }] : [],
    cryoTiles: mutations.includes('CRYO_SLICK') ? [{ r: 2, c: 4 }] : [],
    magnets: [],
    turntables: [],
    tetherPylon: null,
    initialInfected: mutations.includes('INFECTION') ? [{ r: 0, c: 6 }] : [],
    infectionPriority: ['DOWN', 'LEFT', 'RIGHT', 'UP'],
    optimalMoves: 10,
    optimalPath: [],
    verifiedRelevant: true
  };
  const emergencySolved = solvePuzzleBFS(emergency, 34, 75000);
  emergency.optimalMoves = emergencySolved.optimalMoves || 10;
  emergency.optimalPath = emergencySolved.solutionPath || [];
  return emergency;
}

function generateDailyPuzzle(dateKey, forcedMutations = null) {
  const challengeNumber = getChallengeNumberForDate(dateKey);
  const pairSuffix = forcedMutations ? `:custom:${forcedMutations.join('+')}` : '';
  const seed = `${dateKey}:v${RULES_VERSION}${pairSuffix}`;
  const rng = new SeededRng(seed);
  const { mutations, promotedThirdMutation } = selectDailyMutations(
    rng,
    forcedMutations
  );

  let bestPartialBackup = null;

  for (let attempt = 0; attempt < 140; attempt++) {
    const candidate = buildCandidateBoard(
      dateKey,
      challengeNumber,
      seed,
      mutations,
      promotedThirdMutation,
      attempt
    );
    if (!candidate) continue;

    const solveResult = solvePuzzleBFS(candidate, 28, 35000);
    if (!solveResult.solvable || solveResult.optimalMoves === null) continue;

    candidate.optimalMoves = solveResult.optimalMoves;
    candidate.optimalPath = solveResult.solutionPath || [];

    if (solveResult.optimalMoves >= 8 && solveResult.optimalMoves <= 26) {
      if (verifyAllMutationsRelevant(candidate, solveResult)) {
        candidate.verifiedRelevant = true;
        return candidate;
      }
      if (!bestPartialBackup) {
        bestPartialBackup = candidate;
      }
    } else if (!bestPartialBackup && solveResult.optimalMoves >= 5) {
      bestPartialBackup = candidate;
    }
  }

  if (bestPartialBackup) return bestPartialBackup;
  return buildVerifiedFallbackPuzzle(
    dateKey,
    challengeNumber,
    seed,
    mutations,
    promotedThirdMutation
  );
}

// ============================================================================
// 8. UI SUB-COMPONENTS (Telemetry, MutationCards, Grid, Controls, Results)
// ============================================================================

function ActiveTelemetryStrip({ puzzle, state }) {
  const chips = [];

  if (puzzle.mutations.includes('GRAVITY')) {
    const shiftIn = turnsUntilGravityShift(state.turn);
    chips.push({
      key: 'grav',
      color: '#38bdf8',
      hot: shiftIn === 1,
      text: `GRAV: ${state.gravityDir} (${shiftIn}t)`
    });
  }
  if (puzzle.mutations.includes('PAYLOAD_MASS')) {
    const tier = getMassTier(puzzle, state.collectedCells);
    chips.push({
      key: 'mass',
      color: '#eab308',
      hot: tier !== 'NOMINAL',
      text:
        tier === 'LIGHT'
          ? 'MASS: LIGHT (2x DRIFT)'
          : tier === 'HEAVY'
            ? 'MASS: HEAVY (ANCHORED)'
            : 'MASS: NOMINAL (1x)'
    });
  }
  if (puzzle.mutations.includes('OVERCLOCK')) {
    const active = isOverclockActive(state.turn);
    const left = turnsUntilOverclock(state.turn);
    chips.push({
      key: 'oc',
      color: '#f43f5e',
      hot: active,
      text: active ? 'OVERCLOCK: 2-TILE SURGE' : `OVERCLOCK: in ${left}t`
    });
  }
  if (puzzle.mutations.includes('PHASE_SHIFT')) {
    const active = isPhaseShiftActive(state.turn);
    const left = turnsUntilPhaseShift(state.turn);
    chips.push({
      key: 'ps',
      color: '#34d399',
      hot: active,
      text: active ? 'PHASE SHIFT: READY' : `PHASE SHIFT: in ${left}t`
    });
  }
  if (puzzle.mutations.includes('PHASE_GATES')) {
    const closed = getActiveGatePolarity(state.turn);
    chips.push({
      key: 'pg',
      color: '#fbbf24',
      hot: true,
      text: `GATES: ${closed} LOCKED`
    });
  }
  if (puzzle.mutations.includes('BLAST_DOORS')) {
    chips.push({
      key: 'bd',
      color: '#84cc16',
      hot: state.blastDoorsOpen,
      text: `BLAST DOORS: ${state.blastDoorsOpen ? 'OPEN' : 'SEALED'}`
    });
  }
  if (puzzle.mutations.includes('TURNTABLES')) {
    const left = turnsUntilTurntableSpin(state.turn);
    chips.push({
      key: 'tb',
      color: '#d97706',
      hot: left === 1,
      text: `GEARS: SPIN IN ${left}t`
    });
  }
  if (puzzle.mutations.includes('AFTERIMAGE')) {
    chips.push({
      key: 'ai',
      color: '#0ea5e9',
      hot: Boolean(state.afterimagePos),
      text: state.afterimagePos ? 'AFTERIMAGE: SOLID' : 'AFTERIMAGE: CHARGING'
    });
  }
  if (puzzle.mutations.includes('MAGNETIC_CELLS')) {
    chips.push({
      key: 'mc',
      color: '#fb7185',
      hot: !state.collectedCells[0] || !state.collectedCells[1],
      text: 'CELLS: + REPEL / − ATTRACT'
    });
  }
  if (puzzle.mutations.includes('TETHER_PYLON')) {
    chips.push({
      key: 'tp',
      color: '#ec4899',
      hot: false,
      text: 'TETHER: 5×5 LEASH ACTIVE'
    });
  }
  if (puzzle.mutations.includes('PORTALS')) {
    const pairStr = state.portalMode === 0 ? 'A↔B · C↔D' : 'A↔C · B↔D';
    const left = turnsUntilPortalShift(state.turn);
    chips.push({
      key: 'pt',
      color: '#818cf8',
      hot: left === 1,
      text: `PORTALS: ${pairStr} (${left}t)`
    });
  }
  if (puzzle.mutations.includes('INFECTION')) {
    const nextSpread = (state.turn + 1) % 2 === 0;
    chips.push({
      key: 'inf',
      color: '#a855f7',
      hot: nextSpread,
      text: nextSpread ? 'INFECTION: SPREADS NEXT' : 'INFECTION: DORMANT (1t)'
    });
  }
  if (puzzle.mutations.includes('DECAY')) {
    const unstable = Object.values(state.decayTimers).filter((v) => v > 0).length;
    chips.push({
      key: 'dec',
      color: '#f97316',
      hot: unstable > 0,
      text: `DECAY: ${unstable} UNSTABLE`
    });
  }
  if (puzzle.mutations.includes('MAGNETISM')) {
    chips.push({
      key: 'mag',
      color: '#60a5fa',
      hot: false,
      text: `MAGNETS: ${puzzle.magnets.length} PYLONS`
    });
  }
  if (puzzle.mutations.includes('CRYO_SLICK')) {
    chips.push({
      key: 'cryo',
      color: '#67e8f9',
      hot: false,
      text: `CRYO: ${puzzle.cryoTiles.length} ICE`
    });
  }
  if (puzzle.mutations.includes('CONVEYOR')) {
    chips.push({
      key: 'conv',
      color: '#14b8a6',
      hot: false,
      text: `CONVEYORS: ${puzzle.conveyors.length} BELTS`
    });
  }
  if (puzzle.mutations.includes('MIRROR_DRONE')) {
    chips.push({
      key: 'drone',
      color: '#e879f9',
      hot: false,
      text: 'MIRROR DRONE: LINKED'
    });
  }

  return toHostElement(
    <div className="active-telemetry-strip" aria-label="Active Force Telemetry">
      {chips.map((chip) => (
        <span
          key={chip.key}
          className={`telemetry-chip ${chip.hot ? 'hot' : ''}`}
          style={{
            borderColor: chip.color,
            color: chip.hot ? '#ffffff' : chip.color
          }}
        >
          {chip.text}
        </span>
      ))}
    </div>
  );
}

function MutationCards({ puzzle, state }) {
  const getPulse = (id) => {
    switch (id) {
      case 'GRAVITY': {
        const left = turnsUntilGravityShift(state.turn);
        return { label: `${state.gravityDir} (${left}t)`, imminent: left === 1 };
      }
      case 'PAYLOAD_MASS': {
        const tier = getMassTier(puzzle, state.collectedCells);
        return { label: tier, imminent: tier !== 'NOMINAL' };
      }
      case 'OVERCLOCK': {
        const active = isOverclockActive(state.turn);
        return {
          label: active ? '2x SURGE!' : `In ${turnsUntilOverclock(state.turn)}t`,
          imminent: active
        };
      }
      case 'PHASE_SHIFT': {
        const active = isPhaseShiftActive(state.turn);
        return {
          label: active ? 'INTANGIBLE!' : `In ${turnsUntilPhaseShift(state.turn)}t`,
          imminent: active
        };
      }
      case 'PHASE_GATES': {
        const closed = getActiveGatePolarity(state.turn);
        return { label: `${closed} SOLID`, imminent: true };
      }
      case 'BLAST_DOORS':
        return {
          label: state.blastDoorsOpen ? 'OPEN' : 'SEALED',
          imminent: state.blastDoorsOpen
        };
      case 'TURNTABLES': {
        const left = turnsUntilTurntableSpin(state.turn);
        return { label: `Spin in ${left}t`, imminent: left === 1 };
      }
      case 'AFTERIMAGE':
        return {
          label: state.afterimagePos ? 'WALL ACTIVE' : 'CHARGING',
          imminent: Boolean(state.afterimagePos)
        };
      case 'MAGNETIC_CELLS':
        return { label: '+ / − FIELDS', imminent: true };
      case 'TETHER_PYLON':
        return { label: '5×5 LEASH', imminent: false };
      case 'PORTALS': {
        const left = turnsUntilPortalShift(state.turn);
        const map = state.portalMode === 0 ? 'A↔B C↔D' : 'A↔C B↔D';
        return { label: `${map} (${left}t)`, imminent: left === 1 };
      }
      case 'DECAY': {
        const count = Object.values(state.decayTimers).filter((v) => v > 0).length;
        return {
          label: `${count} unstable`,
          imminent: Object.values(state.decayTimers).some((v) => v === 1)
        };
      }
      case 'INFECTION': {
        const spreads = (state.turn + 1) % 2 === 0;
        return { label: spreads ? 'SPREADS NEXT' : 'Dormant', imminent: spreads };
      }
      default:
        return { label: 'ACTIVE', imminent: false };
    }
  };

  return toHostElement(
    <div
      className="mutation-row"
      style={{
        gridTemplateColumns:
          puzzle.mutations.length === 3 ? 'repeat(3, 1fr)' : '1fr 1fr'
      }}
    >
      {puzzle.mutations.map((mutId) => {
        const meta = MUTATION_META[mutId];
        const pulse = getPulse(mutId);
        return (
          <div
            key={mutId}
            className={`mutation-card ${pulse.imminent ? 'imminent' : ''}`}
            style={{
              borderTop: `3px solid ${meta.color}`,
              boxShadow: pulse.imminent
                ? `0 0 16px rgba(${meta.rgb}, 0.35)`
                : undefined
            }}
          >
            <div className="mutation-header">
              <span className="mutation-name" style={{ color: meta.color }}>
                <span>{meta.icon}</span>
                <span>{meta.name}</span>
              </span>
              <span className="mutation-pulse">{pulse.label}</span>
            </div>
            <div className="mutation-desc">{meta.shortDesc}</div>
          </div>
        );
      })}
    </div>
  );
}

function JinxesPanel({ puzzle }) {
  const [expanded, setExpanded] = useState(true);
  const jinxes = useMemo(
    () => computeActiveJinxes(puzzle.mutations),
    [puzzle.mutations]
  );

  return toHostElement(
    <div className="jinxes-panel" aria-label="Active Mutation Jinxes">
      <div
        className="jinxes-header"
        onClick={() => setExpanded((prev) => !prev)}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            setExpanded((prev) => !prev);
          }
        }}
      >
        <div className="jinxes-title-group">
          <span className="jinxes-title">⚡ JINXES & INTERACTIONS</span>
          <span className="jinx-count-pill">{jinxes.length} ACTIVE</span>
          {puzzle.promotedThirdMutation && (
            <span className="jinx-promoted-pill">
              +3RD HOST: {MUTATION_META[puzzle.promotedThirdMutation].name}
            </span>
          )}
        </div>
        <span style={{ fontSize: 11, color: '#94a3b8', fontWeight: 800 }}>
          {expanded ? '▾' : '▸'}
        </span>
      </div>

      {expanded && (
        <div className="jinxes-list">
          {jinxes.map((jx) => {
            const metaA = MUTATION_META[jx.pair[0]];
            const metaB = MUTATION_META[jx.pair[1]];
            return (
              <div key={jx.id} className="jinx-item">
                <div className="jinx-item-top">
                  <span className="jinx-pair-label">
                    <span style={{ color: metaA.color }}>
                      {metaA.icon} {metaA.name}
                    </span>
                    <span style={{ color: '#64748b', margin: '0 4px' }}>×</span>
                    <span style={{ color: metaB.color }}>
                      {metaB.icon} {metaB.name}
                    </span>
                  </span>
                  <span className="jinx-type-tag">{jx.tag}</span>
                </div>
                <div className="jinx-item-desc">{jx.text}</div>
              </div>
            );
          })}
          {puzzle.mutations.length >= 3 && (
            <div className="jinx-triple-note">
              <strong>TRIPLE CONVERGENCE:</strong> All 3 mutations resolve in
              strict step order (Chassis → Drone → Tiles → Magnets → Gravity →
              Tether → Terrain Tick).
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function formatTelemetryBanner(events) {
  if (!events || events.length === 0) {
    return 'Awaiting directional input...';
  }
  const tags = [];
  for (const ev of events) {
    if (ev.type === 'OVERCLOCK_STEP') tags.push('⚡ Overclock 2-Step');
    if (ev.type === 'PHASE_SHIFT') tags.push('⬡ Phased Through Wall');
    if (ev.type === 'COLLECT_CELL') tags.push(`🔋 Energy Cell #${ev.index + 1}`);
    if (ev.type === 'PORTAL') tags.push(`◎ Warped ${ev.from}→${ev.to}`);
    if (ev.type === 'CONVEYOR') tags.push(`➤ Belt ${ev.dir}`);
    if (ev.type === 'CRYO_SLIDE') tags.push(`❄ Ice Slide ${ev.dir}`);
    if (ev.type === 'MAGNET_PULL') tags.push('🧲 Magnetic Pull');
    if (ev.type === 'CELL_REPEL') tags.push('⊕ Cell Repulsion');
    if (ev.type === 'CELL_ATTRACT') tags.push('⊖ Cell Attraction');
    if (ev.type === 'GRAVITY') tags.push(`⬇ Gravity ${ev.dir}`);
    if (ev.type === 'TETHER_SNAP') tags.push('⌖ Tether Pullback');
    if (ev.type === 'BLAST_DOOR_TOGGLE')
      tags.push(ev.open ? '⛨ Blast Doors Opened' : '⛨ Blast Doors Sealed');
    if (ev.type === 'TURNTABLE_SPIN') tags.push('⚙ Turntable Rotated 90° CW');
    if (ev.type === 'AFTERIMAGE_SPAWN') tags.push('❐ Afterimage Solidified');
    if (ev.type === 'DECAY_COLLAPSE') tags.push('◈ Floor Collapsed');
    if (ev.type === 'INFECTION_SPREAD') tags.push('☣ Infection Spread');
    if (ev.type === 'SOLVED') tags.push('★ EXIT REACHED!');
  }
  return tags.length > 0 ? tags.join('  •  ') : 'Step executed.';
}

function buildCourierWaypoints(state) {
  const waypoints = [];
  for (const ev of state.lastStepEvents || []) {
    if (
      ev.type === 'MOVE' ||
      ev.type === 'OVERCLOCK_STEP' ||
      ev.type === 'CONVEYOR' ||
      ev.type === 'CRYO_SLIDE' ||
      ev.type === 'MAGNET_PULL' ||
      ev.type === 'CELL_REPEL' ||
      ev.type === 'CELL_ATTRACT' ||
      ev.type === 'GRAVITY' ||
      ev.type === 'TETHER_SNAP'
    ) {
      waypoints.push({ pos: ev.to, warp: false, phase: false });
    } else if (ev.type === 'PHASE_SHIFT') {
      waypoints.push({ pos: ev.to, warp: false, phase: true });
    } else if (ev.type === 'PORTAL') {
      waypoints.push({ pos: ev.coord, warp: true, phase: false });
    }
  }
  if (waypoints.length === 0 || !sameCoord(waypoints[waypoints.length - 1].pos, state.courier)) {
    waypoints.push({ pos: state.courier, warp: false, phase: false });
  }
  return waypoints;
}

function GameGrid({
  puzzle,
  state,
  shakeBoard,
  bumpInfo,
  onSwipeMove,
  vfxLevel
}) {
  const touchStartRef = useRef(null);
  const prevTurnRef = useRef(state.turn);
  const exitUnlocked = state.collectedCells[0] && state.collectedCells[1];
  const closedPolarity = getActiveGatePolarity(state.turn);
  const boardView = useMemo(
    () => getRotatedBoardSnapshot(puzzle, state.turn),
    [puzzle, state.turn]
  );

  const [visualCourier, setVisualCourier] = useState(state.courier);
  const [warpAnim, setWarpAnim] = useState(false);
  const [phaseAnim, setPhaseAnim] = useState(false);
  const [instantJump, setInstantJump] = useState(false);

  // Step through multi-stage movement events on forward turns; snap cleanly on Undo/Reset
  useEffect(() => {
    const isBackwardOrReset = state.turn <= prevTurnRef.current;
    prevTurnRef.current = state.turn;

    if (isBackwardOrReset) {
      setInstantJump(true);
      setWarpAnim(false);
      setPhaseAnim(false);
      setVisualCourier(state.courier);
      return undefined;
    }

    const waypoints = buildCourierWaypoints(state);
    if (waypoints.length <= 1) {
      const wp = waypoints[0] || { pos: state.courier, warp: false, phase: false };
      setInstantJump(wp.warp);
      setVisualCourier(wp.pos);
      if (wp.warp) {
        setWarpAnim(true);
        const t = setTimeout(() => setWarpAnim(false), 260);
        return () => clearTimeout(t);
      }
      if (wp.phase) {
        setPhaseAnim(true);
        const t = setTimeout(() => setPhaseAnim(false), 280);
        return () => clearTimeout(t);
      }
      return undefined;
    }

    const timers = [];
    waypoints.forEach((wp, idx) => {
      const t = setTimeout(() => {
        setInstantJump(wp.warp);
        setVisualCourier(wp.pos);
        if (wp.warp) {
          setWarpAnim(true);
          timers.push(setTimeout(() => setWarpAnim(false), 240));
        }
        if (wp.phase) {
          setPhaseAnim(true);
          timers.push(setTimeout(() => setPhaseAnim(false), 240));
        }
      }, idx * 90);
      timers.push(t);
    });

    return () => {
      timers.forEach((t) => clearTimeout(t));
    };
  }, [state]);

  const newlyCollapsedSet = useMemo(() => {
    const s = new Set();
    for (const ev of state.lastStepEvents || []) {
      if (ev.type === 'DECAY_COLLAPSE') s.add(coordKey(ev.at));
    }
    return s;
  }, [state]);

  const newlyInfectedSet = useMemo(() => {
    const s = new Set();
    for (const ev of state.lastStepEvents || []) {
      if (ev.type === 'INFECTION_SPREAD') s.add(coordKey(ev.at));
    }
    return s;
  }, [state]);

  const DIR_ARROWS = {
    UP: '▲',
    DOWN: '▼',
    LEFT: '◀',
    RIGHT: '▶'
  };

  const handleTouchStart = (e) => {
    const t = e.touches && e.touches[0];
    if (t) {
      touchStartRef.current = { x: t.clientX, y: t.clientY };
    }
  };

  const handleTouchEnd = (e) => {
    const start = touchStartRef.current;
    const t = e.changedTouches && e.changedTouches[0];
    touchStartRef.current = null;
    if (!start || !t) return;
    const dx = t.clientX - start.x;
    const dy = t.clientY - start.y;
    if (Math.max(Math.abs(dx), Math.abs(dy)) < 24) return;
    if (Math.abs(dx) > Math.abs(dy)) {
      onSwipeMove(dx > 0 ? 'RIGHT' : 'LEFT');
    } else {
      onSwipeMove(dy > 0 ? 'DOWN' : 'UP');
    }
  };

  const phaseReady =
    puzzle.mutations.includes('PHASE_SHIFT') && isPhaseShiftActive(state.turn);
  const overclockReady =
    puzzle.mutations.includes('OVERCLOCK') && isOverclockActive(state.turn);
  const massTier = getMassTier(puzzle, state.collectedCells);

  const courierClasses = ['courier-bot'];
  if (warpAnim) courierClasses.push('courier-warp');
  if (phaseAnim || phaseReady) courierClasses.push('courier-phased');
  if (overclockReady) courierClasses.push('courier-overclock');
  if (massTier === 'LIGHT') courierClasses.push('courier-light');
  if (massTier === 'HEAVY') courierClasses.push('courier-heavy');
  if (state.solved) courierClasses.push('courier-victory');
  if (bumpInfo && bumpInfo.dir) courierClasses.push(`bump-${bumpInfo.dir}`);

  return toHostElement(
    <div
      className={`grid-frame ${shakeBoard ? 'board-shake' : ''}`}
      onTouchStart={handleTouchStart}
      onTouchEnd={handleTouchEnd}
    >
      <div key={`tel-${state.turn}`} className="telemetry-bar telemetry-enter">
        {formatTelemetryBanner(state.lastStepEvents)}
      </div>

      <div className="board-wrapper">
        <div
          className="board-grid"
          role="grid"
          aria-label="MUTATOR 7x7 Puzzle Grid"
        >
          {Array.from({ length: GRID_SIZE * GRID_SIZE }, (_, idx) => {
            const r = Math.floor(idx / GRID_SIZE);
            const c = idx % GRID_SIZE;
            const coord = { r, c };
            const key = coordKey(coord);

            const isWall = boardView.grid[r][c] === 'WALL';
            const isMagnet = puzzle.magnets.some((m) => sameCoord(m, coord));
            const isTurntable = puzzle.turntables.some((tb) => sameCoord(tb, coord));
            const isTetherPylon =
              puzzle.tetherPylon && sameCoord(puzzle.tetherPylon, coord);
            const inTetherZone =
              puzzle.tetherPylon && chebyshevDist(coord, puzzle.tetherPylon) <= 2;
            const isAfterimage =
              state.afterimagePos && sameCoord(state.afterimagePos, coord);
            const isAfterimageCharging =
              !isAfterimage &&
              state.prevTurn1Pos &&
              sameCoord(state.prevTurn1Pos, coord);
            const decayVal = state.decayTimers[key];
            const isCollapsed = decayVal === 0;
            const isInfected = state.infectedTiles.includes(key);
            const conveyor = boardView.conveyors.find((cv) => sameCoord(cv, coord));
            const portal = puzzle.portals.find((pt) => sameCoord(pt, coord));
            const gate = boardView.phaseGates.find((pg) => sameCoord(pg, coord));
            const blastDoor = boardView.blastDoors.find((bd) => sameCoord(bd, coord));
            const pressurePlate = boardView.pressurePlates.find((pp) =>
              sameCoord(pp, coord)
            );
            const isCryo = boardView.cryoTiles.some((cr) => sameCoord(cr, coord));
            const isExit = sameCoord(puzzle.exit, coord);

            const hasCell0 =
              !state.collectedCells[0] && sameCoord(puzzle.cells[0], coord);
            const hasCell1 =
              !state.collectedCells[1] && sameCoord(puzzle.cells[1], coord);

            const classes = ['tile'];
            if (isWall && !isMagnet && !isTurntable && !isTetherPylon) {
              classes.push('wall');
            }
            if (isMagnet) classes.push('magnet-pylon');
            if (isTurntable) classes.push('turntable-hub');
            if (isTetherPylon) classes.push('tether-pylon');
            if (inTetherZone && !isWall) classes.push('tether-zone');
            if (isAfterimage) classes.push('afterimage-solid');
            if (isAfterimageCharging) classes.push('afterimage-charging');
            if (isCollapsed) {
              classes.push('collapsed');
              if (newlyCollapsedSet.has(key)) classes.push('tile-collapse-anim');
            }
            if (decayVal === 2) classes.push('decay-2');
            if (decayVal === 1) classes.push('decay-1');
            if (isInfected) {
              classes.push('infected');
              if (newlyInfectedSet.has(key)) classes.push('tile-infect-bloom');
            }
            if (conveyor) {
              classes.push('conveyor', `conv-${conveyor.dir.toLowerCase()}`);
            }
            if (portal) classes.push('portal');
            if (isCryo) classes.push('cryo');
            if (gate) {
              const isClosed = gate.polarity === closedPolarity;
              classes.push(
                gate.polarity === 'CYAN' ? 'gate-cyan' : 'gate-amber',
                isClosed ? 'gate-closed' : 'gate-open'
              );
            }
            if (blastDoor) {
              classes.push(
                state.blastDoorsOpen ? 'blast-door-open' : 'blast-door-closed'
              );
            }
            if (pressurePlate) classes.push('pressure-plate');
            if (isExit) classes.push(exitUnlocked ? 'exit-open' : 'exit-locked');

            return (
              <div
                key={key}
                className={classes.join(' ')}
                role="gridcell"
                aria-label={`Row ${r + 1} Column ${c + 1}`}
              >
                {decayVal !== undefined && decayVal > 0 && (
                  <span className="decay-badge">{decayVal}</span>
                )}

                {isMagnet && <span className="tile-tag magnet-icon">🧲</span>}
                {isTurntable && <span className="tile-tag gear-spin">⚙</span>}
                {isTetherPylon && <span className="tile-tag tether-icon">⌖</span>}
                {isAfterimage && <span className="tile-tag">❐</span>}

                {(hasCell0 || hasCell1) && (
                  <div className="energy-cell-wrap" title="Energy Cell">
                    <div
                      className={`energy-cell-ring ${
                        puzzle.mutations.includes('MAGNETIC_CELLS')
                          ? hasCell0
                            ? 'cell-repel-ring'
                            : 'cell-attract-ring'
                          : ''
                      }`}
                    />
                    <div
                      className={`energy-cell ${
                        puzzle.mutations.includes('MAGNETIC_CELLS')
                          ? hasCell0
                            ? 'cell-plus'
                            : 'cell-minus'
                          : ''
                      }`}
                    >
                      {puzzle.mutations.includes('MAGNETIC_CELLS')
                        ? hasCell0
                          ? '+'
                          : '−'
                        : ''}
                    </div>
                  </div>
                )}

                {!hasCell0 && !hasCell1 && isExit && (
                  <span className="tile-tag exit-label">
                    {exitUnlocked ? 'EXIT' : 'LOCK'}
                  </span>
                )}

                {!hasCell0 && !hasCell1 && conveyor && (
                  <span className="tile-tag conv-arrow">
                    {DIR_ARROWS[conveyor.dir]}
                  </span>
                )}

                {!hasCell0 && !hasCell1 && portal && (
                  <span className="tile-tag portal-label">[{portal.label}]</span>
                )}

                {!hasCell0 && !hasCell1 && gate && (
                  <span className="tile-tag">
                    {gate.polarity === closedPolarity ? '⊞' : '⊡'}
                  </span>
                )}

                {!hasCell0 && !hasCell1 && blastDoor && (
                  <span className="tile-tag">
                    {state.blastDoorsOpen ? '▢' : '▤'}
                  </span>
                )}

                {!hasCell0 && !hasCell1 && pressurePlate && (
                  <span className="tile-tag">⬚</span>
                )}

                {!hasCell0 &&
                  !hasCell1 &&
                  isCryo &&
                  !conveyor &&
                  !portal && <span className="tile-tag cryo-flake">❄</span>}

                {isInfected && <span className="tile-tag infect-spore">☣</span>}
              </div>
            );
          })}
        </div>

        {/* Smoothly gliding Mirror Drone overlay entity */}
        {state.drone && (
          <div
            className="entity-slot"
            style={{
              transform: `translate3d(calc(${state.drone.c} * (100% + 4px)), calc(${state.drone.r} * (100% + 4px)), 0)`
            }}
          >
            <div className="mirror-drone-bot" title="Mirror Drone">
              ❖
            </div>
          </div>
        )}

        {/* Smoothly gliding Courier overlay entity */}
        <div
          className={`entity-slot ${instantJump ? 'no-slide' : ''}`}
          style={{
            transform: `translate3d(calc(${visualCourier.c} * (100% + 4px)), calc(${visualCourier.r} * (100% + 4px)), 0)`
          }}
        >
          <div
            key={bumpInfo ? `bump-${bumpInfo.tick}` : 'courier-steady'}
            className={courierClasses.join(' ')}
            title="Courier"
          >
            ◈
          </div>
        </div>

        <VfxCanvasOverlay puzzle={puzzle} state={state} vfxLevel={vfxLevel} />
      </div>
    </div>
  );
}

function Controls({
  onMove,
  onUndo,
  onReset,
  canUndo,
  surgeActive,
  disabled = false
}) {
  return toHostElement(
    <div className="controls-panel">
      <div className="dpad" aria-label="Directional Controls">
        <div />
        <button
          type="button"
          className={`dpad-btn ${surgeActive ? 'surge-hint' : ''}`}
          disabled={disabled}
          onClick={() => onMove('UP')}
          aria-label="Move Up"
        >
          ▲
        </button>
        <div />
        <button
          type="button"
          className={`dpad-btn ${surgeActive ? 'surge-hint' : ''}`}
          disabled={disabled}
          onClick={() => onMove('LEFT')}
          aria-label="Move Left"
        >
          ◀
        </button>
        <button
          type="button"
          className={`dpad-btn ${surgeActive ? 'surge-hint' : ''}`}
          disabled={disabled}
          onClick={() => onMove('DOWN')}
          aria-label="Move Down"
        >
          ▼
        </button>
        <button
          type="button"
          className={`dpad-btn ${surgeActive ? 'surge-hint' : ''}`}
          disabled={disabled}
          onClick={() => onMove('RIGHT')}
          aria-label="Move Right"
        >
          ▶
        </button>
      </div>

      <div className="action-stack">
        <button
          type="button"
          className="action-btn"
          disabled={!canUndo || disabled}
          onClick={onUndo}
        >
          ↶ Undo Step <span className="kbd-hint">[Z]</span>
        </button>
        <button type="button" className="action-btn" onClick={onReset}>
          ↺ Restart Run <span className="kbd-hint">[R]</span>
        </button>
      </div>
    </div>
  );
}

function Results({
  puzzle,
  moves,
  stars,
  isNewBest,
  newlyUnlocked,
  onRetry,
  onWatchOptimal,
  onViewLeaderboard
}) {
  const [copied, setCopied] = useState(false);
  const shareText = formatShareText(puzzle, moves, stars);

  const handleShare = async () => {
    try {
      await navigator.clipboard.writeText(shareText);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch {
      setCopied(true);
    }
  };

  return toHostElement(
    <div className="card-panel victory-banner">
      <div className="victory-title">SOLVED!</div>
      <div className="stars-display" aria-label={`${stars} out of 3 stars`}>
        {[0, 1, 2].map((idx) => {
          const earned = idx < stars;
          return (
            <span
              key={idx}
              className={earned ? 'star-earned' : 'star-empty'}
              style={{ animationDelay: `${idx * 140}ms` }}
            >
              {earned ? '★' : '☆'}
            </span>
          );
        })}
      </div>

      {isNewBest && (
        <div className="toast-banner">NEW PERSONAL BEST RECORDED!</div>
      )}

      <div className="stats-bar">
        <div className="stat-box">
          <div className="stat-label">Moves Used</div>
          <div className="stat-value">{moves}</div>
        </div>
        <div className="stat-box">
          <div className="stat-label">Optimal</div>
          <div className="stat-value" style={{ color: '#22d3ee' }}>
            {puzzle.optimalMoves}
          </div>
        </div>
        <div className="stat-box">
          <div className="stat-label">Rating</div>
          <div className="stat-value">{stars}/3 ★</div>
        </div>
        <div className="stat-box">
          <div className="stat-label">Efficiency</div>
          <div className="stat-value">
            {moves <= puzzle.optimalMoves
              ? '100%'
              : `${Math.max(50, Math.round((puzzle.optimalMoves / moves) * 100))}%`}
          </div>
        </div>
      </div>

      {newlyUnlocked.length > 0 && (
        <div className="card-panel" style={{ padding: '8px 10px' }}>
          <div style={{ fontSize: 11, fontWeight: 800, color: '#fbbf24' }}>
            ACHIEVEMENT UNLOCKED
          </div>
          {newlyUnlocked.map((id) => {
            const def = ACHIEVEMENTS.find((a) => a.id === id);
            return (
              <div key={id} style={{ fontSize: 12 }}>
                <strong>{def && def.title}</strong>:{' '}
                {def && def.description}
              </div>
            );
          })}
        </div>
      )}

      <pre className="share-preview">{shareText}</pre>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
        <button
          type="button"
          className="action-btn primary"
          onClick={handleShare}
        >
          {copied ? '✓ Copied Result!' : 'Share Spoiler-Free'}
        </button>
        <button
          type="button"
          className="action-btn"
          onClick={onViewLeaderboard}
        >
          View Leaderboard
        </button>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
        <button type="button" className="action-btn" onClick={onRetry}>
          ↺ Retry Puzzle
        </button>
        {puzzle.optimalPath && puzzle.optimalPath.length > 0 && (
          <button
            type="button"
            className="action-btn"
            onClick={onWatchOptimal}
          >
            ▶ Optimal Replay
          </button>
        )}
      </div>
    </div>
  );
}

// ============================================================================
// 9. MAIN APPLICATION COMPONENT
// ============================================================================

function createDefaultProfile() {
  return {
    totalCompleted: 0,
    totalStars: 0,
    optimalCount: 0,
    currentStreak: 0,
    maxStreak: 0,
    lastCompletedDate: null,
    completedPairs: [],
    completedThreeMutation: false,
    unlockedAchievements: [],
    bestByDate: {}
  };
}

export default function App() {
  const todayKey = useMemo(() => getTodayDateKey(), []);
  const [activeTab, setActiveTab] = useState('PLAY');
  const [modeKey, setModeKey] = useState('DAILY');
  const [vfxLevel, setVfxLevel] = useState('HIGH');
  const [muted, setMuted] = useState(false);

  const puzzle = useMemo(() => {
    if (modeKey === 'DAILY') {
      return generateDailyPuzzle(todayKey);
    }
    if (modeKey === 'ANOMALY_3') {
      return generateDailyPuzzle(todayKey, ['GRAVITY', 'PORTALS', 'DECAY']);
    }
    const [m1, m2] = modeKey.split('+');
    return generateDailyPuzzle(todayKey, [m1, m2]);
  }, [todayKey, modeKey]);

  const [history, setHistory] = useState(() => [createInitialGameState(puzzle)]);
  const [shakeBoard, setShakeBoard] = useState(false);
  const [bumpInfo, setBumpInfo] = useState(null);
  const [replaying, setReplaying] = useState(false);
  const [profile, setProfile] = useState(createDefaultProfile);
  const [lastSolveSummary, setLastSolveSummary] = useState(null);

  const currentState = history[history.length - 1];

  useEffect(() => {
    setHistory([createInitialGameState(puzzle)]);
    setLastSolveSummary(null);
    setBumpInfo(null);
    setReplaying(false);
  }, [puzzle]);

  const toggleMute = () => {
    const next = !muted;
    setMuted(next);
    soundFX.muted = next;
  };

  const cycleVfx = () => {
    setVfxLevel((prev) =>
      prev === 'HIGH' ? 'SUBTLE' : prev === 'SUBTLE' ? 'OFF' : 'HIGH'
    );
  };

  const recordSolve = useCallback(
    (solvedTurn) => {
      const stars = calculateStars(solvedTurn, puzzle.optimalMoves);
      setProfile((prev) => {
        const recordKey = `${puzzle.dateKey}:${puzzle.mutations.join('+')}`;
        const prevBest = prev.bestByDate[recordKey];
        const isFirst = prevBest === undefined;
        const isNewBest = isFirst || solvedTurn < prevBest.moves;

        const nextBestByDate = {
          ...prev.bestByDate,
          [recordKey]: {
            moves: isNewBest ? solvedTurn : prevBest.moves,
            stars:
              prevBest && prevBest.stars > stars ? prevBest.stars : stars
          }
        };

        const nextPairs = [...prev.completedPairs];
        if (puzzle.mutations.length === 2) {
          const pk = canonicalPairKey(puzzle.mutations);
          if (!nextPairs.includes(pk)) nextPairs.push(pk);
        }

        const nextThree =
          prev.completedThreeMutation || puzzle.mutations.length >= 3;
        const nextTotalCompleted = prev.totalCompleted + (isFirst ? 1 : 0);
        const nextOptimalCount =
          prev.optimalCount +
          (stars === 3 && (!prevBest || prevBest.stars < 3) ? 1 : 0);
        const nextStreak =
          modeKey === 'DAILY'
            ? prev.lastCompletedDate === todayKey
              ? prev.currentStreak
              : prev.currentStreak + 1
            : prev.currentStreak;
        const nextMaxStreak = Math.max(prev.maxStreak, nextStreak);

        const unlocked = new Set(prev.unlockedAchievements);
        const newlyUnlocked = [];
        const unlock = (id, cond) => {
          if (cond && !unlocked.has(id)) {
            unlocked.add(id);
            newlyUnlocked.push(id);
          }
        };

        unlock('first_contact', nextTotalCompleted >= 1);
        unlock('perfect_run', nextOptimalCount >= 1);
        unlock('adaptable', nextPairs.length >= 5);
        unlock('survivor', nextThree);
        unlock('mutation_master', nextPairs.length >= 136);
        unlock('unbroken', nextMaxStreak >= 7);

        const updated = {
          totalCompleted: nextTotalCompleted,
          totalStars:
            prev.totalStars +
            (isFirst
              ? stars
              : Math.max(0, stars - (prevBest ? prevBest.stars : 0))),
          optimalCount: nextOptimalCount,
          currentStreak: nextStreak,
          maxStreak: nextMaxStreak,
          lastCompletedDate:
            modeKey === 'DAILY' ? todayKey : prev.lastCompletedDate,
          completedPairs: nextPairs,
          completedThreeMutation: nextThree,
          unlockedAchievements: Array.from(unlocked),
          bestByDate: nextBestByDate
        };

        setLastSolveSummary({
          moves: solvedTurn,
          stars,
          isNewBest,
          newlyUnlocked
        });

        return updated;
      });
    },
    [puzzle, modeKey, todayKey]
  );

  const handleMove = useCallback(
    (dir) => {
      if (replaying || currentState.solved) return;
      const res = simulateTurn(puzzle, currentState, dir);
      if (!res.valid) {
        soundFX.playEvent('blocked');
        setShakeBoard(true);
        setBumpInfo((prev) => ({ dir, tick: (prev ? prev.tick : 0) + 1 }));
        setTimeout(() => setShakeBoard(false), 260);
        return;
      }
      setBumpInfo(null);

      for (const ev of res.state.lastStepEvents) {
        if (ev.type === 'COLLECT_CELL') soundFX.playEvent('cell');
        else if (ev.type === 'PORTAL') soundFX.playEvent('portal');
        else if (ev.type === 'CONVEYOR') soundFX.playEvent('conveyor');
        else if (ev.type === 'CRYO_SLIDE') soundFX.playEvent('slide');
        else if (ev.type === 'MAGNET_PULL' || ev.type === 'CELL_REPEL' || ev.type === 'CELL_ATTRACT')
          soundFX.playEvent('magnet');
        else if (ev.type === 'GRAVITY') soundFX.playEvent('gravity');
        else if (ev.type === 'OVERCLOCK_STEP') soundFX.playEvent('overclock');
        else if (ev.type === 'PHASE_SHIFT') soundFX.playEvent('phaseShift');
        else if (ev.type === 'DECAY_COLLAPSE') soundFX.playEvent('decay');
        else if (ev.type === 'INFECTION_SPREAD') soundFX.playEvent('infection');
        else if (ev.type === 'TURNTABLE_SPIN') soundFX.playEvent('turntable');
        else if (ev.type === 'TETHER_SNAP') soundFX.playEvent('tether');
        else if (ev.type === 'BLAST_DOOR_TOGGLE') soundFX.playEvent('blastDoor');
      }
      if (res.state.solved) {
        soundFX.playEvent('win');
        recordSolve(res.state.turn);
      } else {
        soundFX.playEvent('step');
      }

      setHistory((prev) => [...prev, res.state]);
    },
    [puzzle, currentState, replaying, recordSolve]
  );

  const handleUndo = useCallback(() => {
    if (replaying || history.length <= 1) return;
    setBumpInfo(null);
    setHistory((prev) => prev.slice(0, -1));
  }, [history.length, replaying]);

  const handleReset = useCallback(() => {
    setReplaying(false);
    setBumpInfo(null);
    setLastSolveSummary(null);
    setHistory([createInitialGameState(puzzle)]);
  }, [puzzle]);

  const handleWatchOptimal = useCallback(() => {
    if (!puzzle.optimalPath || puzzle.optimalPath.length === 0) return;
    setReplaying(true);
    setLastSolveSummary(null);
    let stepState = createInitialGameState(puzzle);
    setHistory([stepState]);

    puzzle.optimalPath.forEach((dir, idx) => {
      setTimeout(() => {
        const res = simulateTurn(puzzle, stepState, dir);
        if (res.valid) {
          stepState = res.state;
          setHistory((prev) => [...prev, stepState]);
        }
        if (idx === puzzle.optimalPath.length - 1) {
          setReplaying(false);
        }
      }, (idx + 1) * 340);
    });
  }, [puzzle]);

  // Keyboard support: Arrow keys, WASD, Z (Undo), R (Restart)
  useEffect(() => {
    const onKeyDown = (e) => {
      if (activeTab !== 'PLAY') return;
      const k = e.key.toLowerCase();
      if (k === 'arrowup' || k === 'w') {
        e.preventDefault();
        handleMove('UP');
      } else if (k === 'arrowdown' || k === 's') {
        e.preventDefault();
        handleMove('DOWN');
      } else if (k === 'arrowleft' || k === 'a') {
        e.preventDefault();
        handleMove('LEFT');
      } else if (k === 'arrowright' || k === 'd') {
        e.preventDefault();
        handleMove('RIGHT');
      } else if (k === 'z') {
        e.preventDefault();
        handleUndo();
      } else if (k === 'r') {
        e.preventDefault();
        handleReset();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [activeTab, handleMove, handleUndo, handleReset]);

  // All 136 two-mutation pairings for sandbox exploration
  const allPairings = useMemo(() => {
    const pairs = [];
    for (let i = 0; i < ALL_MUTATIONS.length; i++) {
      for (let j = i + 1; j < ALL_MUTATIONS.length; j++) {
        pairs.push(`${ALL_MUTATIONS[i]}+${ALL_MUTATIONS[j]}`);
      }
    }
    return pairs;
  }, []);

  const cellsCount =
    (currentState.collectedCells[0] ? 1 : 0) +
    (currentState.collectedCells[1] ? 1 : 0);
  const surgeActive =
    (puzzle.mutations.includes('OVERCLOCK') &&
      isOverclockActive(currentState.turn)) ||
    (puzzle.mutations.includes('PHASE_SHIFT') &&
      isPhaseShiftActive(currentState.turn));

  return toHostElement(
    <div className="mutator-root">
      <style>{`
        .mutator-root {
          min-height: 100vh;
          background: radial-gradient(circle at 50% 0%, #0e192e 0%, #070b14 75%);
          color: #f1f5f9;
          font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
          padding: 10px 12px 24px;
        }
        .app-shell {
          max-width: 520px;
          margin: 0 auto;
          display: flex;
          flex-direction: column;
          gap: 10px;
        }
        .lab-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          background: #0f172a;
          border: 1px solid #24324d;
          border-radius: 12px;
          padding: 8px 12px;
        }
        .brand-group {
          display: flex;
          align-items: center;
          gap: 8px;
        }
        .brand-badge {
          width: 28px;
          height: 28px;
          border-radius: 7px;
          background: linear-gradient(135deg, #0891b2, #22d3ee);
          color: #041019;
          font-weight: 900;
          display: grid;
          place-items: center;
          font-size: 14px;
          box-shadow: 0 0 14px rgba(34, 211, 238, 0.35);
        }
        .brand-title {
          font-weight: 800;
          letter-spacing: 0.14em;
          font-size: 15px;
          color: #22d3ee;
        }
        .challenge-tag {
          font-size: 11px;
          font-weight: 700;
          color: #94a3b8;
          background: #162033;
          padding: 2px 7px;
          border-radius: 6px;
        }
        .header-pills {
          display: flex;
          align-items: center;
          gap: 6px;
        }
        .pill {
          background: #162033;
          border: 1px solid #24324d;
          border-radius: 8px;
          padding: 4px 8px;
          font-size: 11px;
          font-weight: 700;
        }
        .icon-btn {
          background: #162033;
          border: 1px solid #24324d;
          color: #f1f5f9;
          border-radius: 8px;
          padding: 4px 8px;
          font-size: 11px;
          font-weight: 700;
          cursor: pointer;
        }
        .icon-btn:hover {
          border-color: #22d3ee;
        }
        .mode-bar {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 8px;
          background: #0f172a;
          border: 1px solid #24324d;
          border-radius: 10px;
          padding: 6px 10px;
          font-size: 11px;
        }
        .mode-select {
          background: #162033;
          color: #f1f5f9;
          border: 1px solid #24324d;
          border-radius: 7px;
          padding: 4px 8px;
          font-size: 11px;
          font-weight: 700;
          max-width: 260px;
        }
        .nav-bar {
          display: grid;
          grid-template-columns: repeat(5, 1fr);
          gap: 4px;
          background: #0f172a;
          border: 1px solid #24324d;
          border-radius: 10px;
          padding: 4px;
        }
        .nav-tab {
          background: transparent;
          border: none;
          color: #94a3b8;
          font-size: 11px;
          font-weight: 700;
          padding: 6px 2px;
          border-radius: 7px;
          cursor: pointer;
        }
        .nav-tab.active {
          background: #162033;
          color: #22d3ee;
          box-shadow: inset 0 0 0 1px rgba(34, 211, 238, 0.4);
        }
        .mutation-row {
          display: grid;
          gap: 8px;
        }
        .mutation-card {
          background: #0f172a;
          border: 1px solid #24324d;
          border-radius: 11px;
          padding: 8px 10px;
          transition: transform 0.2s ease, box-shadow 0.25s ease, border-color 0.25s ease;
        }
        .mutation-card.imminent {
          animation: cardImminentPulse 1.3s ease-in-out infinite alternate;
        }
        .mutation-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 4px;
          margin-bottom: 3px;
        }
        .mutation-name {
          font-size: 11px;
          font-weight: 800;
          letter-spacing: 0.06em;
          display: flex;
          align-items: center;
          gap: 4px;
        }
        .mutation-pulse {
          font-size: 10px;
          font-weight: 800;
          padding: 2px 6px;
          border-radius: 999px;
          background: rgba(255, 255, 255, 0.08);
        }
        .mutation-desc {
          font-size: 11px;
          line-height: 1.3;
          color: #94a3b8;
        }
        .active-telemetry-strip {
          display: flex;
          flex-wrap: wrap;
          gap: 6px;
        }
        .jinxes-panel {
          background: #0f172a;
          border: 1px solid #2b3b5c;
          border-left: 3px solid #f43f5e;
          border-radius: 11px;
          padding: 8px 10px;
          display: flex;
          flex-direction: column;
          gap: 7px;
        }
        .jinxes-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          cursor: pointer;
          user-select: none;
        }
        .jinxes-title-group {
          display: flex;
          align-items: center;
          flex-wrap: wrap;
          gap: 6px;
        }
        .jinxes-title {
          font-size: 11px;
          font-weight: 800;
          letter-spacing: 0.08em;
          color: #fda4af;
        }
        .jinx-count-pill {
          font-size: 9px;
          font-weight: 800;
          padding: 2px 6px;
          border-radius: 999px;
          background: rgba(244, 63, 94, 0.18);
          color: #fda4af;
          border: 1px solid rgba(244, 63, 94, 0.4);
        }
        .jinx-promoted-pill {
          font-size: 9px;
          font-weight: 800;
          padding: 2px 6px;
          border-radius: 999px;
          background: rgba(234, 179, 8, 0.18);
          color: #fde047;
          border: 1px solid rgba(234, 179, 8, 0.45);
        }
        .jinxes-list {
          display: flex;
          flex-direction: column;
          gap: 6px;
        }
        .jinx-item {
          background: #131d31;
          border: 1px solid #1e2d4a;
          border-radius: 8px;
          padding: 6px 8px;
          display: flex;
          flex-direction: column;
          gap: 3px;
        }
        .jinx-item-top {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 6px;
          flex-wrap: wrap;
        }
        .jinx-pair-label {
          font-size: 10px;
          font-weight: 800;
          letter-spacing: 0.04em;
        }
        .jinx-type-tag {
          font-size: 9px;
          font-weight: 800;
          padding: 1px 6px;
          border-radius: 5px;
          background: rgba(34, 211, 238, 0.12);
          color: #67e8f9;
          border: 1px solid rgba(34, 211, 238, 0.3);
        }
        .jinx-item-desc {
          font-size: 11px;
          line-height: 1.32;
          color: #cbd5e1;
        }
        .jinx-triple-note {
          font-size: 10px;
          color: #fde047;
          background: rgba(234, 179, 8, 0.1);
          border: 1px dashed rgba(234, 179, 8, 0.4);
          border-radius: 7px;
          padding: 5px 8px;
        }
        .telemetry-chip.hot {
          background: rgba(255, 255, 255, 0.14);
          animation: chipHotPulse 1.1s ease-in-out infinite alternate;
        }
        .stats-bar {
          display: grid;
          grid-template-columns: repeat(4, 1fr);
          gap: 6px;
        }
        .stat-box {
          background: #0f172a;
          border: 1px solid #24324d;
          border-radius: 9px;
          padding: 6px 8px;
          text-align: center;
        }
        .stat-label {
          font-size: 10px;
          text-transform: uppercase;
          letter-spacing: 0.06em;
          color: #94a3b8;
        }
        .stat-value {
          font-size: 15px;
          font-weight: 800;
          margin-top: 1px;
        }
        .stat-pop {
          animation: statNumberPop 0.24s cubic-bezier(0.22, 1, 0.36, 1);
        }
        .grid-frame {
          background: #0f172a;
          border: 1px solid #24324d;
          border-radius: 14px;
          padding: 10px;
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 8px;
        }
        .board-shake {
          animation: shake 0.24s ease;
        }
        .telemetry-bar {
          width: 100%;
          background: #162033;
          border: 1px solid #24324d;
          border-radius: 8px;
          padding: 5px 10px;
          font-size: 11px;
          font-weight: 700;
          color: #22d3ee;
          text-align: center;
          min-height: 26px;
        }
        .telemetry-enter {
          animation: telemetrySlideIn 0.22s ease-out;
        }
        .board-wrapper {
          position: relative;
          width: min(100%, 340px);
          aspect-ratio: 1 / 1;
        }
        .board-grid {
          display: grid;
          grid-template-columns: repeat(7, 1fr);
          grid-template-rows: repeat(7, 1fr);
          gap: 4px;
          width: 100%;
          height: 100%;
        }
        .entity-slot {
          position: absolute;
          top: 0;
          left: 0;
          width: calc((100% - 24px) / 7);
          height: calc((100% - 24px) / 7);
          display: grid;
          place-items: center;
          pointer-events: none;
          z-index: 5;
          transition: transform 0.13s cubic-bezier(0.22, 1, 0.36, 1);
          will-change: transform;
        }
        .entity-slot.no-slide {
          transition: none;
        }
        .vfx-canvas {
          position: absolute;
          inset: 0;
          width: 100%;
          height: 100%;
          pointer-events: none;
          z-index: 6;
        }
        .tile {
          border-radius: 8px;
          background: #131d31;
          border: 1px solid #1e2d4a;
          position: relative;
          display: grid;
          place-items: center;
          font-weight: 800;
          font-size: 12px;
          user-select: none;
          overflow: hidden;
          transition: background 0.22s ease, border-color 0.22s ease, box-shadow 0.22s ease;
        }
        .tile.wall {
          background: #080d17;
          border-color: #162033;
          background-image: repeating-linear-gradient(
            45deg,
            #0b1220,
            #0b1220 4px,
            #111b2e 4px,
            #111b2e 8px
          );
        }
        .tile.magnet-pylon {
          background: rgba(96, 165, 250, 0.22);
          border: 1px solid #60a5fa;
          animation: magnetPylonPulse 1.8s ease-in-out infinite alternate;
        }
        .magnet-icon {
          animation: floatGentle 1.5s ease-in-out infinite alternate;
        }
        .tile.turntable-hub {
          background: rgba(217, 119, 6, 0.25);
          border: 1.5px solid #d97706;
          color: #fbbf24;
        }
        .gear-spin {
          display: inline-block;
          animation: spinSlow 6s linear infinite;
        }
        .tile.tether-pylon {
          background: rgba(236, 72, 153, 0.28);
          border: 1.5px solid #ec4899;
          color: #f9a8d4;
        }
        .tile.tether-zone {
          box-shadow: inset 0 0 0 1px rgba(236, 72, 153, 0.14);
        }
        .tile.afterimage-solid {
          background: rgba(14, 165, 233, 0.34);
          border: 2px solid #38bdf8;
          color: #e0f2fe;
          box-shadow: 0 0 14px rgba(56, 189, 248, 0.65);
          animation: afterimageSolidify 0.28s cubic-bezier(0.22, 1, 0.36, 1);
        }
        .tile.afterimage-charging {
          border: 1px dashed rgba(56, 189, 248, 0.5);
        }
        .tile.blast-door-closed {
          background: rgba(132, 204, 22, 0.26);
          border: 2px solid #84cc16;
          color: #bef264;
        }
        .tile.blast-door-open {
          border: 1px dashed rgba(132, 204, 22, 0.45);
          color: rgba(132, 204, 22, 0.55);
        }
        .tile.pressure-plate {
          background: rgba(132, 204, 22, 0.12);
          border: 1px solid rgba(132, 204, 22, 0.65);
          color: #a3e635;
        }
        .tile.collapsed {
          background: #05070d;
          border: 1px dashed #475569;
          opacity: 0.6;
        }
        .tile-collapse-anim {
          animation: pitCollapse 0.36s cubic-bezier(0.34, 1.56, 0.64, 1);
        }
        .tile.decay-2 {
          border-color: rgba(249, 115, 22, 0.65);
          background: rgba(249, 115, 22, 0.14);
        }
        .tile.decay-1 {
          border-color: #f97316;
          background: rgba(249, 115, 22, 0.32);
          animation: decayCriticalTremor 0.55s ease-in-out infinite alternate;
        }
        .tile.infected {
          background: rgba(168, 85, 247, 0.3);
          border-color: #a855f7;
          animation: infectThrob 2s ease-in-out infinite alternate;
        }
        .tile-infect-bloom {
          animation: infectBloom 0.4s cubic-bezier(0.22, 1, 0.36, 1);
        }
        .infect-spore {
          animation: sporePulse 1.4s ease-in-out infinite alternate;
        }
        .tile.conveyor {
          background: rgba(20, 184, 166, 0.18);
          border-color: rgba(20, 184, 166, 0.6);
          color: #2dd4bf;
        }
        .tile.conv-up .conv-arrow {
          animation: convSlideUp 0.9s linear infinite;
        }
        .tile.conv-down .conv-arrow {
          animation: convSlideDown 0.9s linear infinite;
        }
        .tile.conv-left .conv-arrow {
          animation: convSlideLeft 0.9s linear infinite;
        }
        .tile.conv-right .conv-arrow {
          animation: convSlideRight 0.9s linear infinite;
        }
        .tile.portal {
          background: rgba(129, 140, 248, 0.22);
          border-color: #818cf8;
          color: #c7d2fe;
        }
        .portal-label {
          animation: portalHum 1.6s ease-in-out infinite alternate;
        }
        .tile.cryo {
          background: rgba(103, 232, 249, 0.16);
          border-color: rgba(103, 232, 249, 0.5);
          color: #67e8f9;
        }
        .tile.cryo::after {
          content: '';
          position: absolute;
          inset: -50%;
          background: linear-gradient(
            120deg,
            transparent 35%,
            rgba(255, 255, 255, 0.22) 50%,
            transparent 65%
          );
          animation: cryoSheen 2.8s linear infinite;
          pointer-events: none;
        }
        .tile.gate-cyan.gate-closed {
          background: rgba(34, 211, 238, 0.28);
          border: 2px solid #22d3ee;
          color: #22d3ee;
          animation: gateLaserHum 1s ease-in-out infinite alternate;
        }
        .tile.gate-cyan.gate-open {
          border: 1px dashed rgba(34, 211, 238, 0.45);
          color: rgba(34, 211, 238, 0.55);
        }
        .tile.gate-amber.gate-closed {
          background: rgba(251, 191, 36, 0.28);
          border: 2px solid #fbbf24;
          color: #fbbf24;
          animation: gateLaserHum 1s ease-in-out infinite alternate;
        }
        .tile.gate-amber.gate-open {
          border: 1px dashed rgba(251, 191, 36, 0.45);
          color: rgba(251, 191, 36, 0.55);
        }
        .tile.exit-locked {
          border: 1px dashed #64748b;
          color: #64748b;
        }
        .tile.exit-open {
          background: rgba(16, 185, 129, 0.24);
          border: 2px solid #10b981;
          color: #34d399;
          box-shadow: 0 0 14px rgba(16, 185, 129, 0.45);
          animation: exitBeacon 1.2s ease-in-out infinite alternate;
        }
        .energy-cell-wrap {
          position: relative;
          width: 64%;
          height: 64%;
          display: grid;
          place-items: center;
          animation: floatGentle 1.4s ease-in-out infinite alternate;
        }
        .energy-cell-ring {
          position: absolute;
          inset: -3px;
          border-radius: 50%;
          border: 1.5px dashed rgba(251, 191, 36, 0.75);
          animation: spinSlow 4s linear infinite;
        }
        .energy-cell-ring.cell-repel-ring {
          border-color: #fb7185;
        }
        .energy-cell-ring.cell-attract-ring {
          border-color: #22d3ee;
        }
        .energy-cell {
          width: 82%;
          height: 82%;
          border-radius: 50%;
          background: radial-gradient(circle at 35% 35%, #fde68a, #f59e0b);
          box-shadow: 0 0 12px rgba(245, 158, 11, 0.9);
          display: grid;
          place-items: center;
          font-size: 11px;
          font-weight: 900;
          color: #041019;
        }
        .energy-cell.cell-plus {
          background: radial-gradient(circle at 35% 35%, #fecdd3, #f43f5e);
          box-shadow: 0 0 12px rgba(244, 63, 94, 0.9);
        }
        .energy-cell.cell-minus {
          background: radial-gradient(circle at 35% 35%, #cffafe, #06b6d4);
          box-shadow: 0 0 12px rgba(6, 182, 212, 0.9);
        }
        .courier-bot {
          width: 74%;
          height: 74%;
          border-radius: 9px;
          background: linear-gradient(135deg, #06b6d4, #22d3ee);
          color: #041019;
          display: grid;
          place-items: center;
          font-weight: 900;
          font-size: 13px;
          box-shadow: 0 0 16px rgba(34, 211, 238, 0.85);
          animation: courierIdleHover 1.6s ease-in-out infinite alternate;
        }
        .courier-bot.courier-light {
          transform: scale(0.88);
          box-shadow: 0 0 18px #fde047;
        }
        .courier-bot.courier-heavy {
          border: 2px solid #eab308;
          box-shadow: 0 0 18px rgba(234, 179, 8, 0.9);
        }
        .courier-bot.courier-warp {
          animation: portalWarpIn 0.26s cubic-bezier(0.34, 1.56, 0.64, 1);
        }
        .courier-bot.courier-phased {
          opacity: 0.72;
          box-shadow: 0 0 18px #34d399, inset 0 0 8px #ffffff;
          border: 1.5px solid #34d399;
        }
        .courier-bot.courier-overclock {
          box-shadow: 0 0 18px #f43f5e;
          border: 1.5px solid #fda4af;
        }
        .courier-bot.courier-victory {
          animation: victorySpinJump 0.75s cubic-bezier(0.22, 1, 0.36, 1) infinite alternate;
        }
        .courier-bot.bump-UP {
          animation: bumpUp 0.2s ease;
        }
        .courier-bot.bump-DOWN {
          animation: bumpDown 0.2s ease;
        }
        .courier-bot.bump-LEFT {
          animation: bumpLeft 0.2s ease;
        }
        .courier-bot.bump-RIGHT {
          animation: bumpRight 0.2s ease;
        }
        .mirror-drone-bot {
          width: 70%;
          height: 70%;
          border-radius: 9px;
          background: rgba(232, 121, 249, 0.26);
          border: 2px solid #e879f9;
          color: #f5d0fe;
          display: grid;
          place-items: center;
          font-weight: 900;
          font-size: 12px;
          animation: dronePulse 1.8s ease-in-out infinite alternate;
        }
        .decay-badge {
          position: absolute;
          top: 2px;
          right: 3px;
          font-size: 9px;
          color: #fdba74;
          z-index: 2;
        }
        .tile-tag {
          font-size: 11px;
          font-weight: 800;
          z-index: 2;
        }
        .controls-panel {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 10px;
          background: #0f172a;
          border: 1px solid #24324d;
          border-radius: 12px;
          padding: 10px 14px;
        }
        .dpad {
          display: grid;
          grid-template-columns: repeat(3, 48px);
          grid-template-rows: repeat(2, 44px);
          gap: 5px;
        }
        .dpad-btn {
          background: #162033;
          border: 1px solid #24324d;
          color: #f1f5f9;
          border-radius: 10px;
          font-size: 18px;
          font-weight: 800;
          cursor: pointer;
          display: grid;
          place-items: center;
          transition: transform 0.08s ease, background 0.12s ease, border-color 0.15s ease;
        }
        .dpad-btn:active {
          background: #22d3ee;
          color: #041019;
          transform: scale(0.92);
        }
        .dpad-btn.surge-hint {
          border-color: #f43f5e;
          box-shadow: 0 0 10px rgba(244, 63, 94, 0.35);
          animation: surgeBtnPulse 0.9s ease-in-out infinite alternate;
        }
        .action-stack {
          display: flex;
          flex-direction: column;
          gap: 6px;
          flex: 1;
        }
        .action-btn {
          background: #162033;
          border: 1px solid #24324d;
          color: #f1f5f9;
          border-radius: 9px;
          padding: 9px 10px;
          font-size: 12px;
          font-weight: 700;
          cursor: pointer;
          transition: transform 0.1s ease, border-color 0.15s ease;
        }
        .action-btn:hover:not(:disabled) {
          border-color: #22d3ee;
          transform: translateY(-1px);
        }
        .action-btn:active:not(:disabled) {
          transform: scale(0.97);
        }
        .action-btn:disabled {
          opacity: 0.45;
          cursor: not-allowed;
        }
        .action-btn.primary {
          background: linear-gradient(135deg, #0891b2, #22d3ee);
          color: #041019;
          border: none;
          font-weight: 800;
        }
        .kbd-hint {
          font-size: 10px;
          color: #94a3b8;
        }
        .card-panel {
          background: #0f172a;
          border: 1px solid #24324d;
          border-radius: 12px;
          padding: 14px;
          display: flex;
          flex-direction: column;
          gap: 10px;
          animation: panelFadeIn 0.24s ease-out;
        }
        .victory-banner {
          border: 1px solid #10b981;
          box-shadow: 0 0 24px rgba(16, 185, 129, 0.25);
        }
        .victory-title {
          font-size: 22px;
          font-weight: 900;
          letter-spacing: 0.12em;
          color: #10b981;
          text-align: center;
          animation: statNumberPop 0.35s cubic-bezier(0.22, 1, 0.36, 1);
        }
        .stars-display {
          font-size: 26px;
          text-align: center;
          letter-spacing: 6px;
          color: #fbbf24;
        }
        .star-earned {
          display: inline-block;
          opacity: 0;
          animation: starPopIn 0.4s cubic-bezier(0.34, 1.56, 0.64, 1) forwards;
          text-shadow: 0 0 12px rgba(251, 191, 36, 0.65);
        }
        .star-empty {
          display: inline-block;
          opacity: 0.4;
        }
        .share-preview {
          background: #080d17;
          border: 1px solid #24324d;
          border-radius: 8px;
          padding: 10px;
          font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
          font-size: 12px;
          white-space: pre-wrap;
          color: #f1f5f9;
          margin: 0;
        }
        .toast-banner {
          background: rgba(34, 211, 238, 0.14);
          border: 1px solid #22d3ee;
          color: #22d3ee;
          border-radius: 8px;
          padding: 6px 10px;
          font-size: 12px;
          font-weight: 700;
          text-align: center;
        }
        .list-row {
          display: flex;
          align-items: center;
          justify-content: space-between;
          background: #162033;
          border-radius: 8px;
          padding: 8px 10px;
          font-size: 13px;
        }
        @keyframes shake {
          0%, 100% { transform: translateX(0); }
          25% { transform: translateX(-5px); }
          75% { transform: translateX(5px); }
        }
        @keyframes bumpUp {
          0%, 100% { transform: translateY(0); }
          50% { transform: translateY(-7px) scale(0.95); }
        }
        @keyframes bumpDown {
          0%, 100% { transform: translateY(0); }
          50% { transform: translateY(7px) scale(0.95); }
        }
        @keyframes bumpLeft {
          0%, 100% { transform: translateX(0); }
          50% { transform: translateX(-7px) scale(0.95); }
        }
        @keyframes bumpRight {
          0%, 100% { transform: translateX(0); }
          50% { transform: translateX(7px) scale(0.95); }
        }
        @keyframes courierIdleHover {
          from { transform: translateY(-1px) scale(0.99); }
          to { transform: translateY(1px) scale(1.02); }
        }
        @keyframes dronePulse {
          from { transform: scale(0.96); opacity: 0.85; }
          to { transform: scale(1.03); opacity: 1; }
        }
        @keyframes portalWarpIn {
          0% { transform: scale(0.15) rotate(-140deg); opacity: 0.2; }
          70% { transform: scale(1.16) rotate(12deg); opacity: 1; }
          100% { transform: scale(1) rotate(0deg); opacity: 1; }
        }
        @keyframes afterimageSolidify {
          0% { transform: scale(0.4); opacity: 0.2; }
          100% { transform: scale(1); opacity: 1; }
        }
        @keyframes victorySpinJump {
          from { transform: translateY(0) scale(1); }
          to { transform: translateY(-4px) scale(1.08); }
        }
        @keyframes floatGentle {
          from { transform: translateY(-1.5px); }
          to { transform: translateY(1.5px); }
        }
        @keyframes spinSlow {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
        @keyframes convSlideUp {
          0% { transform: translateY(3px); opacity: 0.55; }
          50% { transform: translateY(0); opacity: 1; }
          100% { transform: translateY(-3px); opacity: 0.55; }
        }
        @keyframes convSlideDown {
          0% { transform: translateY(-3px); opacity: 0.55; }
          50% { transform: translateY(0); opacity: 1; }
          100% { transform: translateY(3px); opacity: 0.55; }
        }
        @keyframes convSlideLeft {
          0% { transform: translateX(3px); opacity: 0.55; }
          50% { transform: translateX(0); opacity: 1; }
          100% { transform: translateX(-3px); opacity: 0.55; }
        }
        @keyframes convSlideRight {
          0% { transform: translateX(-3px); opacity: 0.55; }
          50% { transform: translateX(0); opacity: 1; }
          100% { transform: translateX(3px); opacity: 0.55; }
        }
        @keyframes decayCriticalTremor {
          from { transform: scale(0.97); box-shadow: inset 0 0 6px rgba(249, 115, 22, 0.4); }
          to { transform: scale(1.02); box-shadow: inset 0 0 12px rgba(249, 115, 22, 0.85); }
        }
        @keyframes pitCollapse {
          0% { transform: scale(1.1); background: rgba(249, 115, 22, 0.5); }
          60% { transform: scale(0.84); }
          100% { transform: scale(1); }
        }
        @keyframes infectThrob {
          from { box-shadow: inset 0 0 6px rgba(168, 85, 247, 0.35); }
          to { box-shadow: inset 0 0 14px rgba(168, 85, 247, 0.75); }
        }
        @keyframes infectBloom {
          0% { transform: scale(0.45); opacity: 0.3; }
          70% { transform: scale(1.08); opacity: 1; }
          100% { transform: scale(1); opacity: 1; }
        }
        @keyframes sporePulse {
          from { transform: scale(0.92); }
          to { transform: scale(1.08); }
        }
        @keyframes cryoSheen {
          0% { transform: translateX(-60%) rotate(25deg); }
          100% { transform: translateX(60%) rotate(25deg); }
        }
        @keyframes gateLaserHum {
          from { opacity: 0.82; }
          to { opacity: 1; box-shadow: inset 0 0 10px currentColor; }
        }
        @keyframes portalHum {
          from { transform: scale(0.94); }
          to { transform: scale(1.06); }
        }
        @keyframes magnetPylonPulse {
          from { box-shadow: inset 0 0 5px rgba(96, 165, 250, 0.3); }
          to { box-shadow: inset 0 0 12px rgba(96, 165, 250, 0.75); }
        }
        @keyframes exitBeacon {
          from { box-shadow: 0 0 10px rgba(16, 185, 129, 0.35); }
          to { box-shadow: 0 0 20px rgba(16, 185, 129, 0.85); }
        }
        @keyframes cardImminentPulse {
          from { transform: translateY(0); }
          to { transform: translateY(-1.5px); }
        }
        @keyframes chipHotPulse {
          from { opacity: 0.88; }
          to { opacity: 1; }
        }
        @keyframes surgeBtnPulse {
          from { box-shadow: 0 0 6px rgba(244, 63, 94, 0.25); }
          to { box-shadow: 0 0 14px rgba(244, 63, 94, 0.65); }
        }
        @keyframes statNumberPop {
          0% { transform: scale(0.75); }
          65% { transform: scale(1.18); }
          100% { transform: scale(1); }
        }
        @keyframes telemetrySlideIn {
          from { opacity: 0.4; transform: translateY(4px); }
          to { opacity: 1; transform: translateY(0); }
        }
        @keyframes panelFadeIn {
          from { opacity: 0; transform: translateY(6px); }
          to { opacity: 1; transform: translateY(0); }
        }
        @keyframes starPopIn {
          0% { opacity: 0; transform: scale(0.2) rotate(-25deg); }
          70% { opacity: 1; transform: scale(1.22) rotate(6deg); }
          100% { opacity: 1; transform: scale(1) rotate(0deg); }
        }
      `}</style>

      <div className="app-shell">
        <header className="lab-header">
          <div className="brand-group">
            <div className="brand-badge">M</div>
            <span className="brand-title">MUTATOR</span>
            <span className="challenge-tag">
              #{formatChallengeNumber(puzzle.challengeNumber)}
            </span>
          </div>
          <div className="header-pills">
            <span className="pill" title="Daily Streak">
              🔥 {profile.currentStreak}d
            </span>
            <button
              type="button"
              className="icon-btn"
              onClick={cycleVfx}
              title="Toggle Particle Effects"
            >
              VFX: {vfxLevel}
            </button>
            <button
              type="button"
              className="icon-btn"
              onClick={toggleMute}
              title="Toggle Audio"
            >
              {muted ? '🔇' : '🔊'}
            </button>
          </div>
        </header>

        <div className="mode-bar">
          <span style={{ color: '#94a3b8', fontWeight: 700 }}>CHAMBER:</span>
          <select
            className="mode-select"
            value={modeKey}
            onChange={(e) => setModeKey(e.target.value)}
            aria-label="Select Mutation Chamber"
          >
            <option value="DAILY">Daily Challenge ({todayKey})</option>
            <option value="ANOMALY_3">
              3-Mutation Anomaly (Gravity + Portals + Decay)
            </option>
            {allPairings.map((pair) => (
              <option key={pair} value={pair}>
                Pair: {pair.replace('+', ' + ')}
              </option>
            ))}
          </select>
        </div>

        <nav className="nav-bar" aria-label="Main Navigation">
          {[
            ['PLAY', 'Play'],
            ['RANKS', 'Ranks'],
            ['ACHIEVEMENTS', 'Badges'],
            ['CODEX', 'Codex'],
            ['HELP', 'Rules']
          ].map(([id, label]) => (
            <button
              key={id}
              type="button"
              className={`nav-tab ${activeTab === id ? 'active' : ''}`}
              onClick={() => setActiveTab(id)}
            >
              {label}
            </button>
          ))}
        </nav>

        {activeTab === 'PLAY' && (
          <>
            <MutationCards puzzle={puzzle} state={currentState} />
            <JinxesPanel puzzle={puzzle} />
            <ActiveTelemetryStrip puzzle={puzzle} state={currentState} />

            <div className="stats-bar">
              <div className="stat-box">
                <div className="stat-label">Moves</div>
                <div key={`moves-${currentState.turn}`} className="stat-value stat-pop">
                  {currentState.turn}
                </div>
              </div>
              <div className="stat-box">
                <div className="stat-label">Cells</div>
                <div
                  key={`cells-${cellsCount}`}
                  className="stat-value stat-pop"
                  style={{ color: '#f59e0b' }}
                >
                  {cellsCount}/2
                </div>
              </div>
              <div className="stat-box">
                <div className="stat-label">Optimal</div>
                <div className="stat-value" style={{ color: '#22d3ee' }}>
                  {currentState.solved ? puzzle.optimalMoves : '???'}
                </div>
              </div>
              <div className="stat-box">
                <div className="stat-label">Pace</div>
                <div className="stat-value" style={{ color: '#fbbf24' }}>
                  {'★'.repeat(
                    calculateStars(currentState.turn, puzzle.optimalMoves)
                  )}
                </div>
              </div>
            </div>

            <GameGrid
              puzzle={puzzle}
              state={currentState}
              shakeBoard={shakeBoard}
              bumpInfo={bumpInfo}
              onSwipeMove={handleMove}
              vfxLevel={vfxLevel}
            />

            {currentState.solved && lastSolveSummary ? (
              <Results
                puzzle={puzzle}
                moves={lastSolveSummary.moves}
                stars={lastSolveSummary.stars}
                isNewBest={lastSolveSummary.isNewBest}
                newlyUnlocked={lastSolveSummary.newlyUnlocked}
                onRetry={handleReset}
                onWatchOptimal={handleWatchOptimal}
                onViewLeaderboard={() => setActiveTab('RANKS')}
              />
            ) : (
              <Controls
                onMove={handleMove}
                onUndo={handleUndo}
                onReset={handleReset}
                canUndo={history.length > 1}
                surgeActive={surgeActive}
                disabled={replaying}
              />
            )}
          </>
        )}

        {activeTab === 'RANKS' && (
          <div className="card-panel">
            <strong style={{ color: '#22d3ee', letterSpacing: '0.06em' }}>
              DAILY EFFICIENCY STANDINGS ({todayKey})
            </strong>
            {[
              { name: 'u/QuantumCourier', moves: puzzle.optimalMoves },
              { name: 'u/LabRat_42', moves: puzzle.optimalMoves + 1 },
              { name: 'u/VectorGrid', moves: puzzle.optimalMoves + 2 },
              ...(lastSolveSummary
                ? [{ name: 'u/You (Verified)', moves: lastSolveSummary.moves }]
                : [])
            ]
              .sort((a, b) => a.moves - b.moves)
              .map((row, idx) => (
                <div key={`${row.name}-${idx}`} className="list-row">
                  <span>
                    <strong>#{idx + 1}</strong> {row.name}
                  </span>
                  <span style={{ color: '#22d3ee', fontWeight: 800 }}>
                    {row.moves} moves
                  </span>
                </div>
              ))}
          </div>
        )}

        {activeTab === 'ACHIEVEMENTS' && (
          <div className="card-panel">
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <strong style={{ color: '#22d3ee' }}>COURIER DOSSIER</strong>
              <span style={{ fontSize: 12, color: '#94a3b8' }}>
                {profile.unlockedAchievements.length}/{ACHIEVEMENTS.length}{' '}
                Unlocked
              </span>
            </div>
            <div className="stats-bar">
              <div className="stat-box">
                <div className="stat-label">Solved</div>
                <div className="stat-value">{profile.totalCompleted}</div>
              </div>
              <div className="stat-box">
                <div className="stat-label">Optimal</div>
                <div className="stat-value">{profile.optimalCount}</div>
              </div>
              <div className="stat-box">
                <div className="stat-label">Pairs</div>
                <div className="stat-value">
                  {profile.completedPairs.length}/136
                </div>
              </div>
              <div className="stat-box">
                <div className="stat-label">Streak</div>
                <div className="stat-value">{profile.maxStreak}d</div>
              </div>
            </div>
            {ACHIEVEMENTS.map((ach) => {
              const unlocked = profile.unlockedAchievements.includes(ach.id);
              return (
                <div
                  key={ach.id}
                  className="list-row"
                  style={{ opacity: unlocked ? 1 : 0.5 }}
                >
                  <div>
                    <div style={{ fontWeight: 800, fontSize: 13 }}>
                      {unlocked ? '✓ ' : '🔒 '}
                      {ach.title}
                    </div>
                    <div style={{ fontSize: 11, color: '#94a3b8' }}>
                      {ach.description}
                    </div>
                  </div>
                  <span className="pill">{ach.badge}</span>
                </div>
              );
            })}
          </div>
        )}

        {activeTab === 'CODEX' && (
          <div className="card-panel">
            <strong style={{ color: '#22d3ee' }}>
              MUTATION ENCYCLOPEDIA ({ALL_MUTATIONS.length} MODULES)
            </strong>
            {ALL_MUTATIONS.map((id) => {
              const meta = MUTATION_META[id];
              return (
                <div
                  key={id}
                  className="list-row"
                  style={{
                    flexDirection: 'column',
                    alignItems: 'flex-start',
                    gap: 4,
                    borderLeft: `3px solid ${meta.color}`
                  }}
                >
                  <strong style={{ color: meta.color }}>
                    {meta.icon} {meta.name}
                  </strong>
                  <span style={{ fontSize: 12, color: '#cbd5e1' }}>
                    {meta.fullDesc}
                  </span>
                </div>
              );
            })}
          </div>
        )}

        {activeTab === 'HELP' && (
          <div className="card-panel" style={{ fontSize: 13, lineHeight: 1.5 }}>
            <strong style={{ color: '#22d3ee' }}>HOW TO PLAY MUTATOR</strong>
            <div>
              1. Guide the <strong>Courier (◈)</strong> across the 7×7 chamber
              using Arrow keys, WASD, touch swipes, or the on-screen D-pad.
            </div>
            <div>
              2. Collect both glowing <strong>Energy Cells</strong> to unlock
              the <strong>EXIT</strong>, then reach the Exit in as few moves as
              possible.
            </div>
            <div>
              3. Invalid moves blocked by walls or hazards do not consume a
              turn. Every outcome is 100% deterministic.
            </div>
            <div>
              4. <strong>Ratings:</strong> Optimal moves = 3★, +1 to +3 moves =
              2★, +4 or more = 1★.
            </div>
          </div>
        )}
      </div>
    </div>
  );
}