// Read-only helpers that let the UI show what the world will do next.
// Everything here is derived from the same rules the simulator uses, so the
// board never hides information from the player.

import { ACTIONS, manhattan } from './grid.ts';
import { blightTarget, step } from './sim.ts';
import type { Action, Dir, GameState, StepEvent } from './types.ts';
import {
  activePhaseLayer,
  beamLine,
  closedPolarity,
  floodDepth,
  gravityDir,
  isOverclock,
  isPhaseShift,
  layerFor,
  portalMode,
  ventsActive,
  exitFor,
  type BeamLine,
  type World
} from './world.ts';

export type TurnInfo = {
  /** Completed turns before this move (0-based); the move number is turn + 1. */
  turn: number;
  gravity: Dir | null;
  overclock: boolean;
  phaseShift: boolean;
  closedGate: 0 | 1 | null;
  portalMode: 0 | 1 | null;
  beam: BeamLine | null;
  flood: number;
  phaseLayer: 0 | 1 | null;
  vents: boolean | null;
  /** Turntables rotate at the end of this move. */
  spinAfter: boolean;
  /** Blight spreads at the end of this move. */
  blightAfter: boolean;
  /** Where the exit is for this move, as a well name (Hatches). */
  exitAt: string | null;
  /** Whether the exit is somewhere new on this move (Hatches). */
  exitMoves: boolean;
};

function wellName(i: number): string {
  return `${'ABCDEFG'[Math.floor(i / 7)]}${(i % 7) + 1}`;
}

export function turnInfo(w: World, turn: number): TurnInfo {
  const h = w.has;
  return {
    turn,
    gravity: h.GRAVITY ? gravityDir(turn) : null,
    overclock: h.OVERCLOCK === true && isOverclock(turn),
    phaseShift: h.PHASE_SHIFT === true && isPhaseShift(turn),
    closedGate: h.PHASE_GATES ? closedPolarity(turn) : null,
    portalMode: h.PORTALS ? portalMode(turn) : null,
    beam: beamLine(w, turn),
    flood: floodDepth(w, turn),
    phaseLayer: h.PHASE_LAYERS ? activePhaseLayer(turn) : null,
    vents: h.VENTILATION ? ventsActive(turn) : null,
    spinAfter: w.hubs.length > 0 && (turn + 1) % 3 === 0,
    blightAfter: h.INFECTION === true && (turn + 1) % 2 === 0,
    exitAt: h.HATCHES ? wellName(exitFor(w, turn)) : null,
    exitMoves: h.HATCHES === true && turn > 0 && exitFor(w, turn) !== exitFor(w, turn - 1)
  };
}

export function forecast(w: World, turn: number, count: number): TurnInfo[] {
  const out: TurnInfo[] = [];
  for (let k = 0; k < count; k++) out.push(turnInfo(w, turn + k));
  return out;
}

export type Preview = { action: Action; ok: boolean; to: number; events: StepEvent[]; state: GameState | null };

/** Where each possible action would take the courier this turn. */
export function previewActions(w: World, s: GameState): Preview[] {
  return ACTIONS.map((action) => {
    const res = step(w, s, action);
    if (!res.ok) return { action, ok: false, to: s.pos, events: [], state: null };
    return { action, ok: true, to: res.state.pos, events: res.events, state: res.state };
  });
}

export type BlightForecast = { target: number; inMoves: number };

/** The tile blight is aiming for, assuming nothing else changes. */
export function nextBlight(w: World, s: GameState): BlightForecast | null {
  if (!w.has.INFECTION) return null;
  const inMoves = s.turn % 2 === 1 ? 1 : 2;
  const spreadTurn = s.turn + inMoves;
  const target = blightTarget(
    w,
    layerFor(w, s.turn),
    s.blight,
    s.decay,
    s.pos,
    s.drone,
    s.echo,
    s.after,
    s.doorsOpen,
    spreadTurn,
    s.crates
  );
  return target >= 0 ? { target, inMoves } : null;
}

/** Courier waypoints for animation, in order, with the kind of motion. */
export type Waypoint = { to: number; kind: StepEvent['t']; jump: boolean };

export function courierWaypoints(events: StepEvent[]): Waypoint[] {
  const out: Waypoint[] = [];
  for (const e of events) {
    switch (e.t) {
      case 'move':
      case 'conveyor':
      case 'vent':
      case 'reflect':
      case 'slide':
      case 'repel':
      case 'attract':
      case 'magnet':
      case 'gravity':
      case 'tether':
      case 'spinRide':
        out.push({ to: e.to, kind: e.t, jump: (e.t === 'move' && e.kind === 'phase') || manhattan(e.from, e.to) > 2 });
        break;
      case 'ride':
        out.push({ to: e.to, kind: e.t, jump: false });
        break;
      case 'portal':
      case 'spring':
        out.push({ to: e.to, kind: e.t, jump: true });
        break;
      default:
        break;
    }
  }
  return out;
}
