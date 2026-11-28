import './styles.css';
import '@fontsource-variable/archivo/standard.css';

import { StrictMode, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { context, navigateToPost, showLoginPrompt, showToast } from '@devvit/web/client';
import type { ArchiveEntry, LeaderboardResponse, Result, StateResponse, SubmitResponse } from '../shared/api.ts';
import { padNumber, prettyDate } from '../shared/engine/date.ts';
import { previewActions } from '../shared/engine/forecast.ts';
import { parseActions } from '../shared/engine/grid.ts';
import { ALL_MUTATIONS, MUTATIONS } from '../shared/engine/mutations.ts';
import { TIERS } from '../shared/engine/schedule.ts';
import type { Action, MutationId, Puzzle, StepEvent } from '../shared/engine/types.ts';
import { shareText } from '../shared/scoring.ts';
import { dayOffset, getApi, jumpToDay, STANDALONE } from './lib/api.ts';
import { play, isMuted, setMuted } from './lib/sound.ts';
import { load, save } from './lib/storage.ts';
import { Board, PAINT_INK } from './game/Board.tsx';
import { Wordmark } from './game/Wordmark.tsx';
import { Controls } from './game/Controls.tsx';
import { Forecast } from './game/Forecast.tsx';
import { MutationGlyph, SoundGlyph } from './game/icons.tsx';
import { ArchivePanel, RanksPanel, ResultPanel, YouPanel } from './game/Panels.tsx';
import { Rules } from './game/Rules.tsx';
import { Sheet } from './game/Sheet.tsx';
import { useGame } from './game/useGame.ts';

type SheetId = 'rules' | 'ranks' | 'you' | 'past' | 'result' | null;

function requestedDate(): string | undefined {
  const fromPost = context?.postData?.date;
  if (typeof fromPost === 'string') return fromPost;
  const q = new URLSearchParams(window.location.search).get('date');
  return q ?? undefined;
}

function buzz(pattern: number | number[]): void {
  try {
    navigator.vibrate?.(pattern);
  } catch {
    // not supported
  }
}

function ParTrack({ moves, par }: { moves: number; par: number }) {
  const n = Math.max(par, moves);
  return (
    <span className="par-track" aria-hidden="true">
      {Array.from({ length: n }, (_, i) => (
        <span key={i} className={`pip${i < moves ? ' done' : ''}${i >= par ? ' over' : ''}${i === par - 1 ? ' par' : ''}`} />
      ))}
    </span>
  );
}

function RingsGlyph() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="12" r="8" fill="none" stroke="currentColor" strokeWidth="2" strokeDasharray="3.5 2.5" />
      <path d="M12 16V8M8.5 11.5L12 8l3.5 3.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function soundFor(events: StepEvent[]): void {
  if (events.some((e) => e.t === 'solved')) return play('win');
  if (events.some((e) => e.t === 'collect')) return play('cell');
  if (events.some((e) => e.t === 'portal')) return play('warp');
  if (events.some((e) => e.t === 'spring')) return play('spring');
  if (events.some((e) => e.t === 'unlock' || e.t === 'key')) return play('unlock');
  if (events.some((e) => e.t === 'mud' || e.t === 'stuck')) return play('squelch');
  if (events.some((e) => e.t === 'doors')) return play('door');
  if (events.some((e) => e.t === 'collapse')) return play('crack');
  if (events.some((e) => e.t === 'conveyor' || e.t === 'vent' || e.t === 'magnet' || e.t === 'repel' || e.t === 'attract')) return play('push');
  if (events.some((e) => e.t === 'gravity')) return play('fall');
  play('step');
}

