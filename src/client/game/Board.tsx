import { useEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent as RPointerEvent } from 'react';
import { CELLS, DIRS, N, colOf, rowOf, stepIdx, dirBetween, delta, manhattan } from '../../shared/engine/grid.ts';
import { MUTATIONS } from '../../shared/engine/mutations.ts';
import { nextBlight, courierWaypoints, type Preview } from '../../shared/engine/forecast.ts';
import { cellAt, laserBeams, massTier } from '../../shared/engine/sim.ts';
import type { Action, Dir, GameState, StepEvent } from '../../shared/engine/types.ts';
import {
  activePhaseLayer,
  beamLine,
  cellPosAt,
  closedPolarity,
  floodDepth,
  isFloodedAt,
  layerFor,
  portalMode,
  portalPartner,
  ventsActive,
  emitterDir,
  exitFor,
  HATCH_PERIOD,
  shuttleAt,
  type World
} from '../../shared/engine/world.ts';

const ROWS = 'ABCDEFG';
const GATE_INK = ['#E8579B', '#1F6FD1'];
const PORTAL_INK = ['#14A3C7', '#E07A10'];
const PORTAL_LABEL = 'ABCD';
export const PAINT_INK = ['#1C9C5A', '#8B4FD9'];
const PAINT_WORD = ['green', 'violet'];
const ROT: Record<Dir, number> = { U: 0, R: 90, D: 180, L: 270 };
const DIR_WORD: Record<Dir, string> = { U: 'up', R: 'right', D: 'down', L: 'left' };

function wrapDist(w: World, a: number, b: number): number {
  const { dr, dc } = delta(a, b, w.has.WRAPAROUND === true);
  return Math.abs(dr) + Math.abs(dc);
}

/** Plain-language description of everything on one tile. */
function describeTile(w: World, s: GameState, tiles: TileView[], i: number): string {
  const t = tiles[i];
  if (!t) return '';
  const out: string[] = [];
  const where = `${ROWS[rowOf(i)]}${colOf(i) + 1}`;
  if (s.pos === i) {
    out.push('You. Grab both cells, then reach the exit.');
    if (s.stuck) out.push('Stuck in mud: your next move only pulls you free.');
    if (s.paint) out.push(`You are ${PAINT_WORD[s.paint - 1]}.`);
    if (s.keys) out.push(`Holding ${s.keys} ${s.keys === 1 ? 'key' : 'keys'}.`);
    if (w.has.LOW_CHARGE) out.push(`${s.charge} of ${w.chargeMax} charge left.`);
  }
  for (const k of [0, 1]) {
    if (s.got & (1 << k)) continue;
    if (cellAt(w, s, k) === i) {
      out.push(
        w.has.SKITTISH_CELLS
          ? 'Skittish cell. It steps away whenever you end a move within 2 tiles of it. Corner it.'
          : w.has.MAGNETIC_CELLS
          ? k === 0
            ? 'Cell (+). Pushes you away if you stop next to it.'
            : 'Cell (−). Pulls you in from up to 2 tiles away.'
          : 'Energy cell. Walk onto it to pick it up.'
      );
    } else if (w.has.SKITTISH_CELLS && wrapDist(w, cellAt(w, s, k), i) <= 2) {
      out.push('Inside a skittish cell’s zone. End a move here and the cell runs.');
    } else if (w.has.ORBITAL_CELLS && !w.has.SKITTISH_CELLS && cellPosAt(w, k, s.turn + 1) === i) {
      out.push('An orbiting cell moves here after your next move.');
    }
  }
  if (s.crates.includes(i))
    out.push(w.has.PUCKS ? 'Puck. Push it and it slides until something stops it.' : 'Crate. Walk into it to push it one tile. It can’t be pulled.');
  if (t.chasm) {
    const parked = w.tracks.some((_, k) => shuttleAt(w, k, s.turn) === i);
    out.push(parked ? 'Shuttle. Step on and it carries you one tile along the track at the end of your move.' : 'Chasm. Only a shuttle can take you across.');
  }
  if (t.hatch !== null) out.push(`Hatch, closed. The exit opens here in ${t.hatch} ${t.hatch === 1 ? 'move' : 'moves'}.`);
  if (t.charger) out.push('Charger. End a move here to refill your charge.');
  if (t.emitter) out.push(`Laser emitter, firing ${DIR_WORD[t.emitter]}. It turns a quarter clockwise every 3 moves.`);
  if (t.lit) out.push('Laser beam. You cannot step into it. Anything solid in its path cuts it off.');
  if (w.has.WRAPAROUND && (rowOf(i) === 0 || rowOf(i) === N - 1 || colOf(i) === 0 || colOf(i) === N - 1))
    out.push('Edge tile. Moving off the board here brings you in on the opposite side.');
  if (s.drone === i) out.push('Mirror drone. Moves the opposite way to you. Solid.');
  if (s.echo === i) out.push('Echo. Repeats your previous move one move later. Solid.');
  if (t.exit) {
    out.push(t.exit.open ? 'Exit, open. Step on it to finish.' : 'Exit, locked. It opens once you have both cells.');
    if (t.exit.leaves) out.push(`It moves to the next hatch in ${t.exit.leaves} ${t.exit.leaves === 1 ? 'move' : 'moves'}.`);
  }
  if (t.wall) {
    out.push(
      t.wallGlyph === 'magnet'
        ? 'Magnet. Pulls you 1 tile when you are in a clear line with it.'
        : t.emitter
          ? 'Wall.'
          : t.wallGlyph === 'hub'
          ? 'Gear. The 4 tiles touching it rotate clockwise every 3 moves.'
          : t.wallGlyph === 'pylon'
            ? 'Tether pylon. You cannot walk out of the dashed zone around it.'
            : 'Wall.'
    );
  }
  if (t.conv) out.push(`Belt. Pushes you 1 tile ${DIR_WORD[t.conv]}.`);
  if (t.ice) out.push('Ice. You keep sliding until something stops you.');
  if (t.portal)
    out.push(`Portal ${PORTAL_LABEL[t.portal.label]}. Right now it sends you to ${PORTAL_LABEL[t.portal.partner]} (same colour).`);
  if (t.gate) out.push(`${t.gate.pol === 0 ? 'Pink' : 'Blue'} gate, ${t.gate.closed ? 'closed this move' : 'open this move'}. Pink and blue alternate.`);
  if (t.door) out.push(t.door.open ? 'Blast door, open.' : 'Blast door, closed. Step on a plate to open it.');
  if (t.plate) out.push('Plate. Stepping on it opens or closes every blast door.');
  if (t.refl) out.push(`Prism. Turns you ${t.refl > 0 ? 'clockwise' : 'anticlockwise'} and carries you 1 tile.`);
  if (t.oneway) out.push(`One-way gate. You can only enter it moving ${DIR_WORD[t.oneway]}.`);
  if (t.vent) out.push(`Vent, ${t.vent.live ? 'blowing this move' : 'off this move'}. Pushes you 1 tile ${DIR_WORD[t.vent.dir]} on odd moves.`);
  if (t.phase) out.push(`Layer ${t.phase.layer + 1} block, ${t.phase.solid ? 'solid right now' : 'open right now'}.`);
  if (t.rotor) out.push(`Rotor. Twists your next move ${t.rotor > 0 ? 'clockwise' : 'anticlockwise'}.`);
  if (t.spring) out.push('Spring. Land on it and it throws you 2 more tiles the way you were going, over anything in between.');
  if (t.splash !== null) out.push(`${PAINT_WORD[t.splash] === 'green' ? 'Green' : 'Violet'} paint. Walk onto it to turn ${PAINT_WORD[t.splash]}.`);
  if (t.barrier)
    out.push(
      `${t.barrier.color === 0 ? 'Green' : 'Violet'} barrier. Only lets you through while you are ${PAINT_WORD[t.barrier.color]}${t.barrier.pass ? ', which you are' : ''}.`
    );
  if (t.key) out.push('Key. Walk onto it to pick it up. Any key opens any lock.');
  if (t.lock) out.push(t.lock.open ? 'Lock, opened. Plain floor now.' : 'Lock. Solid unless you hold a key; walking into it uses one and opens it for good.');
  if (t.mud) out.push('Mud. Stops you dead, and your next move is spent pulling free.');
  if (t.pit) out.push(w.has.CRATES ? 'Pit. Nothing can enter it, but a pushed crate will fill it.' : 'Pit. Nothing can enter it.');
  if (t.filled) out.push('A crate filled this pit. It is solid floor now.');
  else if (t.fragile) out.push('Cracked floor. It falls in once you step off it.');
  if (t.blight) out.push('Blight. Cannot be entered, and it spreads.');
  if (t.blightNext !== null) out.push(`Blight grows here in ${t.blightNext} ${t.blightNext === 1 ? 'move' : 'moves'} unless something is standing on it.`);
  if (t.after) out.push('Hard-light. Solid for this move.');
  if (t.flooded) out.push('Flooded. Cannot be entered.');
  else if (t.floodNext) out.push('Water reaches this line soon.');
  const beam = beamLine(w, s.turn);
  if (beam && (beam.axis === 'row' ? rowOf(i) === beam.index : colOf(i) === beam.index))
    out.push(beam.live ? 'Pulse beam, live this move. Cannot be entered.' : 'Pulse beam line, off this move.');
  if (t.start && s.pos !== i) out.push('Where you started.');
  if (out.length === 0) out.push('Floor.');
  return `${where}: ${out.join(' ')}`;
}

