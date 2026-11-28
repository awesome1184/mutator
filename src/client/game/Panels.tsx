import { useEffect, useState } from 'react';
import type { ArchiveEntry, BoardEntry, DayStats, LeaderboardResponse, Profile, Result, StreakEntry, VoteInfo } from '../../shared/api.ts';
import { padNumber, prettyDate } from '../../shared/engine/date.ts';
import { MUTATIONS } from '../../shared/engine/mutations.ts';
import type { MutationId, Puzzle } from '../../shared/engine/types.ts';
import { verdict } from '../../shared/scoring.ts';
import { courierWaypoints } from '../../shared/engine/forecast.ts';
import { colOf, parseActions, rowOf, toIdx } from '../../shared/engine/grid.ts';
import { replay } from '../../shared/engine/sim.ts';
import { compileWorld } from '../../shared/engine/world.ts';
import { MutationGlyph } from './icons.tsx';

export function Stars({ n, size = 22 }: { n: number; size?: number }) {
  return (
    <span className="stars" aria-label={`${n} of 3`}>
      {[0, 1, 2].map((k) => (
        <svg key={k} width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
          <circle cx="12" cy="12" r="9" className={k < n ? 'star on' : 'star'} />
        </svg>
      ))}
    </span>
  );
}

export function Countdown({ at }: { at: number }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(t);
  }, []);
  const ms = Math.max(0, at - now);
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  return <span>{h > 0 ? `${h}h ${m}m` : `${m}m`}</span>;
}

export function Histogram({ day, par, mine }: { day: DayStats; par: number; mine: number | null }) {
  const keys = Object.keys(day.dist)
    .map(Number)
    .filter((k) => day.dist[String(k)])
    .sort((a, b) => a - b);
  if (keys.length === 0) return null;
  const lo = Math.min(par, ...keys);
  const hi = Math.max(...keys, mine ?? 0, lo + 7);
  const span: number[] = [];
  for (let k = lo; k <= Math.min(hi, lo + 14); k++) span.push(k);
  const max = Math.max(...span.map((k) => day.dist[String(k)] ?? 0), 1);
  return (
    <figure className="histo">
      <figcaption>
        How {day.solvers === 1 ? 'the 1 solver' : `the ${day.solvers} solvers`} did
      </figcaption>
      <div className="histo-bars">
        {span.map((k) => {
          const v = day.dist[String(k)] ?? 0;
          return (
            <div key={k} className={`hb${k === mine ? ' mine' : ''}${k === par ? ' par' : ''}`}>
              <span className="hb-n">{v || ''}</span>
              <span className="hb-bar" style={{ height: `${Math.max(v ? 8 : 2, (v / max) * 100)}%` }} />
              <span className="hb-k">{k}</span>
            </div>
          );
        })}
      </div>
    </figure>
  );
}

export function BoardRows({ rows, me }: { rows: BoardEntry[]; me: string | null }) {
  if (rows.length === 0) return <p className="muted">Nobody has solved this one yet.</p>;
  return (
    <ol className="ranks">
      {rows.map((r) => (
        <li key={r.name} className={r.name === me ? 'me' : undefined}>
          <span className="rk">{r.rank}</span>
          {r.avatar ? <img src={r.avatar} alt="" className="av" /> : <span className="av blank" />}
          <span className="nm">u/{r.name}</span>
          <span className="mv">{r.moves}</span>
          <span className="rw" title="undos and restarts">
            {r.rewinds === 0 ? 'clean' : `${r.rewinds} rw`}
          </span>
        </li>
      ))}
    </ol>
  );
}

export function StreakRows({ rows, me }: { rows: StreakEntry[]; me: string | null }) {
  if (rows.length === 0) return <p className="muted">No streaks running yet.</p>;
  return (
    <ol className="ranks">
      {rows.map((r) => (
        <li key={r.name} className={r.name === me ? 'me' : undefined}>
          <span className="rk">{r.rank}</span>
          {r.avatar ? <img src={r.avatar} alt="" className="av" /> : <span className="av blank" />}
          <span className="nm">u/{r.name}</span>
          <span className="mv">{r.streak}</span>
          <span className="rw">days</span>
        </li>
      ))}
    </ol>
  );
}

