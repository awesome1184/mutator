import { useEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent as RPointerEvent } from 'react';
import { CELLS, DIRS, N, colOf, rowOf, stepIdx, dirBetween } from '../../shared/engine/grid.ts';
import { MUTATIONS } from '../../shared/engine/mutations.ts';
import { nextBlight, courierWaypoints, type Preview } from '../../shared/engine/forecast.ts';
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
  ventsActive,
  type World
} from '../../shared/engine/world.ts';

const ROWS = 'ABCDEFG';
const GATE_INK = ['#E8579B', '#1F6FD1'];
const PORTAL_INK = ['#14A3C7', '#E07A10'];
const PORTAL_LABEL = 'ABCD';
const ROT: Record<Dir, number> = { U: 0, R: 90, D: 180, L: 270 };

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
  portal: { label: number; group: number } | null;
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
      portal: label >= 0 ? { label, group: mode === 0 ? (label < 2 ? 0 : 1) : label % 2 === 0 ? 0 : 1 } : null,
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

      {t.plate && <rect x="24" y="24" width="52" height="52" rx="6" className="plate" />}

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
          <rect x="22" y="22" width="56" height="56" rx="9" />
          <path d="M50 36v26M39 52l11 11 11-11" />
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
  const dx = look === 'R' ? 3 : look === 'L' ? -3 : 0;
  const dy = look === 'D' ? 3 : look === 'U' ? -3 : 0;
  return (
    <svg viewBox="0 0 100 100" aria-hidden="true">
      <path d="M50 18c18 0 30 13 30 31 0 20-13 33-30 33S20 69 20 49c0-18 12-31 30-31z" className="courier-body" />
      <ellipse cx={40 + dx} cy={46 + dy} rx="7" ry="8.5" fill="#fff" />
      <ellipse cx={60 + dx} cy={46 + dy} rx="7" ry="8.5" fill="#fff" />
      <circle cx={41 + dx * 1.6} cy={47 + dy * 1.6} r="3.6" className="pupil" />
      <circle cx={61 + dx * 1.6} cy={47 + dy * 1.6} r="3.6" className="pupil" />
      <path d="M33 26c6-5 12-6 17-6" className="courier-shine" />
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
};

export function Board({ world, state, events, tick, bumps, lastDir, previews, showLandings, focus, reducedMotion, onAction }: Props) {
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
    at: cellPosAt(world, k, state.turn),
    next: world.has.ORBITAL_CELLS ? cellPosAt(world, k, state.turn + 1) : -1
  }));
  const beam = beamLine(world, state.turn);
  const echoNext = world.has.ECHO && state.echo >= 0 && state.last && state.last !== 'W' ? stepIdx(state.echo, state.last) : -1;

  // Swipe / tap input.
  const start = useRef<{ x: number; y: number; id: number } | null>(null);
  const boardRef = useRef<HTMLDivElement>(null);
  const onDown = (e: RPointerEvent<HTMLDivElement>): void => {
    start.current = { x: e.clientX, y: e.clientY, id: e.pointerId };
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
    const rect = boardRef.current?.getBoundingClientRect();
    if (!rect) return;
    const c = Math.floor(((e.clientX - rect.left) / rect.width) * N);
    const r = Math.floor(((e.clientY - rect.top) / rect.height) * N);
    if (r < 0 || r >= N || c < 0 || c >= N) return;
    const d = dirBetween(state.pos, r * N + c);
    if (d) onAction(d);
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
          {focusSegments.map((pts, k) => (
            <polyline key={k} points={pts} className="peek-path" />
          ))}
        </svg>

        {cells.map((c) =>
          c.got ? null : (
            <div key={`cell${c.k}`} className="entity cell-entity" style={pct(c.at)}>
              <svg viewBox="0 0 100 100" aria-hidden="true">
                <rect x="30" y="22" width="40" height="56" rx="20" className="capsule" />
                <path d="M30 50h40" className="capsule-seam" />
                {world.has.MAGNETIC_CELLS && (
                  <text x="50" y="45" textAnchor="middle" className="capsule-label">
                    {c.k === 0 ? '+' : '−'}
                  </text>
                )}
              </svg>
            </div>
          )
        )}
        {cells.map((c) =>
          !c.got && c.next >= 0 && c.next !== c.at ? (
            <div key={`ghost${c.k}`} className="entity cell-ghost" style={pct(c.next)}>
              <svg viewBox="0 0 100 100" aria-hidden="true">
                <rect x="34" y="28" width="32" height="44" rx="16" />
              </svg>
            </div>
          ) : null
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
