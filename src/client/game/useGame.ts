import { useCallback, useMemo, useRef, useState } from 'react';
import { initialState, replay, step } from '../../shared/engine/sim.ts';
import { parseActions } from '../../shared/engine/grid.ts';
import type { Action, GameState, Puzzle, StepEvent } from '../../shared/engine/types.ts';
import { compileWorld, type World } from '../../shared/engine/world.ts';
import { drop, load, save } from '../lib/storage.ts';

export type Run = {
  states: GameState[];
  route: Action[];
  rewinds: number;
  /** Events of the most recent accepted move (for animation). */
  events: StepEvent[];
  /** Increments on every change so the board can animate exactly once. */
  tick: number;
  /** Increments when a move is rejected. */
  bumps: number;
  lastDir: Action | null;
};

type Saved = { route: string; rewinds: number };

const keyFor = (p: Puzzle, practice: boolean): string => `mutator-run:${p.dateKey}:${p.v}${practice ? ':practice' : ''}`;

function restore(world: World, p: Puzzle, practice: boolean): Run {
  const saved = load<Saved | null>(keyFor(p, practice), null);
  const actions = saved ? parseActions(saved.route) : null;
  if (saved && actions) {
    const r = replay(world, actions);
    if (r.ok && !r.solved) {
      return { states: r.states, route: actions, rewinds: saved.rewinds, events: [], tick: 0, bumps: 0, lastDir: actions.at(-1) ?? null };
    }
  }
  return { states: [initialState(world)], route: [], rewinds: 0, events: [], tick: 0, bumps: 0, lastDir: null };
}

export function useGame(puzzle: Puzzle, practice: boolean, onSolved: (route: string, rewinds: number) => void) {
  const world = useMemo(() => compileWorld(puzzle), [puzzle]);
  const [run, setRun] = useState<Run>(() => restore(world, puzzle, practice));
  const runRef = useRef(run);
  runRef.current = run;

  // Reset when the puzzle or mode changes.
  const ident = `${puzzle.dateKey}:${practice}`;
  const identRef = useRef(ident);
  if (identRef.current !== ident) {
    identRef.current = ident;
    const fresh = restore(world, puzzle, practice);
    runRef.current = fresh;
    setRun(fresh);
  }

  const persist = useCallback(
    (r: Run) => {
      if (r.states.at(-1)?.solved) drop(keyFor(puzzle, practice));
      else save(keyFor(puzzle, practice), { route: r.route.join(''), rewinds: r.rewinds } satisfies Saved);
    },
    [puzzle, practice]
  );

  const commit = useCallback(
    (r: Run) => {
      runRef.current = r;
      setRun(r);
      persist(r);
    },
    [persist]
  );

  const move = useCallback(
    (a: Action): { ok: boolean; events: StepEvent[] } => {
      const cur = runRef.current;
      const s = cur.states.at(-1) as GameState;
      if (s.solved) return { ok: false, events: [] };
      const res = step(world, s, a);
      if (!res.ok) {
        const r = { ...cur, bumps: cur.bumps + 1, lastDir: a };
        runRef.current = r;
        setRun(r);
        return { ok: false, events: [] };
      }
      const next: Run = {
        states: [...cur.states, res.state],
        route: [...cur.route, a],
        rewinds: cur.rewinds,
        events: res.events,
        tick: cur.tick + 1,
        bumps: cur.bumps,
        lastDir: a
      };
      commit(next);
      if (res.state.solved) onSolved(next.route.join(''), next.rewinds);
      return { ok: true, events: res.events };
    },
    [world, commit, onSolved]
  );

  const undo = useCallback((): boolean => {
    const cur = runRef.current;
    if (cur.route.length === 0 || cur.states.at(-1)?.solved) return false;
    commit({
      states: cur.states.slice(0, -1),
      route: cur.route.slice(0, -1),
      rewinds: cur.rewinds + 1,
      events: [],
      tick: cur.tick + 1,
      bumps: cur.bumps,
      lastDir: cur.route.at(-2) ?? null
    });
    return true;
  }, [commit]);

  const restart = useCallback((): boolean => {
    const cur = runRef.current;
    if (cur.route.length === 0) return false;
    commit({
      states: [initialState(world)],
      route: [],
      rewinds: cur.states.at(-1)?.solved ? 0 : cur.rewinds + 1,
      events: [],
      tick: cur.tick + 1,
      bumps: cur.bumps,
      lastDir: null
    });
    return true;
  }, [commit, world]);

  /** Plays a whole route from the start (used for the par replay). */
  const load = useCallback(
    (route: Action[], rewinds = 0) => {
      const r = replay(world, route);
      commit({ states: r.states, route: route.slice(0, r.states.length - 1), rewinds, events: [], tick: runRef.current.tick + 1, bumps: 0, lastDir: null });
    },
    [world, commit]
  );

  return { world, run, state: run.states.at(-1) as GameState, move, undo, restart, load };
}