export function Vote({ vote, onVote, busy }: { vote: VoteInfo; onVote: (m: MutationId) => void; busy: boolean }) {
  const total = Object.values(vote.tallies).reduce((a, b) => a + b, 0);
  return (
    <section className="vote">
      <h3>Splice tomorrow’s mutation</h3>
      <p className="muted">
        {vote.open ? 'The most votes by midnight UTC goes into tomorrow’s puzzle.' : 'Voting has closed for tomorrow.'}
      </p>
      <div className="vote-options">
        {vote.candidates.map((m) => {
          const v = vote.tallies[m] ?? 0;
          const share = total ? Math.round((v / total) * 100) : 0;
          const mine = vote.mine === m;
          return (
            <button
              key={m}
              type="button"
              className={`vote-opt${mine ? ' mine' : ''}`}
              disabled={!vote.open || busy}
              onClick={() => onVote(m)}
              style={{ ['--mut' as string]: MUTATIONS[m].ink, ['--share' as string]: `${vote.mine ? share : 0}%` }}
              aria-pressed={mine}
            >
              <span className="vo-fill" />
              <MutationGlyph id={m} size={18} />
              <span className="vo-name">{MUTATIONS[m].name}</span>
              {vote.mine && <span className="vo-pct">{share}%</span>}
              <span className="vo-short">{MUTATIONS[m].short}</span>
            </button>
          );
        })}
      </div>
    </section>
  );
}

/** The route you took, traced over the starting board. */
export function RouteMap({ puzzle, route }: { puzzle: Puzzle; route: string }) {
  const actions = parseActions(route) ?? [];
  const w = compileWorld(puzzle);
  const r = replay(w, actions);
  const at = (i: number): string => `${colOf(i) * 10 + 5},${rowOf(i) * 10 + 5}`;
  const segments: number[][] = [];
  let seg: number[] = [w.start];
  const jumps: [number, number][] = [];
  for (const evs of r.events) {
    for (const p of courierWaypoints(evs)) {
      if (p.jump) {
        jumps.push([seg[seg.length - 1] as number, p.to]);
        segments.push(seg);
        seg = [p.to];
      } else seg.push(p.to);
    }
  }
  segments.push(seg);
  return (
    <svg className="route-map" viewBox="-2 -2 74 74" role="img" aria-label="Your route">
      <rect x="-1" y="-1" width="72" height="72" rx="3" className="rm-plate" />
      {puzzle.grid.map((row, rr) =>
        row.split('').map((ch, cc) =>
          ch === '#' ? (
            <rect key={`${rr}-${cc}`} x={cc * 10 + 1} y={rr * 10 + 1} width="8" height="8" rx="1.5" className="rm-wall" />
          ) : (
            <circle key={`${rr}-${cc}`} cx={cc * 10 + 5} cy={rr * 10 + 5} r="3.3" className="rm-well" />
          )
        )
      )}
      <rect x={colOf(toIdx(puzzle.exit)) * 10 + 2} y={rowOf(toIdx(puzzle.exit)) * 10 + 2} width="6" height="6" rx="1" className="rm-exit" />
      {jumps.map(([a, b], k) => (
        <polyline key={`j${k}`} points={`${at(a)} ${at(b)}`} className="rm-jump" />
      ))}
      {segments.map((sg, k) => (
        <polyline key={k} points={sg.map(at).join(' ')} className="rm-path" />
      ))}
      <circle cx={colOf(w.start) * 10 + 5} cy={rowOf(w.start) * 10 + 5} r="2.6" className="rm-start" />
    </svg>
  );
}

type ResultProps = {
  puzzle: Puzzle;
  result: Result;
  practice: boolean;
  official: Result | null;
  me: Profile | null;
  day: DayStats;
  myRank: number | null;
  vote: VoteInfo | null;
  nextAt: number;
  loggedIn: boolean;
  onVote: (m: MutationId) => void;
  voting: boolean;
  onComment: () => void;
  onCopy: () => void;
  onWatchPar: () => void;
  onPractice: () => void;
  onLogin: () => void;
  onRanks: () => void;
};

