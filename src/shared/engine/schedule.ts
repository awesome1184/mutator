// Which mutations appear on which day, and how hard the day is.
//
// - Every day has one "community slot". Players vote between three
//   candidates the day before; the winner is spliced into the next puzzle.
// - Tuesday to Sunday also have a fixed "primary" mutation that cycles through
//   the whole roster so every mutation shows up regularly.
// - Monday is a gentle one-mutation warm-up; Sunday adds a third mutation.

import { addDays, challengeNumber, weekdayOf } from './date.ts';
import { ALL_MUTATIONS, MUTATIONS } from './mutations.ts';
import { SeededRng } from './rng.ts';
import type { MutationId, TierId } from './types.ts';

export type Tier = {
  id: TierId;
  label: string;
  slots: 1 | 2 | 3;
  par: [number, number];
  /** Extra random walls on top of the layout. */
  walls: [number, number];
};

export const TIERS: Record<number, Tier> = {
  1: { id: 'warmup', label: 'Warm-up', slots: 1, par: [6, 11], walls: [3, 6] },
  2: { id: 'standard', label: 'Standard', slots: 2, par: [8, 13], walls: [2, 5] },
  3: { id: 'tricky', label: 'Tricky', slots: 2, par: [9, 15], walls: [3, 6] },
  4: { id: 'tricky', label: 'Tricky', slots: 2, par: [10, 16], walls: [3, 6] },
  5: { id: 'hard', label: 'Hard', slots: 2, par: [11, 18], walls: [3, 7] },
  6: { id: 'expert', label: 'Expert', slots: 2, par: [12, 22], walls: [4, 7] },
  0: { id: 'anomaly', label: 'Anomaly', slots: 3, par: [10, 22], walls: [2, 5] }
};

/** PAYLOAD_MASS only matters next to a force, so it is never a primary. */
const PRIMARY_POOL: readonly MutationId[] = ALL_MUTATIONS.filter((m) => m !== 'PAYLOAD_MASS');

function cycleOrder(cycle: number): MutationId[] {
  return new SeededRng(`mutator:cycle:${cycle}`).shuffle(PRIMARY_POOL);
}

function rosterAt(dayIndex: number, offset = 0): MutationId {
  const n = PRIMARY_POOL.length;
  const k = dayIndex + offset;
  const cycle = Math.floor(k / n);
  return cycleOrder(cycle)[((k % n) + n) % n] as MutationId;
}

export type DayPlan = {
  dateKey: string;
  number: number;
  weekday: number;
  tier: Tier;
  /** Fixed mutation (null on Mondays). */
  primary: MutationId | null;
  /** Sunday's extra fixed mutation. */
  tertiary: MutationId | null;
  /** Three options for the community slot. The first is the default. */
  candidates: MutationId[];
};

export function dayPlan(dateKey: string): DayPlan {
  const number = challengeNumber(dateKey);
  const weekday = weekdayOf(dateKey);
  const tier = TIERS[weekday] as Tier;
  const dayIndex = number - 1;

  const fixed: MutationId[] = [];
  let primary: MutationId | null = null;
  let tertiary: MutationId | null = null;
  if (tier.slots >= 2) {
    primary = rosterAt(dayIndex);
    fixed.push(primary);
  }
  if (tier.slots === 3) {
    tertiary = rosterAt(dayIndex, 13);
    if (tertiary === primary) tertiary = rosterAt(dayIndex, 14);
    fixed.push(tertiary);
  }

  // Keep neighbouring days fresh: avoid yesterday's and tomorrow's primaries.
  const avoid = new Set<MutationId>(fixed);
  avoid.add(rosterAt(dayIndex - 1));
  avoid.add(rosterAt(dayIndex + 1));

  const hostPresent = fixed.some((m) => MUTATIONS.PAYLOAD_MASS.hosts?.includes(m));
  const pool = ALL_MUTATIONS.filter(
    (m) => !avoid.has(m) && (m !== 'PAYLOAD_MASS' || hostPresent) && !(tier.slots === 1 && m === 'PAYLOAD_MASS')
  );
  const rng = new SeededRng(`mutator:candidates:${dateKey}`);
  let candidates = rng.shuffle(pool).slice(0, 3);
  if (tier.slots === 1) {
    // Monday's vote always includes the roster mutation for the day.
    const rostered = rosterAt(dayIndex);
    candidates = [rostered, ...candidates.filter((m) => m !== rostered)].slice(0, 3);
  }

  return { dateKey, number, weekday, tier, primary, tertiary, candidates };
}

/** The ordered mutation list for a day, given the community pick. */
export function mutationsFor(plan: DayPlan, pick: MutationId | null): { mutations: MutationId[]; communityPick: MutationId } {
  const chosen = pick && plan.candidates.includes(pick) ? pick : (plan.candidates[0] as MutationId);
  const list: MutationId[] = [];
  if (plan.primary) list.push(plan.primary);
  list.push(chosen);
  if (plan.tertiary && !list.includes(plan.tertiary)) list.push(plan.tertiary);
  return { mutations: list, communityPick: chosen };
}

export function tomorrowOf(dateKey: string): string {
  return addDays(dateKey, 1);
}
