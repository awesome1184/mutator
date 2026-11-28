// Game service: storage-agnostic business logic. The Devvit server runs it on
// Redis; the standalone web build runs the same code on localStorage.

import type {
  ArchiveEntry,
  BoardEntry,
  DayStats,
  LeaderboardResponse,
  Profile,
  Result,
  StateResponse,
  StreakEntry,
  SubmitRequest,
  SubmitResponse,
  VoteInfo
} from './api.ts';
import { addDays, dateToMs, dayDiff, isDateKey, msUntilNextDay, todayKey } from './engine/date.ts';
import { generatePuzzle, publicPuzzle } from './engine/generator.ts';
import { parseActions, RULES_VERSION } from './engine/grid.ts';
import { ALL_MUTATIONS } from './engine/mutations.ts';
import { dayPlan } from './engine/schedule.ts';
import { replay } from './engine/sim.ts';
import type { MutationId, Puzzle } from './engine/types.ts';
import { compileWorld } from './engine/world.ts';
import { starsFor } from './scoring.ts';

export type Kv = {
  get(key: string): Promise<string | undefined | null>;
  set(key: string, value: string, opts?: { nx?: boolean }): Promise<unknown>;
  del(key: string): Promise<unknown>;
  hGet(key: string, field: string): Promise<string | undefined | null>;
  hSet(key: string, values: Record<string, string>): Promise<unknown>;
  hSetNX(key: string, field: string, value: string): Promise<number>;
  hGetAll(key: string): Promise<Record<string, string>>;
  hIncrBy(key: string, field: string, by: number): Promise<number>;
  zAdd(key: string, member: string, score: number): Promise<unknown>;
  zRem(key: string, member: string): Promise<unknown>;
  /** Members ordered by ascending score (or descending when reverse). */
  zRange(key: string, start: number, stop: number, reverse?: boolean): Promise<{ member: string; score: number }[]>;
  zRank(key: string, member: string): Promise<number | undefined | null>;
  zScore(key: string, member: string): Promise<number | undefined | null>;
};

export type Env = {
  kv: Kv;
  now: () => number;
  user: { name: string | null; avatar: string | null };
  /** Optional avatar lookup (Reddit snoovatars). */
  avatars?: (names: string[]) => Promise<Record<string, string | null>>;
};

const K = {
  puzzle: (d: string) => `puzzle:v${RULES_VERSION}:${d}`,
  /** Puzzles built ahead of time, one per possible vote outcome. */
  drafts: (d: string) => `drafts:v${RULES_VERSION}:${d}`,
  results: (d: string) => `results:${d}`,
  board: (d: string) => `board:${d}`,
  stats: (d: string) => `stats:${d}`,
  dist: (d: string) => `dist:${d}`,
  votes: (d: string) => `votes:${d}`,
  voters: (d: string) => `voters:${d}`,
  user: (n: string) => `user:${n}`,
  streaks: 'streaks',
  days: 'days',
  dayPost: 'day-post'
};

// ---------------------------------------------------------------------------
// Puzzles
// ---------------------------------------------------------------------------

export async function communityPick(kv: Kv, date: string): Promise<MutationId | null> {
  const plan = dayPlan(date);
  const tallies = await kv.hGetAll(K.votes(date));
  let best: MutationId | null = null;
  let bestVotes = 0;
  // Candidate order breaks ties, so the outcome never depends on timing.
  for (const m of plan.candidates) {
    const v = Number(tallies[m] ?? 0);
    if (v > bestVotes) {
      best = m;
      bestVotes = v;
    }
  }
  return best;
}

