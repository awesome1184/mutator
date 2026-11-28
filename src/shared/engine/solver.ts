// Exhaustive breadth-first search over every reachable state. Because each
// action costs exactly one move, the first solution found is optimal (par).

import { ACTIONS } from './grid.ts';
import { initialState, stateKey, step } from './sim.ts';
import type { Action, GameState } from './types.ts';
import type { World } from './world.ts';

export type SolveResult = {
  solvable: boolean;
  par: number;
  path: Action[];
  explored: number;
  /** True when the search hit its state budget before finishing. */
  truncated: boolean;
};

export function solve(w: World, opts: { maxDepth?: number; maxStates?: number; from?: GameState } = {}): SolveResult {
  const maxDepth = opts.maxDepth ?? 30;
  const maxStates = opts.maxStates ?? 60000;
  const start = opts.from ?? initialState(w);
  if (start.solved) return { solvable: true, par: start.turn, path: [], explored: 1, truncated: false };

  const states: GameState[] = [start];
  const parent: number[] = [-1];
  const via: Action[] = ['W'];
  const seen = new Set<string | number>([stateKey(w, start)]);
  let head = 0;

  while (head < states.length) {
    if (states.length > maxStates) {
      return { solvable: false, par: -1, path: [], explored: states.length, truncated: true };
    }
    const curIdx = head++;
    const cur = states[curIdx] as GameState;
    if (cur.turn - start.turn >= maxDepth) continue;
    for (const a of ACTIONS) {
      const res = step(w, cur, a);
      if (!res.ok) continue;
      const nxt = res.state;
      if (nxt.solved) {
        const path: Action[] = [a];
        for (let i = curIdx; i > 0; i = parent[i] as number) path.push(via[i] as Action);
        path.reverse();
        return { solvable: true, par: nxt.turn, path, explored: states.length, truncated: false };
      }
      const key = stateKey(w, nxt);
      if (seen.has(key)) continue;
      seen.add(key);
      states.push(nxt);
      parent.push(curIdx);
      via.push(a);
    }
  }
  return { solvable: false, par: -1, path: [], explored: states.length, truncated: false };
}
