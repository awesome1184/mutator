import { ACTION_ARROW } from './engine/grid.ts';
import { ALL_MUTATIONS, MUTATIONS } from './engine/mutations.ts';
import { padNumber } from './engine/date.ts';
import type { Action, MutationId } from './engine/types.ts';

export function starsFor(moves: number, par: number): 1 | 2 | 3 {
  if (moves <= par) return 3;
  if (moves <= par + 3) return 2;
  return 1;
}

export function verdict(moves: number, par: number, clean: boolean): string {
  const over = moves - par;
  if (over <= 0) return clean ? 'Spotless. Par without a single rewind.' : 'On par.';
  if (over === 1) return 'One over par.';
  if (over <= 3) return `${over} over par.`;
  return `${over} over par. Tomorrow, maybe.`;
}

export type Badge = { id: string; title: string; how: string };

export const BADGES: readonly Badge[] = [
  { id: 'first', title: 'First clear', how: 'Solve any puzzle.' },
  { id: 'par', title: 'On par', how: 'Match par.' },
  { id: 'clean', title: 'No rewinds', how: 'Solve without undo or restart.' },
  { id: 'spotless', title: 'Spotless', how: 'Match par without undo or restart.' },
  { id: 'week', title: 'Seven straight', how: 'Solve on 7 days in a row.' },
  { id: 'month', title: 'Thirty straight', how: 'Solve on 30 days in a row.' },
  { id: 'anomaly', title: 'Sunday shift', how: 'Solve a three-mutation Sunday.' },
  { id: 'cat10', title: 'Ten on file', how: 'Solve puzzles with 10 different mutations.' },
  { id: 'cat27', title: 'Full catalogue', how: `Solve puzzles with all ${ALL_MUTATIONS.length} mutations.` }
];

export function mutationTitle(muts: readonly MutationId[]): string {
  return muts.map((m) => MUTATIONS[m].name).join(' × ');
}

export function routeArrows(route: string): string {
  return route
    .split('')
    .map((ch) => ACTION_ARROW[ch as Action] ?? '')
    .join('');
}

/** Spoiler-safe text for clipboard / share sheet. */
export function shareText(o: { number: number; mutations: MutationId[]; moves: number; par: number; clean: boolean }): string {
  const stars = starsFor(o.moves, o.par);
  const marks = '■'.repeat(stars) + '□'.repeat(3 - stars);
  return [
    `MUTATOR #${padNumber(o.number)} · ${mutationTitle(o.mutations)}`,
    `${marks} ${o.moves} moves (par ${o.par})${o.clean ? ' · no rewinds' : ''}`
  ].join('\n');
}

/** Markdown for a Reddit comment; the route is hidden behind a spoiler. */
export function commentText(o: { number: number; mutations: MutationId[]; moves: number; par: number; clean: boolean; route: string }): string {
  const arrows = routeArrows(o.route).replace(/·/g, '•');
  return `${shareText(o).replace('\n', '  \n')}\n\nmy route: >!${arrows}!<`;
}

export function flairText(streak: number): string {
  return streak >= 2 ? `MUTATOR · ${streak}-day streak` : 'MUTATOR · solver';
}