/** Loads the frozen puzzle for a date, generating (and freezing) it on first use. */
export async function loadPuzzle(env: Env, date: string): Promise<Puzzle> {
  const cached = await env.kv.get(K.puzzle(date));
  if (cached) return JSON.parse(cached) as Puzzle;
  const pick = await communityPick(env.kv, date);
  // A draft is exactly what generatePuzzle would return, built earlier by prepareTomorrow.
  const draft = await env.kv.hGet(K.drafts(date), pick ?? 'none');
  const puzzle = draft ? (JSON.parse(draft) as Puzzle) : generatePuzzle(date, { pick });
  await env.kv.set(K.puzzle(date), JSON.stringify(puzzle), { nx: true });
  // Re-read so concurrent generators agree on the stored copy.
  const stored = await env.kv.get(K.puzzle(date));
  const final = stored ? (JSON.parse(stored) as Puzzle) : puzzle;
  await env.kv.zAdd(K.days, date, final.number);
  await env.kv.del(K.drafts(date));
  return final;
}

/**
 * Builds one of tomorrow's possible puzzles (one per vote outcome) so the
 * daily post doesn't wait on the generator. Builds at most one per call to
 * keep each scheduled run short. Returns how many are still to build.
 */
export async function prepareTomorrow(env: Env): Promise<number> {
  const date = addDays(todayKey(env.now()), 1);
  const picks: (MutationId | null)[] = [null, ...dayPlan(date).candidates];
  const have = await env.kv.hGetAll(K.drafts(date));
  const missing = picks.filter((m) => !have[m ?? 'none']);
  const next = missing[0];
  if (next === undefined) return 0;
  await env.kv.hSet(K.drafts(date), { [next ?? 'none']: JSON.stringify(generatePuzzle(date, { pick: next })) });
  return missing.length - 1;
}

export function resolveDate(env: Env, requested: unknown): string {
  const today = todayKey(env.now());
  if (!isDateKey(requested)) return today;
  // Never serve the future; never serve before the epoch.
  if (dayDiff(requested, today) < 0) return today;
  if (dayDiff('2026-01-01', requested) < 0) return today;
  return requested;
}

// ---------------------------------------------------------------------------
// Profiles, stats, boards
// ---------------------------------------------------------------------------

function emptyProfile(): Profile {
  return { solved: 0, stars: 0, parCount: 0, cleanCount: 0, streak: 0, best: 0, last: null, seen: [], flair: false };
}

export async function getProfile(env: Env, name: string): Promise<Profile> {
  const raw = await env.kv.hGetAll(K.user(name));
  const p = emptyProfile();
  if (!raw || Object.keys(raw).length === 0) return p;
  p.solved = Number(raw.solved ?? 0);
  p.stars = Number(raw.stars ?? 0);
  p.parCount = Number(raw.parCount ?? 0);
  p.cleanCount = Number(raw.cleanCount ?? 0);
  p.best = Number(raw.best ?? 0);
  p.last = raw.last || null;
  p.flair = raw.flair === '1';
  try {
    p.seen = JSON.parse(raw.seen ?? '[]') as MutationId[];
  } catch {
    p.seen = [];
  }
  const today = todayKey(env.now());
  const streak = Number(raw.streak ?? 0);
  p.streak = p.last && dayDiff(p.last, today) <= 1 ? streak : 0;
  return p;
}

async function saveProfile(env: Env, name: string, p: Profile): Promise<void> {
  await env.kv.hSet(K.user(name), {
    solved: String(p.solved),
    stars: String(p.stars),
    parCount: String(p.parCount),
    cleanCount: String(p.cleanCount),
    streak: String(p.streak),
    best: String(p.best),
    last: p.last ?? '',
    seen: JSON.stringify(p.seen),
    flair: p.flair ? '1' : '0'
  });
}

export async function getDayStats(env: Env, date: string): Promise<DayStats> {
  const [stats, dist] = await Promise.all([env.kv.hGetAll(K.stats(date)), env.kv.hGetAll(K.dist(date))]);
  return {
    solvers: Number(stats.solvers ?? 0),
    parCount: Number(stats.parCount ?? 0),
    cleanCount: Number(stats.cleanCount ?? 0),
    dist: Object.fromEntries(Object.entries(dist).map(([k, v]) => [k, Number(v)]))
  };
}