function App() {
  const [data, setData] = useState<StateResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [date, setDate] = useState<string | undefined>(requestedDate);

  const loadState = useCallback(async (d?: string) => {
    setError(null);
    try {
      const api = await getApi();
      const s = await api.state(d);
      setData(s);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => {
    void loadState(date);
  }, [date, loadState]);

  if (error) {
    return (
      <main className="app center">
        <div className="loading">
          <p>The puzzle didn’t load: {error}</p>
          <button type="button" className="btn" onClick={() => void loadState(date)}>
            Try again
          </button>
        </div>
      </main>
    );
  }
  if (!data) {
    return (
      <main className="app center">
        <div className="loading" aria-live="polite">
          <PlateMark />
          <p>Preparing today’s plate…</p>
        </div>
      </main>
    );
  }
  return <Game key={data.date} initial={data} onOpenDate={setDate} />;
}

function PlateMark() {
  return (
    <svg className="plate-mark" width="64" height="64" viewBox="0 0 64 64" aria-hidden="true">
      <path d="M6 6h44l8 8v44H6z" className="pm-plate" />
      {[0, 1, 2].map((r) =>
        [0, 1, 2].map((c) => <circle key={`${r}${c}`} cx={18 + c * 14} cy={18 + r * 14} r="5" className={r === 1 && c === 1 ? 'pm-me' : 'pm-well'} />)
      )}
    </svg>
  );
}

function Game({ initial, onOpenDate }: { initial: StateResponse; onOpenDate: (d: string) => void }) {
  const [data, setData] = useState(initial);
  const [puzzle, setPuzzle] = useState<Puzzle>(initial.puzzle);
  const [sheet, setSheet] = useState<SheetId>(initial.result ? 'result' : null);
  const [practice, setPractice] = useState(!!initial.result);
  const [lastResult, setLastResult] = useState<Result | null>(initial.result);
  const [submitting, setSubmitting] = useState(false);
  const [voting, setVoting] = useState(false);
  const [ranks, setRanks] = useState<LeaderboardResponse | null>(null);
  const [past, setPast] = useState<ArchiveEntry[] | null>(null);
  const [focus, setFocus] = useState<Action | null>(null);
  const [muted, setMutedState] = useState(isMuted());
  const [showLandings, setShowLandings] = useState(load('mutator-landings', true));
  const [hintSeen, setHintSeen] = useState(load('mutator-hint-seen', false));
  const [replaying, setReplaying] = useState(false);
  const [flairBusy, setFlairBusy] = useState(false);
  const [info, setInfo] = useState<string | null>(null);
  const reducedMotion = useMemo(() => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false, []);
  const loggedIn = !!data.user.name;
  const solvedOfficially = !!data.result;

  const onSolved = useCallback(
    async (route: string, rewinds: number) => {
      setSubmitting(true);
      try {
        const api = await getApi();
        const res: SubmitResponse = await api.submit({ date: data.date, route, rewinds });
        if (!res.accepted || !res.result) {
          showToast(res.error ?? 'That solve was not accepted.');
          return;
        }
        setData((d) => ({
          ...d,
          me: res.me ?? d.me,
          day: res.day,
          board: res.board,
          result: res.ranked || !d.result ? res.result : d.result
        }));
        if (res.puzzle) setPuzzle(res.puzzle);
        setLastResult(res.ranked ? res.result : { ...res.result, moves: route.length, rewinds, clean: rewinds === 0, route });
        window.setTimeout(() => setSheet('result'), 650);
      } catch (e) {
        showToast(e instanceof Error ? e.message : 'Could not save your solve.');
      } finally {
        setSubmitting(false);
      }
    },
    [data.date]
  );

  const game = useGame(puzzle, practice, onSolved);
  const { world, run, state } = game;
  const previews = useMemo(() => previewActions(world, state), [world, state]);

  const act = useCallback(
    (a: Action) => {
      if (state.solved || replaying || sheet) return;
      const res = game.move(a);
      if (!res.ok) {
        play('bump');
        buzz(12);
      } else {
        soundFor(res.events);
        if (res.events.some((e) => e.t === 'solved')) buzz([20, 40, 20, 40, 60]);
        else if (res.events.some((e) => e.t === 'collect')) buzz([10, 30, 10]);
      }
      if (!hintSeen && res.ok) {
        setHintSeen(true);
        save('mutator-hint-seen', true);
      }
    },
    [state.solved, replaying, sheet, game, hintSeen]
  );

  const undo = useCallback(() => {
    if (replaying) return;
    if (game.undo()) play('undo');
  }, [game, replaying]);
  const restart = useCallback(() => {
    if (replaying) return;
    if (game.restart()) play('undo');
  }, [game, replaying]);

  // Keyboard.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (sheet) return;
      const k = e.key.toLowerCase();
      const map: Record<string, Action> = { arrowup: 'U', w: 'U', arrowdown: 'D', s: 'D', arrowleft: 'L', a: 'L', arrowright: 'R', d: 'R', ' ': 'W', '.': 'W' };
      const a = map[k];
      if (a) {
        e.preventDefault();
        act(a);
      } else if (k === 'z' || k === 'backspace' || k === 'u') {
        e.preventDefault();
        undo();
      } else if (k === 'r') {
        restart();
      } else if (k === '?') {
        setSheet('rules');
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [act, undo, restart, sheet]);

  // Sheets that need data.
  useEffect(() => {
    if (sheet === 'ranks') {
      void getApi()
        .then((api) => api.leaderboard(data.date))
        .then(setRanks)
        .catch(() => setRanks(null));
    }
    if (sheet === 'past') {
      void getApi()
        .then((api) => api.archive())
        .then((r) => setPast(r.days))
        .catch(() => setPast([]));
    }
  }, [sheet, data.date]);

  const watchPar = (): void => {
    const route = parseActions(puzzle.solution ?? '');
    if (!route) return;
    setSheet(null);
    setPractice(true);
    setReplaying(true);
    game.load([]);
    let k = 0;
    const tick = (): void => {
      k++;
      game.load(route.slice(0, k));
      if (k < route.length) window.setTimeout(tick, reducedMotion ? 120 : 520);
      else window.setTimeout(() => setReplaying(false), 600);
    };
    window.setTimeout(tick, 500);
  };

  const startPractice = (): void => {
    setSheet(null);
    setPractice(true);
    game.restart();
  };

  const vote = async (m: MutationId): Promise<void> => {
    setVoting(true);
    try {
      const api = await getApi();
      const v = await api.vote(m);
      setData((d) => ({ ...d, vote: v }));
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Vote failed.');
    } finally {
      setVoting(false);
    }
  };

  const comment = async (): Promise<void> => {
    try {
      const api = await getApi();
      const r = await api.comment(data.date);
      showToast(r.message);
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Could not post the comment.');
    }
  };

  const copy = async (): Promise<void> => {
    const r = data.result ?? lastResult;
    if (!r) return;
    const text = shareText({ number: puzzle.number, mutations: puzzle.mutations, moves: r.moves, par: r.par, clean: r.clean });
    try {
      await navigator.clipboard.writeText(text);
      showToast('Result copied. The route stays secret.');
    } catch {
      showToast(text);
    }
  };

  const flair = async (on: boolean): Promise<void> => {
    setFlairBusy(true);
    try {
      const api = await getApi();
      const r = await api.flair(on);
      showToast(r.message);
      if (r.ok) setData((d) => (d.me ? { ...d, me: { ...d.me, flair: on } } : d));
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Could not change flair.');
    } finally {
      setFlairBusy(false);
    }
  };

  const openDay = (d: ArchiveEntry): void => {
    setSheet(null);
    if (!STANDALONE && d.postId) {
      navigateToPost(d.postId as `t3_${string}`);
      return;
    }
    onOpenDate(d.date);
  };

  const tier = TIERS[puzzle.weekday];
  const cellsGot = [(state.got & 1) !== 0, (state.got & 2) !== 0];
  const isPast = data.date !== data.today;
  const shownResult = lastResult ?? data.result;

  return (
    <main className="app">
      <header className="top">
        <div className="brand">
          <Wordmark number={puzzle.number} ink={MUTATIONS[puzzle.mutations[0] ?? 'GRAVITY'].ink} />
          <p className="issue">
            <span className="issue-no">#{padNumber(puzzle.number)}</span>
            <span className="issue-date">{prettyDate(puzzle.dateKey)}</span>
            {tier && <span className={`tier tier-${tier.id}`}>{tier.label}</span>}
            {STANDALONE && <NextDay />}
          </p>
        </div>
        <nav className="top-nav" aria-label="Menu">
          <button type="button" onClick={() => setSheet('rules')}>
            Rules
          </button>
          <button type="button" onClick={() => setSheet('ranks')}>
            Board
          </button>
          <button type="button" onClick={() => setSheet('you')}>
            You
          </button>
          <button type="button" onClick={() => setSheet('past')}>
            Past
          </button>
          <button
            type="button"
            className={`icon-btn${showLandings ? ' on' : ''}`}
            aria-label={showLandings ? 'Hide landing rings' : 'Show landing rings'}
            aria-pressed={showLandings}
            title="Landing rings"
            onClick={() => {
              setShowLandings(!showLandings);
              save('mutator-landings', !showLandings);
            }}
          >
            <RingsGlyph />
          </button>
          <button
            type="button"
            className="icon-btn"
            aria-label={muted ? 'Turn sound on' : 'Turn sound off'}
            onClick={() => {
              setMuted(!muted);
              setMutedState(!muted);
            }}
          >
            <SoundGlyph on={!muted} />
          </button>
        </nav>
      </header>

      <section className="muts" aria-label="Today’s mutations">
        {puzzle.mutations.map((m) => (
          <button
            key={m}
            type="button"
            className="mut-tag"
            onClick={() => setSheet('rules')}
            style={{ ['--mut' as string]: MUTATIONS[m].ink, ['--on-mut' as string]: MUTATIONS[m].darkText ? '#1d1b45' : '#fff' }}
          >
            <span className="mt-swatch">
              <MutationGlyph id={m} size={16} />
            </span>
            <span className="mt-name">{MUTATIONS[m].name}</span>
            {puzzle.communityPick === m && <span className="mt-voted">voted in</span>}
            <span className="mt-short">{MUTATIONS[m].short}</span>
          </button>
        ))}
      </section>

      <section className="board-area">
        <Board
          world={world}
          state={state}
          events={run.events}
          tick={run.tick}
          bumps={run.bumps}
          lastDir={state.last}
          bumpDir={run.lastDir}
          previews={previews}
          showLandings={showLandings && !replaying}
          focus={focus}
          reducedMotion={reducedMotion}
          onAction={act}
          onInspect={setInfo}
        />
      </section>

      <section className="side">
        <div className="status" aria-live="polite">
          <span className="st-moves">
            <strong>{state.turn}</strong> {state.turn === 1 ? 'move' : 'moves'}
          </span>
          <span className="st-par">par {puzzle.par}</span>
          <ParTrack moves={state.turn} par={puzzle.par} />
          <span className="st-cells" aria-label={`${cellsGot.filter(Boolean).length} of 2 cells`}>
            {cellsGot.map((g, k) => (
              <svg key={k} width="15" height="22" viewBox="0 0 15 22" aria-hidden="true">
                <rect x="5" y="0.5" width="5" height="3" rx="1" className={g ? 'cap got' : 'cap'} />
                <rect x="1.5" y="3" width="12" height="18" rx="3" className={g ? 'cap got' : 'cap'} />
              </svg>
            ))}
            {state.got === 3 && <span>exit open</span>}
          </span>
          {world.has.KEYS && (
            <span className="st-keys" aria-label={`${state.keys} ${state.keys === 1 ? 'key' : 'keys'} held`}>
              <svg width="22" height="14" viewBox="0 0 22 14" aria-hidden="true">
                <circle cx="6" cy="7" r="4" fill="none" stroke="currentColor" strokeWidth="2.2" />
                <path d="M10 7h10M17 7v4" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
              </svg>
              {state.keys}
            </span>
          )}
          {world.has.PAINT && (
            <span className="st-paint">
              <i style={{ background: state.paint ? PAINT_INK[state.paint - 1] : 'transparent' }} />
              {state.paint === 1 ? 'green' : state.paint === 2 ? 'violet' : 'no paint'}
            </span>
          )}
          {practice && <span className="st-mode">{replaying ? 'par route' : 'practice'}</span>}
          {isPast && !solvedOfficially && <span className="st-mode">from {prettyDate(data.date)}</span>}
          {state.solved && shownResult && (
            <button type="button" className="btn small" onClick={() => setSheet('result')}>
              See result
            </button>
          )}
        </div>

        <Forecast world={world} turn={state.turn} />

        <p className={info ? 'info' : 'info idle'} aria-live="polite">
          {info ??
            (!hintSeen && run.route.length === 0
              ? 'You are the orange ringed dot. Swipe or use the pad to move. Grab both energy cells (the batteries), then reach the EXIT door. Dashed rings show where each move would land you.'
              : 'Tap and hold (or hover) any tile to see what it is.')}
        </p>

        <Controls
          world={world}
          state={state}
          previews={previews}
          canUndo={run.route.length > 0}
          disabled={state.solved || replaying || submitting}
          onAction={act}
          onUndo={undo}
          onRestart={restart}
          onFocus={setFocus}
        />

      </section>

      {sheet === 'rules' && (
        <Sheet title="How it works" onClose={() => setSheet(null)} wide>
          <Rules puzzle={puzzle} seen={data.me?.seen ?? []} />
        </Sheet>
      )}
      {sheet === 'ranks' && (
        <Sheet title={`Board for #${padNumber(puzzle.number)}`} onClose={() => setSheet(null)}>
          <RanksPanel data={ranks} me={data.user.name} loading={!ranks} />
        </Sheet>
      )}
      {sheet === 'you' && (
        <Sheet title={data.user.name ? `u/${data.user.name}` : 'You'} onClose={() => setSheet(null)}>
          <YouPanel me={data.me} loggedIn={loggedIn} flairBusy={flairBusy} onFlair={(on) => void flair(on)} />
        </Sheet>
      )}
      {sheet === 'past' && (
        <Sheet title="Past puzzles" onClose={() => setSheet(null)}>
          <ArchivePanel days={past} current={data.date} onOpen={openDay} />
          {STANDALONE && <BenchPicker current={puzzle.mutations} />}
        </Sheet>
      )}
      {sheet === 'result' && shownResult && (
        <Sheet title={`Solved in ${shownResult.moves}`} onClose={() => setSheet(null)}>
          <ResultPanel
            puzzle={puzzle}
            result={shownResult}
            practice={!!lastResult && !!data.result && lastResult.at !== data.result.at}
            official={data.result}
            me={data.me}
            day={data.day}
            myRank={data.board.mine?.rank ?? null}
            vote={data.vote}
            nextAt={data.nextAt}
            loggedIn={loggedIn}
            onVote={(m) => void vote(m)}
            voting={voting}
            onComment={() => void comment()}
            onCopy={() => void copy()}
            onWatchPar={watchPar}
            onPractice={startPractice}
            onLogin={() => showLoginPrompt()}
            onRanks={() => setSheet('ranks')}
          />
        </Sheet>
      )}
      <Toasts />
    </main>
  );
}

/** Standalone only: move the clock on a day to test the next puzzle, votes and streaks. */
function NextDay() {
  const ahead = dayOffset();
  return (
    <span className="test-day">
      <button type="button" className="test-btn" onClick={() => jumpToDay(ahead + 1)} title="Testing: move the clock to the next day">
        Next day
      </button>
      {ahead > 0 && (
        <button type="button" className="test-btn quiet" onClick={() => jumpToDay(0)} title="Testing: back to the real date">
          {ahead === 1 ? '1 day ahead' : `${ahead} days ahead`}, reset
        </button>
      )}
    </span>
  );
}

/** Offline only: load a scratch board with any mix of mutations. */
function BenchPicker({ current }: { current: MutationId[] }) {
  const [picked, setPicked] = useState<MutationId[]>(current);
  const toggle = (m: MutationId): void =>
    setPicked((p) => (p.includes(m) ? p.filter((x) => x !== m) : p.length >= 3 ? p : [...p, m]));
  const go = (q: string): void => {
    window.location.search = q;
  };
  return (
    <section className="bench">
      <h3 className="rules-sub">Test bench</h3>
      <p className="muted small">Pick up to three mutations for a scratch board. Results here are not saved.</p>
      <div className="catalogue">
        {ALL_MUTATIONS.map((m) => (
          <button
            key={m}
            type="button"
            className={picked.includes(m) ? 'cat got' : 'cat'}
            style={{ ['--mut' as string]: MUTATIONS[m].ink }}
            onClick={() => toggle(m)}
            aria-pressed={picked.includes(m)}
          >
            <MutationGlyph id={m} size={16} />
            {MUTATIONS[m].name}
          </button>
        ))}
      </div>
      <div className="result-actions">
        <button type="button" className="btn" disabled={picked.length === 0} onClick={() => go(`?muts=${picked.join(',')}`)}>
          Load scratch board
        </button>
        <button type="button" className="btn ghost" onClick={() => go('')}>
          Back to today
        </button>
      </div>
    </section>
  );
}

/** Standalone builds show toasts in-page; on Reddit the platform does it. */
function Toasts() {
  const [msg, setMsg] = useState<string | null>(null);
  const timer = useRef(0);
  useEffect(() => {
    const on = (e: Event): void => {
      setMsg((e as CustomEvent<string>).detail);
      window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => setMsg(null), 2600);
    };
    window.addEventListener('mutator-toast', on);
    return () => window.removeEventListener('mutator-toast', on);
  }, []);
  return msg ? (
    <div className="toast" role="status">
      {msg}
    </div>
  ) : null;
}

createRoot(document.getElementById('root') as HTMLElement).render(
  <StrictMode>
    <App />
  </StrictMode>
);