export function ResultPanel(p: ResultProps) {
  const r = p.result;
  return (
    <div className="result">
      <div className="result-top">
        <Stars n={r.stars} size={30} />
        <p className="verdict">{verdict(r.moves, r.par, r.clean)}</p>
      </div>
      <RouteMap puzzle={p.puzzle} route={r.route} />
      <dl className="facts">
        <div>
          <dt>Moves</dt>
          <dd>{r.moves}</dd>
        </div>
        <div>
          <dt>Par</dt>
          <dd>{r.par}</dd>
        </div>
        <div>
          <dt>Rewinds</dt>
          <dd>{r.rewinds}</dd>
        </div>
        {p.myRank && (
          <div>
            <dt>Rank</dt>
            <dd>
              {p.myRank}
              <small> of {p.day.solvers}</small>
            </dd>
          </div>
        )}
      </dl>

      {p.practice && p.official && (
        <p className="note">
          Practice run. Your counted result today is {p.official.moves} moves.
        </p>
      )}


      {p.me && p.me.streak > 0 && (
        <p className="streak-line">
          <strong>{p.me.streak}</strong>-day streak{p.me.best > p.me.streak ? `. Your best is ${p.me.best}.` : '.'}
        </p>
      )}
      {!p.loggedIn && (
        <button type="button" className="btn ghost" onClick={p.onLogin}>
          Log in to keep a streak
        </button>
      )}

      <Histogram day={p.day} par={r.par} mine={p.official?.moves ?? r.moves} />

      <div className="result-actions">
        {p.loggedIn ? (
          <button type="button" className="btn" onClick={p.onComment}>
            Post my result as a comment
          </button>
        ) : (
          <button type="button" className="btn" onClick={p.onCopy}>
            Copy result
          </button>
        )}
        {p.loggedIn && (
          <button type="button" className="btn ghost" onClick={p.onCopy}>
            Copy result
          </button>
        )}
      </div>
      <div className="result-links">
        <button type="button" className="link-btn" onClick={p.onWatchPar}>
          Watch a par route
        </button>
        <button type="button" className="link-btn" onClick={p.onPractice}>
          Play again for practice
        </button>
        <button type="button" className="link-btn" onClick={p.onRanks}>
          See today’s board
        </button>
      </div>

      {p.vote && <Vote vote={p.vote} onVote={p.onVote} busy={p.voting} />}

      <p className="muted next-in">
        Puzzle #{padNumber(p.puzzle.number + 1)} unlocks in <Countdown at={p.nextAt} />.
      </p>
    </div>
  );
}

export function RanksPanel({ data, me, loading }: { data: LeaderboardResponse | null; me: string | null; loading: boolean }) {
  const [tab, setTab] = useState<'day' | 'streak'>('day');
  return (
    <div className="ranks-panel">
      <div className="tabs" role="tablist">
        <button type="button" role="tab" aria-selected={tab === 'day'} onClick={() => setTab('day')}>
          This puzzle
        </button>
        <button type="button" role="tab" aria-selected={tab === 'streak'} onClick={() => setTab('streak')}>
          Streaks
        </button>
      </div>
      {loading && !data ? <p className="muted">Loading…</p> : null}
      {data && tab === 'day' && <BoardRows rows={data.day} me={me} />}
      {data && tab === 'streak' && <StreakRows rows={data.streaks} me={me} />}
      <p className="muted small">Ranked by moves, then fewest undos and restarts, then who finished first.</p>
    </div>
  );
}

export function YouPanel({ me, flairBusy, onFlair, loggedIn }: { me: Profile | null; flairBusy: boolean; onFlair: (on: boolean) => void; loggedIn: boolean }) {
  if (!me || !loggedIn) return <p className="muted">Log in on Reddit to keep stats and streaks.</p>;
  return (
    <div className="you">
      <dl className="facts">
        <div>
          <dt>Solved</dt>
          <dd>{me.solved}</dd>
        </div>
        <div>
          <dt>On par</dt>
          <dd>{me.parCount}</dd>
        </div>
        <div>
          <dt>Streak</dt>
          <dd>{me.streak}</dd>
        </div>
        <div>
          <dt>Best</dt>
          <dd>{me.best}</dd>
        </div>
      </dl>
      <label className="toggle">
        <input type="checkbox" checked={me.flair} disabled={flairBusy} onChange={(e) => onFlair(e.target.checked)} />
        <span>Show my streak as user flair in this community</span>
      </label>
    </div>
  );
}

export function ArchivePanel({ days, current, onOpen }: { days: ArchiveEntry[] | null; current: string; onOpen: (d: ArchiveEntry) => void }) {
  if (!days) return <p className="muted">Loading…</p>;
  if (days.length === 0) return <p className="muted">No earlier puzzles yet.</p>;
  return (
    <ul className="archive">
      {days.map((d) => (
        <li key={d.date}>
          <button type="button" onClick={() => onOpen(d)} disabled={d.date === current}>
            <span className="ar-no">#{padNumber(d.number)}</span>
            <span className="ar-date">{prettyDate(d.date)}</span>
            <span className="ar-muts">
              {d.mutations.map((m) => (
                <span key={m} style={{ color: MUTATIONS[m].ink }} title={MUTATIONS[m].name}>
                  <MutationGlyph id={m} size={15} />
                </span>
              ))}
            </span>
            <span className="ar-me">{d.myStars ? <Stars n={d.myStars} size={12} /> : d.date === current ? 'open' : 'unplayed'}</span>
          </button>
        </li>
      ))}
    </ul>
  );
}