type TileView = {
  i: number;
  wall: boolean;
  wallGlyph: 'magnet' | 'hub' | 'pylon' | null;
  /** Laser emitter and the way it faces now (Lasers). */
  emitter: Dir | null;
  lit: boolean;
  conv: Dir | null;
  ice: boolean;
  gate: { pol: number; closed: boolean } | null;
  door: { open: boolean } | null;
  plate: boolean;
  refl: number;
  oneway: Dir | null;
  vent: { dir: Dir; live: boolean } | null;
  phase: { layer: number; solid: boolean } | null;
  rotor: number;
  spring: boolean;
  splash: number | null;
  barrier: { color: number; pass: boolean } | null;
  key: boolean;
  lock: { open: boolean } | null;
  mud: boolean;
  /** Chasm tile and which way its track runs (Shuttles). */
  chasm: 'h' | 'v' | null;
  /** A closed hatch, with moves until the exit arrives (Hatches). */
  hatch: number | null;
  charger: boolean;
  portal: { label: number; group: number; partner: number } | null;
  fragile: boolean;
  pit: boolean;
  filled: boolean;
  blight: boolean;
  blightNext: number | null;
  after: boolean;
  start: boolean;
  exit: { open: boolean; leaves: number } | null;
  flooded: boolean;
  floodNext: boolean;
};

function buildTiles(w: World, s: GameState): TileView[] {
  const L = layerFor(w, s.turn);
  const closed = closedPolarity(s.turn);
  const layer = activePhaseLayer(s.turn);
  const vLive = ventsActive(s.turn);
  const mode = portalMode(s.turn);
  const depth = floodDepth(w, s.turn);
  const nextDepth = floodDepth(w, s.turn + 3 - (s.turn % 3));
  const bl = nextBlight(w, s);
  const exitNow = exitFor(w, s.turn);
  const beams = w.emitters.length > 0 ? laserBeams(w, s).lit : null;
  const hatchIn = (h: number): number => {
    for (let k = 1; k <= HATCH_PERIOD * w.hatches.length; k++) if (exitFor(w, s.turn + k) === h) return k;
    return 0;
  };
  const trackDir = (i: number): 'h' | 'v' | null => {
    for (const t of w.tracks) {
      if (!t.includes(i)) continue;
      return rowOf(t[0] as number) === rowOf(t[1] as number) ? 'h' : 'v';
    }
    return null;
  };
  const out: TileView[] = [];
  for (let i = 0; i < CELLS; i++) {
    const label = w.portalAt[i] as number;
    const flooded = isFloodedAt(w, s.turn, i, depth);
    out.push({
      i,
      wall: L.wall[i] === 1,
      wallGlyph: w.magnets.includes(i) ? 'magnet' : w.hubs.includes(i) ? 'hub' : w.tether === i ? 'pylon' : null,
      emitter: (() => {
        const e = w.emitters.find((x) => x.at === i);
        return e ? emitterDir(e.dir, s.turn) : null;
      })(),
      lit: !!beams && beams[i] === 1,
      conv: (L.conv[i] as number) >= 0 ? (DIRS[L.conv[i] as number] as Dir) : null,
      ice: L.ice[i] === 1,
      gate: (L.gate[i] as number) >= 0 ? { pol: L.gate[i] as number, closed: L.gate[i] === closed } : null,
      door: L.door[i] ? { open: s.doorsOpen } : null,
      plate: L.plate[i] === 1,
      refl: L.refl[i] as number,
      oneway: (L.oneway[i] as number) >= 0 ? (DIRS[L.oneway[i] as number] as Dir) : null,
      vent: (L.vent[i] as number) >= 0 ? { dir: DIRS[L.vent[i] as number] as Dir, live: vLive } : null,
      phase: (L.phase[i] as number) >= 0 ? { layer: L.phase[i] as number, solid: L.phase[i] === layer } : null,
      rotor: L.rotor[i] as number,
      spring: L.spring[i] === 1,
      splash: (L.paintPad[i] as number) >= 0 ? (L.paintPad[i] as number) : null,
      barrier: (L.paintGate[i] as number) >= 0 ? { color: L.paintGate[i] as number, pass: s.paint === (L.paintGate[i] as number) + 1 } : null,
      key: (w.keyAt[i] as number) >= 0 && !(s.keysTaken & (1 << (w.keyAt[i] as number))),
      lock: (w.lockAt[i] as number) >= 0 ? { open: (s.locksOpen & (1 << (w.lockAt[i] as number))) !== 0 } : null,
      mud: L.mud[i] === 1,
      chasm: w.chasm[i] ? trackDir(i) : null,
      hatch: w.isHatch[i] && i !== exitNow ? hatchIn(i) : null,
      charger: w.chargerAt[i] === 1,
      portal: label >= 0 ? { label, group: mode === 0 ? (label < 2 ? 0 : 1) : label % 2 === 0 ? 0 : 1, partner: portalPartner(label, mode) } : null,
      fragile: w.fragile[i] === 1 && s.decay[i] !== 0 && s.decay[i] !== -2,
      filled: s.decay[i] === -2,
      pit: s.decay[i] === 0,
      blight: s.blight[i] === 1,
      blightNext: bl && bl.target === i ? bl.inMoves : null,
      after: s.after === i,
      start: w.start === i,
      exit: exitNow === i ? { open: s.got === 3, leaves: w.hatches.length > 1 ? HATCH_PERIOD - (s.turn % HATCH_PERIOD) : 0 } : null,
      flooded,
      floodNext: !flooded && nextDepth > depth && isFloodedAt(w, s.turn, i, nextDepth)
    });
  }
  return out;
}

