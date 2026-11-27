import { test } from 'node:test';
import assert from 'node:assert/strict';
import { addDays, dateToMs } from '../src/shared/engine/date.ts';
import { dayPlan } from '../src/shared/engine/schedule.ts';
import { createMemoryKv } from '../src/shared/memoryKv.ts';
import { castVote, getState, loadPuzzle, submit, type Env } from '../src/shared/service.ts';

function envFor(kv: ReturnType<typeof createMemoryKv>, name: string | null, date: string, hour = 12): Env {
  return { kv, now: () => dateToMs(date) + hour * 3_600_000, user: { name, avatar: null } };
}

test('state hides the par route until solved', async () => {
  const kv = createMemoryKv();
  const s = await getState(envFor(kv, 'alice', '2026-12-02'), '2026-12-02');
  assert.equal(s.puzzle.solution, undefined);
  assert.equal(s.result, null);
});

test('submit replays the route and ranks only the first solve', async () => {
  const kv = createMemoryKv();
  const date = '2026-12-02';
  const env = envFor(kv, 'alice', date);
  const puzzle = await loadPuzzle(env, date);
  const bad = await submit(env, { date, route: 'UUUU', rewinds: 0 });
  assert.equal(bad.accepted, false);

  const good = await submit(env, { date, route: puzzle.solution ?? '', rewinds: 0 });
  assert.equal(good.accepted, true);
  assert.equal(good.ranked, true);
  assert.equal(good.result?.stars, 3);
  assert.equal(good.me?.streak, 1);
  assert.ok(good.newBadges.includes('spotless'));
  assert.equal(good.day.solvers, 1);

  const again = await submit(env, { date, route: puzzle.solution ?? '', rewinds: 3 });
  assert.equal(again.ranked, false);
  assert.equal(again.day.solvers, 1);
});

test('streak counts consecutive UTC days', async () => {
  const kv = createMemoryKv();
  let date = '2026-12-01';
  let last = 0;
  for (let i = 0; i < 3; i++) {
    const env = envFor(kv, 'bob', date);
    const p = await loadPuzzle(env, date);
    const r = await submit(env, { date, route: p.solution ?? '', rewinds: 1 });
    last = r.me?.streak ?? 0;
    date = addDays(date, 1);
  }
  assert.equal(last, 3);
  // Skipping a day resets the visible streak.
  const later = await getState(envFor(kv, 'bob', addDays(date, 1)), addDays(date, 1));
  assert.equal(later.me?.streak, 0);
});

test('votes decide tomorrow’s community slot, ties go to the first candidate', async () => {
  const kv = createMemoryKv();
  const today = '2026-12-02';
  const tomorrow = addDays(today, 1);
  const plan = dayPlan(tomorrow);
  const second = plan.candidates[1]!;
  await castVote(envFor(kv, 'a', today), second);
  await castVote(envFor(kv, 'b', today), second);
  await castVote(envFor(kv, 'c', today), plan.candidates[0]!);
  const p = await loadPuzzle(envFor(kv, null, tomorrow), tomorrow);
  assert.equal(p.communityPick, second);
  assert.ok(p.mutations.includes(second));
  // Once the puzzle exists, voting is closed.
  const late = await castVote(envFor(kv, 'd', today, 23), plan.candidates[2]!);
  assert.ok('error' in late);
});

test('the future is never served', async () => {
  const kv = createMemoryKv();
  const s = await getState(envFor(kv, null, '2026-12-02'), '2026-12-09');
  assert.equal(s.date, '2026-12-02');
});