/** Lower is better: moves, then rewinds, then how early in the day. */
function boardScore(r: Result): number {
  const minutes = Math.max(0, Math.min(99_999, Math.floor((r.at - dateToMs(r.date)) / 60_000)));
  return r.moves * 1e8 + Math.min(r.rewinds, 999) * 1e5 + minutes;
}

function decodeScore(score: number): { moves: number; rewinds: number } {
  const moves = Math.floor(score / 1e8);
  const rewinds = Math.floor((score - moves * 1e8) / 1e5);
  return { moves, rewinds };
}

async function withAvatars<T extends { name: string; avatar: string | null }>(env: Env, rows: T[]): Promise<T[]> {
  if (!env.avatars || rows.length === 0) return rows;
  try {
    const map = await env.avatars(rows.map((r) => r.name));
    return rows.map((r) => ({ ...r, avatar: map[r.name] ?? null }));
  } catch {
    return rows;
  }
}

export async function getBoard(env: Env, date: string, par: number, count = 10): Promise<{ top: BoardEntry[]; mine: BoardEntry | null }> {
  const rows = await env.kv.zRange(K.board(date), 0, count - 1);
  let top: BoardEntry[] = rows.map((row, i) => {
    const { moves, rewinds } = decodeScore(row.score);
    return { rank: i + 1, name: row.member, moves, rewinds, stars: starsFor(moves, par), avatar: null };
  });
  top = await withAvatars(env, top);
  let mine: BoardEntry | null = null;
  const name = env.user.name;
  if (name) {
    const [rank, score] = await Promise.all([env.kv.zRank(K.board(date), name), env.kv.zScore(K.board(date), name)]);
    if (rank !== undefined && rank !== null && score !== undefined && score !== null) {
      const { moves, rewinds } = decodeScore(score);
      mine = { rank: rank + 1, name, moves, rewinds, stars: starsFor(moves, par), avatar: env.user.avatar };
    }
  }
  return { top, mine };
}

export async function getStreakBoard(env: Env, count = 10): Promise<StreakEntry[]> {
  const rows = await env.kv.zRange(K.streaks, 0, count * 3, true);
  const today = todayKey(env.now());
  const out: StreakEntry[] = [];
  for (const row of rows) {
    if (out.length >= count) break;
    const last = await env.kv.hGet(K.user(row.member), 'last');
    if (!last || dayDiff(last, today) > 1) continue;
    out.push({ rank: out.length + 1, name: row.member, streak: row.score, avatar: null });
  }
  return withAvatars(env, out);
}

// ---------------------------------------------------------------------------
// Voting for tomorrow's community slot
// ---------------------------------------------------------------------------

export async function getVote(env: Env, viewingDate: string): Promise<VoteInfo | null> {
  const today = todayKey(env.now());
  if (viewingDate !== today) return null;
  const forDate = addDays(today, 1);
  const plan = dayPlan(forDate);
  const [tallies, mine, frozen] = await Promise.all([
    env.kv.hGetAll(K.votes(forDate)),
    env.user.name ? env.kv.hGet(K.voters(forDate), env.user.name) : Promise.resolve(null),
    env.kv.get(K.puzzle(forDate))
  ]);
  const clean: Record<string, number> = {};
  for (const m of plan.candidates) clean[m] = Number(tallies[m] ?? 0);
  return {
    forDate,
    candidates: plan.candidates,
    tallies: clean,
    mine: mine && plan.candidates.includes(mine as MutationId) ? (mine as MutationId) : null,
    open: !frozen
  };
}

