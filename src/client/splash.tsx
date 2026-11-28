import './styles.css';
import '@fontsource-variable/archivo/standard.css';

import { StrictMode, useEffect, useState, type MouseEvent } from 'react';
import { createRoot } from 'react-dom/client';
import { context, requestExpandedMode } from '@devvit/web/client';
import { padNumber, prettyDate } from '../shared/engine/date.ts';
import { MUTATIONS } from '../shared/engine/mutations.ts';
import { TIERS } from '../shared/engine/schedule.ts';
import type { Coord, Puzzle } from '../shared/engine/types.ts';
import { getApi, type SplashResponse } from './lib/api.ts';
import { MutationGlyph } from './game/icons.tsx';
import { Stars } from './game/Panels.tsx';
import { Wordmark } from './game/Wordmark.tsx';

function requestedDate(): string | undefined {
  const fromPost = context?.postData?.date;
  if (typeof fromPost === 'string') return fromPost;
  return new URLSearchParams(window.location.search).get('date') ?? undefined;
}

/** Feature tiles as coloured dots, using each mutation's ink. */
function features(p: Puzzle): { r: number; c: number; ink: string }[] {
  const out: { r: number; c: number; ink: string }[] = [];
  const add = (list: Coord[], m: keyof typeof MUTATIONS): void => {
    if (p.mutations.includes(m)) for (const t of list) out.push({ r: t.r, c: t.c, ink: MUTATIONS[m].ink });
  };
  add(p.portals, 'PORTALS');
  add(p.conveyors, 'CONVEYOR');
  add(p.ice, 'CRYO_SLICK');
  add(p.gates, 'PHASE_GATES');
  add(p.doors, 'BLAST_DOORS');
  add(p.plates, 'BLAST_DOORS');
  add(p.reflectors, 'REFLECTORS');
  add(p.oneWays, 'ONE_WAY_GATES');
  add(p.vents, 'VENTILATION');
  add(p.phaseTiles, 'PHASE_LAYERS');
  add(p.rotors, 'ROTORS');
  add(p.blight, 'INFECTION');
  add(p.cracked ?? [], 'DECAY');
  add(p.crates ?? [], 'CRATES');
  add(p.springs ?? [], 'SPRINGS');
  add(p.paintPads ?? [], 'PAINT');
  add(p.paintGates ?? [], 'PAINT');
  add(p.keys ?? [], 'KEYS');
  add(p.locks ?? [], 'KEYS');
  add(p.mud ?? [], 'MUD');
  if (p.droneStart) add([p.droneStart], 'MIRROR_DRONE');
  if (p.echoStart) add([p.echoStart], 'ECHO');
  return out;
}

/** A still picture of the starting board. No engine needed. */
function MiniPlate({ p }: { p: Puzzle }) {
  const at = (c: Coord): { x: number; y: number } => ({ x: c.c * 10 + 5, y: c.r * 10 + 5 });
  const cells: Coord[] = p.cells;
  const s = at(p.start);
  const e = at(p.exit);
  return (
    <svg className="mini-plate" viewBox="-3 -3 76 76" role="img" aria-label="Today’s starting board">
      <path d="M-2 -2H64l8 8V72H-2z" className="mp-plate" />
      {p.grid.map((row, r) =>
        row.split('').map((ch, c) =>
          ch === '#' ? (
            <rect key={`${r}-${c}`} x={c * 10 + 1} y={r * 10 + 1} width="8" height="8" rx="1.6" className="mp-wall" />
          ) : (
            <circle key={`${r}-${c}`} cx={c * 10 + 5} cy={r * 10 + 5} r="3.6" className="mp-well" />
          )
        )
      )}
      {features(p).map((f, k) => (
        <circle key={`f${k}`} cx={f.c * 10 + 5} cy={f.r * 10 + 5} r="2.2" fill={f.ink} />
      ))}
      <rect x={e.x - 3.2} y={e.y - 3.2} width="6.4" height="6.4" rx="1.2" className="mp-exit" />
      {cells.map((c, k) => {
        const q = at(c);
        return <rect key={k} x={q.x - 2.2} y={q.y - 3} width="4.4" height="6" rx="1" className="mp-cell" />;
      })}
      <g className="mp-me-blob" transform={`translate(${s.x} ${s.y})`}>
        <circle r="4.3" fill="none" stroke="var(--courier)" strokeWidth="0.9" />
        <circle r="3.4" className="mp-me-halo" />
        <circle r="2.5" className="mp-me" />
      </g>
    </svg>
  );
}

function Splash() {
  const [data, setData] = useState<SplashResponse | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    void getApi()
      .then((api) => api.splash(requestedDate()))
      .then(setData)
      .catch(() => setError(true));
  }, []);

  const open = (e: MouseEvent<HTMLButtonElement>): void => {
    requestExpandedMode(e.nativeEvent, 'game', { title: 'MUTATOR' });
  };

  const p = data?.puzzle;
  const tier = p ? TIERS[p.weekday] : undefined;
  const pctPar = data && data.solvers > 0 ? Math.round((data.parCount / data.solvers) * 100) : null;
  return (
    <main className="splash">
      <header className="sp-head">
        {p ? <Wordmark weekday={p.weekday} ink={MUTATIONS[p.mutations[0] ?? 'GRAVITY'].ink} /> : <h1 className="wordmark">MUTATOR</h1>}
        {p && (
          <p className="issue">
            <span className="issue-no">#{padNumber(p.number)}</span>
            <span className="issue-date">{prettyDate(p.dateKey)}</span>
            {tier && <span className={`tier tier-${tier.id}`}>{tier.label}</span>}
          </p>
        )}
      </header>

      {p ? (
        <div className="sp-body">
          <MiniPlate p={p} />
          <div className="sp-copy">
            <p className="sp-lede">Get both cells to the exit. Today’s rules:</p>
            <ul className="sp-muts">
              {p.mutations.map((m) => (
                <li key={m} style={{ ['--mut' as string]: MUTATIONS[m].ink }}>
                  <span className="sp-glyph">
                    <MutationGlyph id={m} size={16} />
                  </span>
                  <span>
                    <strong>{MUTATIONS[m].name}.</strong> {MUTATIONS[m].short}
                  </span>
                </li>
              ))}
            </ul>
            <p className="sp-stats">
              <span>
                Par <strong>{p.par}</strong>
              </span>
              <span>
                <strong>{data?.solvers ?? 0}</strong> solved
              </span>
              {pctPar !== null && (
                <span>
                  <strong>{pctPar}%</strong> on par
                </span>
              )}
            </p>
          </div>
        </div>
      ) : (
        <div className="sp-body sp-wait">{error ? <p>Couldn’t reach the lab. Tap play to try again.</p> : <p>Loading today’s plate…</p>}</div>
      )}

      <footer className="sp-foot">
        {data?.stars ? (
          <span className="sp-me">
            <Stars n={data.stars} size={14} /> solved
            {data.streak > 1 ? `, ${data.streak} days running` : ''}
          </span>
        ) : data && data.streak > 0 ? (
          <span className="sp-me">{data.streak}-day streak. Keep it going.</span>
        ) : (
          <span className="sp-me">A new puzzle every day at 00:00 UTC.</span>
        )}
        <button type="button" className="btn play" onClick={open}>
          {data?.stars ? 'See results' : data?.date && data.date !== data.today ? 'Play this day' : 'Play'}
        </button>
      </footer>
    </main>
  );
}

createRoot(document.getElementById('root') as HTMLElement).render(
  <StrictMode>
    <Splash />
  </StrictMode>
);