function Tile({ t }: { t: TileView }) {
  if (t.wall) {
    return (
      <svg viewBox="0 0 100 100" className="tile" aria-hidden="true">
        <rect x="5" y="9" width="90" height="88" rx="14" className="wall-base" />
        <rect x="5" y="4" width="90" height="86" rx="14" className="wall" />
        <path d="M20 12h60" className="wall-shine" />
        {t.wallGlyph === 'magnet' && (
          <g className="wall-glyph">
            <path d="M32 30v20a18 18 0 0036 0V30" />
            <path d="M32 36h10M58 36h10" strokeWidth="9" />
          </g>
        )}
        {t.wallGlyph === 'hub' && (
          <g className="wall-glyph gear">
            <circle cx="50" cy="50" r="17" />
            <circle cx="50" cy="50" r="6" fill="currentColor" />
            {[0, 45, 90, 135, 180, 225, 270, 315].map((a) => (
              <rect key={a} x="46" y="23" width="8" height="10" rx="1.5" fill="currentColor" stroke="none" transform={`rotate(${a} 50 50)`} />
            ))}
          </g>
        )}
        {t.emitter && (
          <g transform={`rotate(${ROT[t.emitter]} 50 50)`} className="emitter">
            <rect x="32" y="30" width="36" height="36" rx="6" />
            <path d="M38 22h24l-5 -10h-14z" className="emitter-lens" />
          </g>
        )}
        {t.wallGlyph === 'pylon' && (
          <g className="wall-glyph">
            <circle cx="50" cy="50" r="18" />
            <circle cx="50" cy="50" r="5" fill="currentColor" />
          </g>
        )}
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 100 100" className="tile" aria-hidden="true">
      <circle cx="50" cy="50" r="41" className={t.pit ? 'pit' : t.ice ? 'well ice' : 'well'} />
      {!t.pit && <path d="M16 46a34 34 0 0130-30" className="well-rim" />}
      {!t.pit && <path d="M84 54a34 34 0 01-30 30" className="well-lip" />}

      {t.flooded && <circle cx="50" cy="50" r="41" className="water" />}
      {t.floodNext && <path d="M14 50c9-7 18 7 27 0s18-7 27 0 18 7 23 2" className="water-next" />}

      {t.plate && (
        <g className="pplate">
          <circle cx="50" cy="50" r="30" />
          <circle cx="50" cy="50" r="18" />
        </g>
      )}

      {t.fragile && !t.pit && <path d="M50 14l-6 18 10 10-8 14 4 24M44 32l-17 5M54 42l19-6" className="crack" />}
      {t.pit && <path d="M26 54l10-12 8 6 9-14 10 10 11-4" className="pit-edge" />}
      {t.filled && (
        <g className="filled">
          <rect x="22" y="22" width="56" height="56" rx="4" />
          <path d="M22 41h56M22 59h56" />
        </g>
      )}

      {t.ice && <path d="M30 34l12-12M56 70l14-14M60 32l6-6" className="ice-glint" />}

      {t.mud && (
        <g className="mud">
          <path d="M16 52c2-12 16-16 28-14 10-6 26-3 32 4 10 2 12 12 6 18 2 10-10 16-26 14-8 6-26 6-32-2-10-2-12-12-8-20z" />
          <ellipse cx="44" cy="54" rx="14" ry="6" className="mud-wet" />
          <circle cx="64" cy="62" r="3.5" className="mud-bubble" />
          <circle cx="30" cy="62" r="2.5" className="mud-bubble" />
        </g>
      )}

      {t.chasm && (
        <g className="chasm">
          <rect x="-1" y="-1" width="102" height="102" />
          <path d={t.chasm === 'h' ? 'M-2 50h104' : 'M50-2v104'} className="chasm-rail" />
        </g>
      )}

      {t.hatch !== null && (
        <g className="hatch">
          <circle cx="50" cy="50" r="27" />
          <path d="M31 50h38M50 31v38" className="hatch-cross" />
          <text x="50" y="94" textAnchor="middle" className="hatch-count">
            {`in ${t.hatch}`}
          </text>
        </g>
      )}

      {t.charger && (
        <g className="charger">
          <circle cx="50" cy="50" r="27" />
          <path d="M55 31L40 54h11l-5 17 16-25H51z" className="charger-bolt" />
        </g>
      )}

      {t.splash !== null && (
        <g className="splash" style={{ color: PAINT_INK[t.splash] }}>
          <path d="M50 28c7 0 9 7 15 6 7-1 10 6 6 11 6 4 5 13-2 15 1 8-7 12-13 8-5 6-14 4-15-3-8 1-13-7-8-13-6-5-3-14 5-14-1-6 5-10 12-10z" />
          <circle cx="76" cy="30" r="4" />
          <circle cx="24" cy="70" r="3" />
        </g>
      )}

      {t.spring && (
        <g className="spring">
          <path d="M30 76h40" className="spring-base" />
          <path d="M36 70l28-7-28-7 28-7-28-7 28-7" />
          <rect x="28" y="26" width="44" height="9" rx="4" className="spring-top" />
        </g>
      )}

      {t.key && (
        <g className="key">
          <circle cx="36" cy="50" r="13" />
          <path d="M49 50h30M70 50v11M79 50v8" />
        </g>
      )}

      {t.lock && (
        <g className={t.lock.open ? 'lock open' : 'lock'}>
          {!t.lock.open && <rect x="12" y="12" width="76" height="76" rx="12" className="lock-plate" />}
          <path d={t.lock.open ? 'M38 46V34a12 12 0 0124 0' : 'M38 48V38a12 12 0 0124 0v10'} className="lock-shackle" />
          <rect x="30" y="46" width="40" height="30" rx="6" className="lock-body" />
          {!t.lock.open && <path d="M50 56v9" className="lock-hole" />}
        </g>
      )}

      {t.barrier && (
        <g className={t.barrier.pass ? 'barrier pass' : 'barrier'} style={{ color: PAINT_INK[t.barrier.color] }}>
          <rect x="12" y="12" width="76" height="76" rx="10" />
          <path d="M14 46L46 14M14 78L78 14M28 86L86 28M60 86l26-26" />
        </g>
      )}

      {t.conv && (
        <g transform={`rotate(${ROT[t.conv]} 50 50)`} className="conv">
          <path d="M30 80l20-20 20 20" className="chev c1" />
          <path d="M30 62l20-20 20 20" className="chev c2" />
          <path d="M30 44l20-20 20 20" className="chev c3" />
        </g>
      )}

      {t.vent && (
        <g className={t.vent.live ? 'vent live' : 'vent'}>
          <path d="M30 34h40M30 50h40M30 66h40" />
          <g transform={`rotate(${ROT[t.vent.dir]} 50 50)`}>
            <path d="M50 30l-10 10h20z" className="vent-arrow" />
          </g>
        </g>
      )}

      {t.oneway && (
        <g transform={`rotate(${ROT[t.oneway]} 50 50)`} className="oneway">
          <path d="M50 76V30M34 46l16-16 16 16" />
          <path d="M30 22h40" />
        </g>
      )}

      {t.refl !== 0 && (
        <g className="prism">
          <path d={t.refl > 0 ? 'M24 76L76 24' : 'M24 24l52 52'} className="prism-face" />
          <path d={t.refl > 0 ? 'M62 66a16 16 0 01-22-4' : 'M38 66a16 16 0 0022-4'} />
          <path d={t.refl > 0 ? 'M44 58l-4 4 5 3' : 'M56 58l4 4-5 3'} />
        </g>
      )}

      {t.rotor !== 0 && (
        <g className="rotor" transform={t.rotor < 0 ? 'translate(100 0) scale(-1 1)' : undefined}>
          <path d="M70 50a20 20 0 11-6-14" />
          <path d="M66 26l-2 10 10 2" />
        </g>
      )}

      {t.portal && (
        <g className="portal" style={{ color: PORTAL_INK[t.portal.group] }}>
          <circle cx="50" cy="50" r="30" />
          <circle cx="50" cy="50" r="20" strokeDasharray="5 6" />
          <text x="50" y="58" textAnchor="middle" className="portal-label">
            {PORTAL_LABEL[t.portal.label]}
          </text>
        </g>
      )}

      {t.gate && (
        <g className={t.gate.closed ? 'gate closed' : 'gate'} style={{ color: GATE_INK[t.gate.pol] }}>
          <path d="M30 20v60M50 16v68M70 20v60" />
        </g>
      )}

      {t.door && (
        <g className={t.door.open ? 'door open' : 'door'}>
          <rect x="16" y="16" width="68" height="68" rx="6" />
          {!t.door.open && <path d="M50 18v64M28 30v8M72 30v8M28 62v8M72 62v8" />}
        </g>
      )}

      {t.phase && (
        <g className={t.phase.solid ? 'phase solid' : 'phase'}>
          <rect x="14" y="14" width="72" height="72" rx="8" />
          <text x="50" y="60" textAnchor="middle">
            {t.phase.layer + 1}
          </text>
        </g>
      )}

      {t.exit && (
        <g className={t.exit.open ? 'exit open' : 'exit'}>
          <path d="M28 80V38a22 22 0 0144 0v42z" className="door-frame" />
          {t.exit.open ? (
            <path d="M50 44v22M40 56l10 10 10-10" className="door-arrow" />
          ) : (
            <g className="door-lock">
              <path d="M43 52v-6a7 7 0 0114 0v6" />
              <rect x="39" y="52" width="22" height="16" rx="3" />
            </g>
          )}
          <text x="50" y="96" textAnchor="middle" className="exit-label">
            EXIT
          </text>
        </g>
      )}

      {t.start && <path d="M40 78h20" className="start-mark" />}

      {t.blight && (
        <g className="blight">
          <path d="M28 40c0-14 18-20 26-10 12-6 24 6 18 18 8 10-2 26-16 22-8 10-28 6-28-8-10-6-8-20 0-22z" />
          <circle cx="40" cy="46" r="4" className="blight-spot" />
          <circle cx="58" cy="58" r="3" className="blight-spot" />
        </g>
      )}
      {t.blightNext !== null && (
        <g className="blight-next">
          <circle cx="50" cy="50" r="36" />
          <text x="50" y="58" textAnchor="middle">
            {t.blightNext}
          </text>
        </g>
      )}

      {t.after && (
        <g className="after">
          <rect x="8" y="8" width="84" height="84" rx="12" />
          <path d="M14 40L40 14M14 70L70 14M30 86L86 30M60 86l26-26" />
        </g>
      )}
    </svg>
  );
}

function Courier({ look, paint, stuck, charge }: { look: Dir | null; paint: number; stuck: boolean; charge: { left: number; max: number } | null }) {
  // With Low Charge the outer ring is split into one segment per move of charge.
  const ring = charge ? (
    Array.from({ length: charge.max }, (_, k) => {
      const gap = 10;
      const a0 = (k / charge.max) * 360 + gap / 2 - 90;
      const a1 = ((k + 1) / charge.max) * 360 - gap / 2 - 90;
      const p = (a: number): string => `${50 + 43 * Math.cos((a * Math.PI) / 180)} ${50 + 43 * Math.sin((a * Math.PI) / 180)}`;
      return <path key={k} d={`M${p(a0)}A43 43 0 0 1 ${p(a1)}`} className={k < charge.left ? 'courier-ring' : 'courier-ring spent'} />;
    })
  ) : (
    <circle cx="50" cy="50" r="43" className="courier-ring" style={paint ? { stroke: PAINT_INK[paint - 1] } : undefined} />
  );
  return (
    <svg viewBox="0 0 100 100" aria-hidden="true">
      {ring}
      <circle cx="50" cy="50" r="35" className="courier-gap" />
      <circle cx="50" cy="50" r="27" className={stuck ? 'courier-core stuck' : 'courier-core'} />
      {look && (
        <g transform={`rotate(${ROT[look]} 50 50)`}>
          <path d="M41 50l9-11 9 11" className="courier-facing" />
        </g>
      )}
    </svg>
  );
}

/** A note in marker pen for first-timers: "you", with an arrow to the courier. */
function HintNote({ at }: { at: number }) {
  const r = rowOf(at);
  const c = colOf(at);
  // Write it on whichever side has room, above unless the courier is on the top row.
  const left = c >= 4;
  const above = r >= 1;
  const cx = c * 100 + 50;
  const cy = r * 100 + 50;
  const tx = cx + (left ? -128 : 128);
  const ty = cy + (above ? -86 : 96);
  const ex = cx + (left ? -46 : 46);
  const ey = cy + (above ? -40 : 40);
  const mx = (tx + ex) / 2 + (left ? 10 : -10);
  const my = (ty + ey) / 2 + (above ? -18 : 18);
  const ang = (Math.atan2(ey - my, ex - mx) * 180) / Math.PI;
  return (
    <g className="hint-note">
      <path d={`M${tx + (left ? 34 : -34)} ${ty + (above ? 6 : -14)}Q${mx} ${my} ${ex} ${ey}`} />
      <path d="M-13 -7L0 0L-12 9" transform={`translate(${ex} ${ey}) rotate(${ang})`} />
      <text x={tx} y={ty} textAnchor="middle" transform={`rotate(${left ? -6 : 5} ${tx} ${ty})`}>
        you
      </text>
    </g>
  );
}

const pct = (i: number): CSSProperties =>
  ({
    '--x': `${colOf(i) * 100}%`,
    '--y': `${rowOf(i) * 100}%`
  }) as CSSProperties;

// ------------------------------------------------------------------ effects

type Fx = { kind: string; at: number; to?: number; color?: string | undefined; delay: number };

const MOVES: ReadonlySet<StepEvent['t']> = new Set([
  'move',
  'conveyor',
  'vent',
  'reflect',
  'slide',
  'repel',
  'attract',
  'magnet',
  'gravity',
  'tether',
  'spinRide',
  'portal',
  'spring',
  'ride'
]);

/** Short-lived marks for what just happened, timed to the courier's walk. */
function effectsFor(events: StepEvent[], w: World): Fx[] {
  const out: Fx[] = [];
  let step = 0;
  let slideFrom = -1;
  const STEP = 90;
  for (const e of events) {
    const delay = step * STEP;
    switch (e.t) {
      case 'collect':
        out.push({ kind: 'lift', at: e.at, delay });
        break;
      case 'portal': {
        const label = w.portalAt[e.from] as number;
        const color = PORTAL_INK[label < 2 ? 0 : 1];
        out.push({ kind: 'ring', at: e.from, color, delay });
        out.push({ kind: 'ring', at: e.to, color, delay: delay + STEP });
        break;
      }
      case 'slide':
        if (slideFrom < 0) slideFrom = e.from;
        out.push({ kind: 'streak', at: e.from, to: e.to, delay });
        break;
      case 'collapse':
        out.push({ kind: 'crumble', at: e.at, delay: delay + STEP });
        break;
      case 'paint':
        out.push({ kind: 'splash', at: e.at, color: PAINT_INK[e.color], delay });
        break;
      case 'spring':
        out.push({ kind: 'coil', at: e.from, delay });
        break;
      case 'unlock':
        out.push({ kind: 'unlock', at: e.at, delay });
        break;
      case 'mud':
        out.push({ kind: 'mud', at: e.at, delay });
        break;
      case 'charge':
        out.push({ kind: 'ring', at: e.at, color: '#e85d04', delay: delay + STEP });
        break;
      case 'hatch':
        out.push({ kind: 'ring', at: e.to, color: '#5d6b2f', delay: delay + STEP });
        break;
      case 'fill':
        out.push({ kind: 'thud', at: e.at, delay: delay + STEP });
        break;
      case 'doors':
        out.push({ kind: 'ring', at: e.at, color: '#56663f', delay });
        break;
      default:
        break;
    }
    if (MOVES.has(e.t)) step++;
  }
  return out;
}

function FxArt({ f }: { f: Fx }) {
  switch (f.kind) {
    case 'lift':
      return (
        <svg viewBox="0 0 100 100" aria-hidden="true">
          <circle cx="50" cy="50" r="30" className="fx-halo" />
          <g className="fx-cell">
            <rect x="40" y="16" width="20" height="10" rx="3" className="battery-nub" />
            <rect x="26" y="24" width="48" height="62" rx="9" className="battery" />
            <path d="M54 32L38 58h12l-4 22 16-28H50z" className="battery-bolt" />
          </g>
        </svg>
      );
    case 'streak': {
      const d = f.to !== undefined ? dirBetween(f.at, f.to) : null;
      return (
        <svg viewBox="0 0 100 100" aria-hidden="true" style={{ overflow: 'visible' }}>
          <g transform={`rotate(${d ? ROT[d] : 0} 50 50)`}>
            <path d="M38 120V40M50 130V30M62 120V40" />
          </g>
        </svg>
      );
    }
    case 'crumble':
      return (
        <svg viewBox="0 0 100 100" aria-hidden="true">
          <path d="M22 30l18-6 6 16-16 8zM56 22l20 6-4 18-18-4zM24 62l16-4 8 16-18 6zM58 58l18 2 2 18-18-2z" />
        </svg>
      );
    case 'splash':
      return (
        <svg viewBox="0 0 100 100" aria-hidden="true">
          <circle cx="50" cy="50" r="36" />
          {[20, 95, 160, 235, 300].map((a) => (
            <circle key={a} cx="50" cy="8" r="5" transform={`rotate(${a} 50 50)`} className="fx-drop" />
          ))}
        </svg>
      );
    case 'coil':
      return (
        <svg viewBox="0 0 100 100" aria-hidden="true">
          <path d="M30 76h40M36 70l28-5-28-5 28-5" />
        </svg>
      );
    case 'unlock':
      return (
        <svg viewBox="0 0 100 100" aria-hidden="true">
          <path d="M38 46V34a12 12 0 0124 0" />
        </svg>
      );
    case 'mud':
      return (
        <svg viewBox="0 0 100 100" aria-hidden="true">
          {[200, 250, 290, 340].map((a, k) => (
            <circle key={a} cx="50" cy="20" r={4 + (k % 2) * 2} transform={`rotate(${a} 50 50)`} className="fx-drop" />
          ))}
        </svg>
      );
    case 'thud':
      return (
        <svg viewBox="0 0 100 100" aria-hidden="true">
          <rect x="12" y="12" width="76" height="76" rx="6" />
        </svg>
      );
    default:
      return (
        <svg viewBox="0 0 100 100" aria-hidden="true">
          <circle cx="50" cy="50" r="34" />
        </svg>
      );
  }
}

/** A rubber stamp on the plate when you finish. */
function Stamp({ moves }: { moves: number }) {
  return (
    <div className="stamp" aria-hidden="true">
      <svg viewBox="0 0 300 130">
        <defs>
          <filter id="ink" x="-5%" y="-5%" width="110%" height="110%">
            <feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" seed="3" result="n" />
            <feColorMatrix in="n" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 -1.1 1.3" result="speckle" />
            <feComposite in="SourceGraphic" in2="speckle" operator="in" />
          </filter>
        </defs>
        <g filter="url(#ink)">
          <rect x="6" y="6" width="288" height="118" rx="10" className="stamp-frame" />
          <rect x="14" y="14" width="272" height="102" rx="6" className="stamp-frame thin" />
          <text x="150" y="70" textAnchor="middle" className="stamp-word">
            Solved
          </text>
          <text x="150" y="101" textAnchor="middle" className="stamp-sub">
            in {moves} {moves === 1 ? 'move' : 'moves'}
          </text>
        </g>
      </svg>
    </div>
  );
}

type Props = {
  world: World;
  state: GameState;
  events: StepEvent[];
  tick: number;
  bumps: number;
  lastDir: Action | null;
  bumpDir: Action | null;
  previews: Preview[];
  showLandings: boolean;
  focus: Action | null;
  reducedMotion: boolean;
  /** Show the marker note pointing at you (first visit). */
  hint?: boolean;
  onAction: (a: Action) => void;
  onInspect: (text: string | null) => void;
};

export function Board({ world, state, events, tick, bumps, lastDir, bumpDir, previews, showLandings, focus, reducedMotion, hint, onAction, onInspect }: Props) {
  const tiles = useMemo(() => buildTiles(world, state), [world, state]);
  const celebrate = state.solved && events.some((e) => e.t === 'solved') && !reducedMotion;
  const fx = reducedMotion ? [] : effectsFor(events, world);
  const [courierAt, setCourierAt] = useState(state.pos);
  const [warping, setWarping] = useState(false);
  const [leaping, setLeaping] = useState(false);
  const [nudge, setNudge] = useState<Dir | null>(null);
  const timers = useRef<number[]>([]);

  // Walk the courier through every tile it passed this move.
  useEffect(() => {
    timers.current.forEach((t) => window.clearTimeout(t));
    timers.current = [];
    const points = courierWaypoints(events);
    if (reducedMotion || points.length <= 1) {
      setCourierAt(state.pos);
      setWarping(false);
      return;
    }
    const STEP = 90;
    points.forEach((p, k) => {
      timers.current.push(
        window.setTimeout(() => {
          if (p.kind === 'spring') {
            setLeaping(true);
            timers.current.push(window.setTimeout(() => setLeaping(false), STEP * 2));
          } else if (p.jump) {
            setWarping(true);
            timers.current.push(window.setTimeout(() => setWarping(false), STEP));
          }
          setCourierAt(p.to);
        }, k * STEP)
      );
    });
    timers.current.push(window.setTimeout(() => setCourierAt(state.pos), points.length * STEP));
    return () => timers.current.forEach((t) => window.clearTimeout(t));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tick]);

  useEffect(() => {
    if (bumps === 0 || reducedMotion) return;
    setNudge(bumpDir && bumpDir !== 'W' ? (bumpDir as Dir) : null);
    const t = window.setTimeout(() => setNudge(null), 200);
    return () => window.clearTimeout(t);
  }, [bumps, reducedMotion]);

  // Entities.
  const cells = [0, 1].map((k) => ({
    k,
    got: (state.got & (1 << k)) !== 0,
    at: cellAt(world, state, k),
    next: world.has.ORBITAL_CELLS && !world.has.SKITTISH_CELLS ? cellPosAt(world, k, state.turn + 1) : -1
  }));

  // Connector lines: what is about to act on you, and what is linked to what.
  const centre2 = (i: number): { x: number; y: number } => ({ x: colOf(i) * 100 + 50, y: rowOf(i) * 100 + 50 });
  const links: { a: number; b: number; cls: string; color?: string | undefined }[] = [];
  if (world.has.PORTALS) {
    const mode = portalMode(state.turn);
    const seen = new Set<number>();
    for (let l = 0; l < 4; l++) {
      const m = portalPartner(l, mode);
      if (seen.has(l) || world.portalPos[l]! < 0 || world.portalPos[m]! < 0) continue;
      seen.add(l).add(m);
      const group = mode === 0 ? (l < 2 ? 0 : 1) : l % 2 === 0 ? 0 : 1;
      links.push({ a: world.portalPos[l]!, b: world.portalPos[m]!, cls: 'link portal-link', color: PORTAL_INK[group] });
    }
  }
  if (world.has.BLAST_DOORS) {
    const L0 = layerFor(world, state.turn);
    const plates: number[] = [];
    const doors: number[] = [];
    for (let i = 0; i < CELLS; i++) {
      if (L0.plate[i]) plates.push(i);
      if (L0.door[i]) doors.push(i);
    }
    for (const pl of plates) for (const d of doors) links.push({ a: pl, b: d, cls: 'link plate-link' });
  }
  // Forces acting on you right now (what a Hold would do).
  const hold = previews.find((p) => p.action === 'W');
  const forces: { a: number; b: number; cls: string }[] = [];
  for (const e of hold?.events ?? []) {
    if (e.t === 'magnet') {
      const d = dirBetween(e.from, e.to);
      const mag = world.magnets.find((m) =>
        d === 'L' || d === 'R'
          ? rowOf(m) === rowOf(e.from) && (d === 'R' ? colOf(m) > colOf(e.from) : colOf(m) < colOf(e.from))
          : colOf(m) === colOf(e.from) && (d === 'D' ? rowOf(m) > rowOf(e.from) : rowOf(m) < rowOf(e.from))
      );
      if (mag !== undefined) forces.push({ a: e.from, b: mag, cls: 'force magnet-force' });
    }
    if (e.t === 'repel' || e.t === 'attract') {
      const cell = cellAt(world, state, e.t === 'repel' ? 0 : 1);
      forces.push({ a: e.from, b: cell, cls: `force ${e.t}-force` });
    }
  }
  const gravityNow = world.has.GRAVITY && massTier(world, state.got) !== 'heavy' ? (['D', 'L', 'U', 'R'] as Dir[])[Math.floor(state.turn / 3) % 4] : null;
  const fearZones: number[] = [];
  if (world.has.SKITTISH_CELLS) {
    const L0 = layerFor(world, state.turn);
    for (const c of cells) {
      if (c.got) continue;
      for (let i = 0; i < CELLS; i++) if (i !== c.at && wrapDist(world, i, c.at) <= 2 && !L0.wall[i]) fearZones.push(i);
    }
  }
  const beam = beamLine(world, state.turn);
  const echoNext = world.has.ECHO && state.echo >= 0 && state.last && state.last !== 'W' ? stepIdx(state.echo, state.last) : -1;

  // Swipe / tap input.
  const start = useRef<{ x: number; y: number; id: number; t: number } | null>(null);
  const boardRef = useRef<HTMLDivElement>(null);
  const tileAt = (x: number, y: number): number => {
    const rect = boardRef.current?.getBoundingClientRect();
    if (!rect) return -1;
    const c = Math.floor(((x - rect.left) / rect.width) * N);
    const r = Math.floor(((y - rect.top) / rect.height) * N);
    return r < 0 || r >= N || c < 0 || c >= N ? -1 : r * N + c;
  };
  const inspect = (i: number): void => onInspect(i < 0 ? null : describeTile(world, state, tiles, i));
  const onDown = (e: RPointerEvent<HTMLDivElement>): void => {
    start.current = { x: e.clientX, y: e.clientY, id: e.pointerId, t: performance.now() };
  };
  const onMove = (e: RPointerEvent<HTMLDivElement>): void => {
    if (e.pointerType === 'mouse' && !start.current) inspect(tileAt(e.clientX, e.clientY));
  };
  const onUp = (e: RPointerEvent<HTMLDivElement>): void => {
    const s = start.current;
    start.current = null;
    if (!s || s.id !== e.pointerId) return;
    const dx = e.clientX - s.x;
    const dy = e.clientY - s.y;
    if (Math.max(Math.abs(dx), Math.abs(dy)) > 22) {
      onAction(Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'R' : 'L') : dy > 0 ? 'D' : 'U');
      return;
    }
    const i = tileAt(e.clientX, e.clientY);
    if (i < 0) return;
    const d = dirBetween(state.pos, i);
    // A quick tap on a neighbouring tile moves; anything else explains the tile.
    if (d && performance.now() - s.t < 350) onAction(d);
    else inspect(i);
  };

  // Preview paths.
  const focusPreview = focus ? previews.find((p) => p.action === focus) : undefined;
  const centre = (i: number): string => `${colOf(i) * 100 + 50},${rowOf(i) * 100 + 50}`;
  const focusSegments: string[] = [];
  if (focusPreview?.ok) {
    let seg: number[] = [state.pos];
    for (const wp of courierWaypoints(focusPreview.events)) {
      if (wp.jump) {
        focusSegments.push(seg.map(centre).join(' '));
        seg = [wp.to];
      } else seg.push(wp.to);
    }
    focusSegments.push(seg.map(centre).join(' '));
  }

  const tether = world.tether;
  return (
    <div className="plate-wrap">
      <div className="plate-cols" aria-hidden="true">
        {Array.from({ length: N }, (_, c) => (
          <span key={c}>{c + 1}</span>
        ))}
      </div>
      <div className="plate-rows" aria-hidden="true">
        {Array.from({ length: N }, (_, r) => (
          <span key={r}>{ROWS[r]}</span>
        ))}
      </div>
      <div className="plate-shadow">
      <div className="plate">
      <div
        ref={boardRef}
        className="field"
        onPointerDown={onDown}
        onPointerUp={onUp}
        onPointerMove={onMove}
        onPointerLeave={() => onInspect(null)}
        onPointerCancel={() => (start.current = null)}
        role="img"
        aria-label={`Board. You are at ${ROWS[rowOf(state.pos)]}${colOf(state.pos) + 1}. Exit at ${ROWS[rowOf(world.exit)]}${colOf(world.exit) + 1}.`}
      >
        <div className={`tiles${celebrate ? ' win' : ''}`}>
          {tiles.map((t) => (
            <div key={t.i} className="cell-slot" style={celebrate ? { animationDelay: `${manhattan(t.i, world.exit) * 55}ms` } : undefined}>
              <Tile t={t} />
            </div>
          ))}
        </div>

        <svg className="overlay" viewBox="0 0 700 700" aria-hidden="true">
          <defs>
            <marker id="mut-arrow" viewBox="0 0 10 10" refX="7" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse">
              <path d="M0 0L10 5L0 10z" fill="context-stroke" />
            </marker>
          </defs>
          {tether >= 0 && (
            <rect
              x={(colOf(tether) - 2) * 100 + 4}
              y={(rowOf(tether) - 2) * 100 + 4}
              width={492}
              height={492}
              rx="18"
              className="tether-zone"
              style={{ stroke: MUTATIONS.TETHER_PYLON.ink }}
            />
          )}
          {world.emitters.length > 0 &&
            laserBeams(world, state).paths.map((path, k) =>
              path.length > 1 ? (
                <g key={`laser${k}`} className="laser">
                  <polyline points={path.map(centre).join(' ')} className="laser-glow" />
                  <polyline points={path.map(centre).join(' ')} className="laser-core" />
                </g>
              ) : null
            )}
          {beam && (
            <line
              x1={beam.axis === 'row' ? 8 : beam.index * 100 + 50}
              y1={beam.axis === 'row' ? beam.index * 100 + 50 : 8}
              x2={beam.axis === 'row' ? 692 : beam.index * 100 + 50}
              y2={beam.axis === 'row' ? beam.index * 100 + 50 : 692}
              className={beam.live ? 'beam live' : 'beam'}
            />
          )}
          {cells.map((c) =>
            !c.got && c.next >= 0 && c.next !== c.at ? (
              <line
                key={`orbit${c.k}`}
                x1={colOf(c.at) * 100 + 50}
                y1={rowOf(c.at) * 100 + 50}
                x2={colOf(c.next) * 100 + 50}
                y2={rowOf(c.next) * 100 + 50}
                className="orbit-path"
              />
            ) : null
          )}
          {fearZones.map((i, k) => (
            <circle key={`fz${k}`} cx={centre2(i).x} cy={centre2(i).y} r="44" className="fear-zone" />
          ))}
          {world.has.WRAPAROUND && (
            <g className="wrap-edges">
              <path d="M4 40V660M696 40V660M40 4H660M40 696H660" />
              {[150, 350, 550].map((v) => (
                <g key={v}>
                  <path d={`M14 ${v - 14}l-8 14 8 14M686 ${v - 14}l8 14-8 14M${v - 14} 14l14-8 14 8M${v - 14} 686l14 8 14-8`} />
                </g>
              ))}
            </g>
          )}
          {world.hubs.map((h) => (
            <g key={`hub${h}`} className="spin-ring" style={{ stroke: MUTATIONS.TURNTABLES.ink }}>
              <circle cx={centre2(h).x} cy={centre2(h).y} r="100" />
              {[45, 135, 225, 315].map((a) => {
                const rad = ((a - 90) * Math.PI) / 180;
                const x = centre2(h).x + 100 * Math.cos(rad);
                const y = centre2(h).y + 100 * Math.sin(rad);
                return <path key={a} d={`M${x - 9} ${y - 9}l9 9-9 9`} transform={`rotate(${a} ${x} ${y})`} />;
              })}
            </g>
          ))}
          {links.map((l, k) => (
            <line
              key={`ln${k}`}
              x1={centre2(l.a).x}
              y1={centre2(l.a).y}
              x2={centre2(l.b).x}
              y2={centre2(l.b).y}
              className={l.cls}
              style={l.color ? { stroke: l.color } : undefined}
            />
          ))}
          {forces.map((f, k) => {
            const a = centre2(f.a);
            const b = centre2(f.b);
            return <line key={`fc${k}`} x1={a.x} y1={a.y} x2={b.x} y2={b.y} className={f.cls} markerEnd="url(#mut-arrow)" />;
          })}
          {focusSegments.map((pts, k) => (
            <polyline key={k} points={pts} className="peek-path" />
          ))}
        </svg>
        {hint && (
          <svg className="overlay notes" viewBox="0 0 700 700" aria-hidden="true">
            <HintNote at={state.pos} />
          </svg>
        )}

        {cells.map((c) =>
          c.got ? null : (
            <div key={`cell${c.k}`} className="entity cell-entity" style={pct(c.at)}>
              <svg viewBox="0 0 100 100" aria-hidden="true">
                <rect x="40" y="16" width="20" height="10" rx="3" className="battery-nub" />
                <rect x="26" y="24" width="48" height="62" rx="9" className="battery" />
                {world.has.MAGNETIC_CELLS ? (
                  <text x="50" y="68" textAnchor="middle" className="battery-sign">
                    {c.k === 0 ? '+' : '−'}
                  </text>
                ) : (
                  <path d="M54 32L38 58h12l-4 22 16-28H50z" className="battery-bolt" />
                )}
              </svg>
            </div>
          )
        )}
        {cells.map((c) =>
          !c.got && c.next >= 0 && c.next !== c.at ? (
            <div key={`ghost${c.k}`} className="entity cell-ghost" style={pct(c.next)}>
              <svg viewBox="0 0 100 100" aria-hidden="true">
                <rect x="30" y="26" width="40" height="56" rx="8" />
              </svg>
            </div>
          ) : null
        )}

        {state.crates.map((c, k) =>
          world.has.PUCKS ? (
            <div key={`puck${k}`} className="entity puck" style={pct(c)}>
              <svg viewBox="0 0 100 100" aria-hidden="true">
                <ellipse cx="50" cy="60" rx="34" ry="17" className="puck-side" />
                <rect x="16" y="46" width="68" height="14" className="puck-side" />
                <ellipse cx="50" cy="46" rx="34" ry="17" className="puck-top" />
                <ellipse cx="50" cy="46" rx="20" ry="9" className="puck-ring" />
              </svg>
            </div>
          ) : (
            <div key={`crate${k}`} className="entity crate" style={pct(c)}>
              <svg viewBox="0 0 100 100" aria-hidden="true">
                <rect x="12" y="12" width="76" height="76" rx="6" className="crate-box" />
                <path d="M24 24l52 52M76 24L24 76" className="crate-brace" />
                <rect x="12" y="12" width="76" height="76" rx="6" className="crate-edge" />
              </svg>
            </div>
          )
        )}
        {world.tracks.map((_, k) => {
          const now = shuttleAt(world, k, state.turn);
          const next = shuttleAt(world, k, state.turn + 1);
          const d = dirBetween(now, next);
          return (
            <div key={`shuttle${k}`} className="entity shuttle" style={pct(now)}>
              <svg viewBox="0 0 100 100" aria-hidden="true">
                <rect x="10" y="10" width="80" height="80" rx="7" className="shuttle-deck" />
                <path d="M22 22h56v56H22z" className="shuttle-plate" />
                {d && (
                  <g transform={`rotate(${ROT[d]} 50 50)`}>
                    <path d="M38 40l12-12 12 12" className="shuttle-arrow" />
                  </g>
                )}
              </svg>
            </div>
          );
        })}
        {gravityNow && (
          <div className="entity gravity-hint" style={pct(courierAt)}>
            <svg viewBox="0 0 100 100" aria-hidden="true" style={{ transform: `rotate(${ROT[gravityNow]}deg)` }}>
              <path d="M50 10V-6M44 0l6-6 6 6" />
            </svg>
          </div>
        )}
        {state.drone >= 0 && (
          <div className="entity drone" style={pct(state.drone)}>
            <svg viewBox="0 0 100 100" aria-hidden="true">
              <path d="M50 16l30 34-30 34-30-34z" />
              <path d="M50 16v68" className="drone-seam" />
            </svg>
          </div>
        )}
        {state.echo >= 0 && (
          <div className="entity echo" style={pct(state.echo)}>
            <svg viewBox="0 0 100 100" aria-hidden="true">
              <path d="M30 80V48a20 20 0 0140 0v32l-7-6-6 6-7-6-7 6-6-6z" />
              <circle cx="43" cy="48" r="4" />
              <circle cx="57" cy="48" r="4" />
            </svg>
          </div>
        )}
        {echoNext >= 0 && state.last && state.last !== 'W' && (
          <div className="entity echo-next" style={pct(state.echo)}>
            <svg viewBox="0 0 100 100" aria-hidden="true" style={{ transform: `rotate(${ROT[state.last]}deg)` }}>
              <path d="M50 14v-10M42 10l8-8 8 8" />
            </svg>
          </div>
        )}

        {showLandings &&
          previews.map((p) =>
            p.ok && p.to !== state.pos ? (
              <div key={p.action} className={`entity landing${focus === p.action ? ' focus' : ''}`} style={pct(p.to)}>
                <svg viewBox="0 0 100 100" aria-hidden="true">
                  <circle cx="50" cy="50" r="17" />
                  {p.action === 'W' ? (
                    <path d="M45 42v16M55 42v16" />
                  ) : (
                    <g transform={`rotate(${ROT[p.action as Dir]} 50 50)`}>
                      <path d="M50 58V42M43 49l7-7 7 7" />
                    </g>
                  )}
                </svg>
              </div>
            ) : null
          )}

        {fx.map((f, k) => (
          <div
            key={`fx${tick}-${k}`}
            className={`entity fx fx-${f.kind}`}
            style={{ ...pct(f.at), ['--d' as string]: `${f.delay}ms`, ['--fx' as string]: f.color ?? '#ffffff' } as CSSProperties}
          >
            <FxArt f={f} />
          </div>
        ))}
        {state.solved && events.some((e) => e.t === 'solved') && <Stamp moves={state.turn} />}
        <div className={`entity courier${warping ? ' warping' : ''}${leaping ? ' leaping' : ''}`} style={pct(courierAt)}>
          <div key={tick} className={`courier-inner${reducedMotion || tick === 0 ? '' : ' hop'}${nudge ? ` nudge-${nudge}` : ''}`}>
            <Courier
              look={lastDir && lastDir !== 'W' ? (lastDir as Dir) : null}
              paint={state.paint}
              stuck={state.stuck}
              charge={world.has.LOW_CHARGE ? { left: state.charge, max: world.chargeMax } : null}
            />
          </div>
        </div>
      </div>
      </div>
      </div>
    </div>
  );
}