export async function castVote(env: Env, mutation: string): Promise<VoteInfo | { error: string }> {
  const name = env.user.name;
  if (!name) return { error: 'Log in to vote.' };
  const today = todayKey(env.now());
  const forDate = addDays(today, 1);
  const plan = dayPlan(forDate);
  if (!ALL_MUTATIONS.includes(mutation as MutationId) || !plan.candidates.includes(mutation as MutationId)) {
    return { error: 'That mutation is not on the ballot.' };
  }
  if (await env.kv.get(K.puzzle(forDate))) return { error: 'Voting has closed.' };
  const prev = await env.kv.hGet(K.voters(forDate), name);
  if (prev !== mutation) {
    if (prev && plan.candidates.includes(prev as MutationId)) await env.kv.hIncrBy(K.votes(forDate), prev, -1);
    await env.kv.hIncrBy(K.votes(forDate), mutation, 1);
    await env.kv.hSet(K.voters(forDate), { [name]: mutation });
  }
  return (await getVote(env, today)) as VoteInfo;
}

// ---------------------------------------------------------------------------
// State + submit
// ---------------------------------------------------------------------------

async function getResult(env: Env, date: string): Promise<Result | null> {
  if (!env.user.name) return null;
  const raw = await env.kv.hGet(K.results(date), env.user.name);
  return raw ? (JSON.parse(raw) as Result) : null;
}

export async function getState(env: Env, requestedDate: unknown): Promise<StateResponse> {
  const date = resolveDate(env, requestedDate);
  const puzzle = await loadPuzzle(env, date);
  const name = env.user.name;
  const [me, result, day, vote] = await Promise.all([
    name ? getProfile(env, name) : Promise.resolve(null),
    getResult(env, date),
    getDayStats(env, date),
    getVote(env, date)
  ]);
  const board = await getBoard(env, date, puzzle.par);
  return {
    type: 'state',
    date,
    today: todayKey(env.now()),
    nextAt: env.now() + msUntilNextDay(env.now()),
    puzzle: result ? puzzle : publicPuzzle(puzzle),
    user: { name, avatar: env.user.avatar },
    me,
    result,
    day,
    board,
    vote
  };
}

export async function submit(env: Env, req: SubmitRequest): Promise<SubmitResponse> {
  const date = resolveDate(env, req.date);
  const puzzle = await loadPuzzle(env, date);
  const actions = typeof req.route === 'string' && req.route.length <= 200 ? parseActions(req.route) : null;
  const fail = async (error: string): Promise<SubmitResponse> => ({
    type: 'submit',
    accepted: false,
    ranked: false,
    result: null,
    me: env.user.name ? await getProfile(env, env.user.name) : null,
    day: await getDayStats(env, date),
    board: await getBoard(env, date, puzzle.par),
    puzzle: null,
    error
  });
  if (!actions) return fail('That route could not be read.');

  // The server never trusts the client: it replays the exact route.
  const rep = replay(compileWorld(puzzle), actions);
  if (!rep.ok || !rep.solved || rep.solvedAt !== actions.length) return fail('That route does not solve the puzzle.');

  const moves = actions.length;
  const rewinds = Math.max(0, Math.min(9999, Math.floor(Number(req.rewinds) || 0)));
  const now = env.now();
  const result: Result = {
    date,
    moves,
    par: puzzle.par,
    stars: starsFor(moves, puzzle.par),
    rewinds,
    clean: rewinds === 0,
    route: req.route,
    at: now
  };

  const name = env.user.name;
  if (!name) {
    // Logged-out players still get a result, it just is not stored.
    return {
      type: 'submit',
      accepted: true,
      ranked: false,
      result,
      me: null,
      day: await getDayStats(env, date),
      board: await getBoard(env, date, puzzle.par),
        puzzle
    };
  }

  const firstSolve = (await env.kv.hSetNX(K.results(date), name, JSON.stringify(result))) === 1;
  let me = await getProfile(env, name);
  let official = result;
  if (firstSolve) {
    await Promise.all([
      env.kv.zAdd(K.board(date), name, boardScore(result)),
      env.kv.hIncrBy(K.stats(date), 'solvers', 1),
      result.moves <= puzzle.par ? env.kv.hIncrBy(K.stats(date), 'parCount', 1) : Promise.resolve(0),
      result.clean ? env.kv.hIncrBy(K.stats(date), 'cleanCount', 1) : Promise.resolve(0),
      env.kv.hIncrBy(K.dist(date), String(moves), 1)
    ]);
    const today = todayKey(now);
    if (date === today) {
      if (me.last === today) {
        // already counted
      } else if (me.last && dayDiff(me.last, today) === 1) {
        me.streak += 1;
      } else {
        me.streak = 1;
      }
      me.last = today;
      me.best = Math.max(me.best, me.streak);
      await env.kv.zAdd(K.streaks, name, me.streak);
    }
    me.solved += 1;
    me.stars += result.stars;
    if (result.moves <= puzzle.par) me.parCount += 1;
    if (result.clean) me.cleanCount += 1;
    for (const m of puzzle.mutations) if (!me.seen.includes(m)) me.seen.push(m);
    await saveProfile(env, name, me);
    me = await getProfile(env, name);
  } else {
    const prior = await env.kv.hGet(K.results(date), name);
    if (prior) official = JSON.parse(prior) as Result;
  }

  return {
    type: 'submit',
    accepted: true,
    ranked: firstSolve,
    result: official,
    me,
    day: await getDayStats(env, date),
    board: await getBoard(env, date, puzzle.par),
    puzzle
  };
}

