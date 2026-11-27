import { useEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent as RPointerEvent } from 'react';
import { CELLS, DIRS, N, colOf, rowOf, stepIdx, dirBetween, delta } from '../../shared/engine/grid.ts';
import { MUTATIONS } from '../../shared/engine/mutations.ts';
import { nextBlight, courierWaypoints, type Preview } from '../../shared/engine/forecast.ts';
import { cellAt, massTier } from '../../shared/engine/sim.ts';
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
  type World
} from '../../shared/engine/world.ts';

const ROWS = 'ABCDEFG';
const GATE_INK = ['#E8579B', '#1F6FD1'];
const PORTAL_INK = ['#14A3C7', '#E07A10'];
const PORTAL_LABEL = 'ABCD';
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
  if (s.pos === i) out.push('You. Grab both cells, then reach the exit.');
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
  if (s.crates.includes(i)) out.push('Crate. Walk into it to push it one tile. It can’t be pulled.');
  if (w.has.WRAPAROUND && (rowOf(i) === 0 || rowOf(i) === N - 1 || colOf(i) === 0 || colOf(i) === N - 1))
    out.push('Edge tile. Moving off the board here brings you in on the opposite side.');
  if (s.drone === i) out.push('Mirror drone. Moves the opposite way to you. Solid.');
  if (s.echo === i) out.push('Echo. Repeats your previous move one move later. Solid.');
  if (t.exit) out.push(t.exit.open ? 'Exit, open. Step on it to finish.' : 'Exit, locked. It opens once you have both cells.');
  if (t.wall) {
    out.push(
      t.wallGlyph === 'magnet'
        ? 'Magnet. Pulls you 1 tile when you are in a clear line with it.'
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
  if (t.pit) out.push('Pit. Nothing can enter it.');
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
  portal: { label: number; group: number; partner: number } | null;
  fragile: boolean;
  pit: boolean;
  blight: boolean;
  blightNext: number | null;
  after: boolean;
  start: boolean;
  exit: { open: boolean } | null;
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
  const out: TileView[] = [];
  for (let i = 0; i < CELLS; i++) {
    const label = w.portalAt[i] as number;
    const flooded = isFloodedAt(w, s.turn, i, depth);
    out.push({
      i,
      wall: L.wall[i] === 1,
      wallGlyph: w.magnets.includes(i) ? 'magnet' : w.hubs.includes(i) ? 'hub' : w.tether === i ? 'pylon' : null,
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
      portal: label >= 0 ? { label, group: mode === 0 ? (label < 2 ? 0 : 1) : label % 2 === 0 ? 0 : 1, partner: portalPartner(label, mode) } : null,
      fragile: w.fragile[i] === 1 && s.decay[i] !== 0,
      pit: s.decay[i] === 0,
      blight: s.blight[i] === 1,
      blightNext: bl && bl.target === i ? bl.inMoves : null,
      after: s.after === i,
      start: w.start === i,
      exit: w.exit === i ? { open: s.got === 3 } : null,
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
        <rect x="5" y="5" width="90" height="90" rx="14" className="wall" />
        <path d="M18 14h64" className="wall-shine" />
        {t.wallGlyph === 'magnet' && (
          <g className="wall-glyph">
            <path d="M32 30v20a18 18 0 0036 0V30" />
            <path d="M32 36h10M58 36h10" strokeWidth="9" />
          </g>
        )}
        {t.wallGlyph === 'hub' && (
          <g className="wall-glyph">
            <circle cx="50" cy="50" r="14" />
            <path d="M50 22v10M78 50H68M50 78V68M22 50h10" />
            <path d="M70 26a34 34 0 016 6" />
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
      {!t.pit && <path d="M17 42a34 34 0 0125-25" className="well-rim" />}

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

      {t.ice && <path d="M30 34l12-12M56 70l14-14M60 32l6-6" className="ice-glint" />}

      {t.conv && (
        <g transform={`rotate(${ROT[t.conv]} 50 50)`} className="conv">
          <path d="M30 62l20-20 20 20" />
          <path d="M30 80l20-20 20 20" opacity="0.5" />
          <path d="M30 44l20-20 20 20" opacity="0.5" />
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

function Courier({ look }: { look: Dir | null }) {
  const dx = look === 'R' ? 4 : look === 'L' ? -4 : 0;
  const dy = look === 'D' ? 4 : look === 'U' ? -4 : 0;
  return (
    <svg viewBox="0 0 100 100" aria-hidden="true">
      <circle cx="50" cy="50" r="47" className="courier-halo" />
      <path d="M50 12c22 0 36 16 36 37 0 24-15 39-36 39S14 73 14 49c0-21 14-37 36-37z" className="courier-body" />
      <ellipse cx={38 + dx} cy={45 + dy} rx="9" ry="11" fill="#fff" />
      <ellipse cx={62 + dx} cy={45 + dy} rx="9" ry="11" fill="#fff" />
      <circle cx={39 + dx * 1.5} cy={46 + dy * 1.5} r="4.8" className="pupil" />
      <circle cx={63 + dx * 1.5} cy={46 + dy * 1.5} r="4.8" className="pupil" />
      <path d="M41 70q9 6 18 0" className="courier-mouth" />
    </svg>
  );
}

const pct = (i: number): CSSProperties =>
  ({
    '--x': `${colOf(i) * 100}%`,
    '--y': `${rowOf(i) * 100}%`
  }) as CSSProperties;

type Props = {
  world: World;
  state: GameState;
  events: StepEvent[];
  tick: number;
  bumps: number;
  lastDir: Action | null;
  previews: Preview[];
  showLandings: boolean;
  focus: Action | null;
  reducedMotion: boolean;
  onAction: (a: Action) => void;
  onInspect: (text: string | null) => void;
};

export function Board({ world, state, events, tick, bumps, lastDir, previews, showLandings, focus, reducedMotion, onAction, onInspect }: Props) {
  const tiles = useMemo(() => buildTiles(world, state), [world, state]);
  const [courierAt, setCourierAt] = useState(state.pos);
  const [warping, setWarping] = useState(false);
  const [shake, setShake] = useState(false);
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
          if (p.jump) {
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
    setShake(true);
    const t = window.setTimeout(() => setShake(false), 220);
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
      <div className={`plate${shake ? ' shake' : ''}`}>
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
        <div className="tiles">
          {tiles.map((t) => (
            <div key={t.i} className="cell-slot">
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

        {state.crates.map((c, k) => (
          <div key={`crate${k}`} className="entity crate" style={pct(c)}>
            <svg viewBox="0 0 100 100" aria-hidden="true">
              <rect x="12" y="12" width="76" height="76" rx="6" className="crate-box" />
              <path d="M24 24l52 52M76 24L24 76" className="crate-brace" />
              <rect x="12" y="12" width="76" height="76" rx="6" className="crate-edge" />
            </svg>
          </div>
        ))}
        {gravityNow && (
          <div className="entity gravity-hint" style={pct(courierAt)}>
            <svg viewBox="0 0 100 100" aria-hidden="true" style={{ transform: `rotate(${ROT[gravityNow]}deg)` }}>
              <path d="M50 -4V-24M41 -15l9-9 9 9" />
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

        <div className={`entity courier${warping ? ' warping' : ''}`} style={pct(courierAt)}>
          <Courier look={lastDir && lastDir !== 'W' ? (lastDir as Dir) : null} />
        </div>
      </div>
      </div>
      </div>
    </div>
  );
}