export async function setFlairPref(env: Env, on: boolean): Promise<Profile | null> {
  if (!env.user.name) return null;
  await env.kv.hSet(K.user(env.user.name), { flair: on ? '1' : '0' });
  return getProfile(env, env.user.name);
}

export async function getLeaderboard(env: Env, requestedDate: unknown): Promise<LeaderboardResponse> {
  const date = resolveDate(env, requestedDate);
  const puzzle = await loadPuzzle(env, date);
  const [board, streaks] = await Promise.all([getBoard(env, date, puzzle.par, 25), getStreakBoard(env, 10)]);
  return { type: 'leaderboard', date, day: board.top, streaks };
}

// ---------------------------------------------------------------------------
// Posts and archive
// ---------------------------------------------------------------------------

export async function recordPost(kv: Kv, date: string, postId: string): Promise<void> {
  await kv.hSet(K.dayPost, { [date]: postId });
}

export async function postFor(kv: Kv, date: string): Promise<string | null> {
  return (await kv.hGet(K.dayPost, date)) ?? null;
}

export async function getArchive(env: Env, count = 21): Promise<ArchiveEntry[]> {
  const today = todayKey(env.now());
  const posts = await env.kv.hGetAll(K.dayPost);
  const out: ArchiveEntry[] = [];
  for (let k = 0; k < count; k++) {
    const date = addDays(today, -k);
    const raw = await env.kv.get(K.puzzle(date));
    if (!raw) continue;
    const p = JSON.parse(raw) as Puzzle;
    const [solvers, mine] = await Promise.all([
      env.kv.hGet(K.stats(date), 'solvers'),
      env.user.name ? env.kv.hGet(K.results(date), env.user.name) : Promise.resolve(null)
    ]);
    out.push({
      date,
      number: p.number,
      mutations: p.mutations,
      postId: posts[date] ?? null,
      solvers: Number(solvers ?? 0),
      myStars: mine ? (JSON.parse(mine) as Result).stars : null
    });
  }
  return out;
}

/** The app's daily recap comment for the previous day. */
export async function recapText(env: Env, date: string): Promise<string | null> {
  const raw = await env.kv.get(K.puzzle(date));
  if (!raw) return null;
  const p = JSON.parse(raw) as Puzzle;
  const stats = await getDayStats(env, date);
  if (stats.solvers === 0) return null;
  const rows = await env.kv.zRange(K.board(date), 0, 2);
  const pct = Math.round((stats.parCount / stats.solvers) * 100);
  const lines = [
    `**Yesterday's lab notes (#${p.number})**`,
    '',
    `${stats.solvers} solved it. ${pct}% matched par (${p.par}). ${stats.cleanCount} did it without a single rewind.`
  ];
  if (rows.length) lines.push('', `First to the top of the board: ${rows.map((r) => `u/${r.member}`).join(', ')}.`);
  return lines.join('\n');
}
