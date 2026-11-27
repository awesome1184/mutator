// One API surface, two backends: the Devvit server (on Reddit) and an
// in-browser copy of the same service (standalone web build).

import type {
  ActionResponse,
  ArchiveResponse,
  LeaderboardResponse,
  StateResponse,
  SubmitRequest,
  SubmitResponse,
  VoteInfo
} from '../../shared/api.ts';
import type { Puzzle } from '../../shared/engine/types.ts';

export type SplashResponse = {
  type: 'splash';
  date: string;
  today: string;
  puzzle: Puzzle;
  solvers: number;
  parCount: number;
  streak: number;
  stars: number | null;
  name: string | null;
};

export type Api = {
  state(date?: string): Promise<StateResponse>;
  splash(date?: string): Promise<SplashResponse>;
  submit(req: SubmitRequest): Promise<SubmitResponse>;
  vote(mutation: string): Promise<VoteInfo>;
  leaderboard(date?: string): Promise<LeaderboardResponse>;
  archive(): Promise<ArchiveResponse>;
  comment(date: string): Promise<ActionResponse>;
  flair(on: boolean): Promise<ActionResponse>;
};

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, init?.body ? { ...init, headers: { 'Content-Type': 'application/json' } } : init);
  const body = (await res.json().catch(() => null)) as (T & { status?: string; message?: string }) | null;
  if (!res.ok || !body || body.status === 'error') {
    throw new Error(body?.message ?? `Request failed (${res.status})`);
  }
  return body;
}

const qs = (date?: string): string => (date ? `?date=${encodeURIComponent(date)}` : '');

const remote: Api = {
  state: (date) => call(`/api/state${qs(date)}`),
  splash: (date) => call(`/api/splash${qs(date)}`),
  submit: (req) => call('/api/submit', { method: 'POST', body: JSON.stringify(req) }),
  vote: (mutation) => call('/api/vote', { method: 'POST', body: JSON.stringify({ mutation }) }),
  leaderboard: (date) => call(`/api/leaderboard${qs(date)}`),
  archive: () => call('/api/archive'),
  comment: (date) => call(`/api/comment${qs(date)}`, { method: 'POST', body: '{}' }),
  flair: (on) => call('/api/flair', { method: 'POST', body: JSON.stringify({ on }) })
};

let localApi: Promise<Api> | null = null;

async function makeLocal(): Promise<Api> {
  const [{ createMemoryKv }, svc, { publicPuzzle }, scoring] = await Promise.all([
    import('../../shared/memoryKv.ts'),
    import('../../shared/service.ts'),
    import('../../shared/engine/generator.ts'),
    import('../../shared/scoring.ts')
  ]);
  const KEY = 'mutator-local-v1';
  let saved: ReturnType<typeof createMemoryKv>['data'] | undefined;
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) saved = JSON.parse(raw);
  } catch {
    saved = undefined;
  }
  let timer = 0;
  const kv = createMemoryKv(saved, (data) => {
    window.clearTimeout(timer);
    timer = window.setTimeout(() => {
      try {
        localStorage.setItem(KEY, JSON.stringify(data));
      } catch {
        // storage full or blocked: progress just will not persist
      }
    }, 150);
  });
  const env = { kv, now: () => Date.now(), user: { name: 'you', avatar: null } };

  // Test bench: ?muts=GRAVITY,DECAY loads a scratch puzzle with those mutations.
  const benchMuts = new URLSearchParams(window.location.search).get('muts');
  if (benchMuts) {
    const { generatePuzzle } = await import('../../shared/engine/generator.ts');
    const { todayKey } = await import('../../shared/engine/date.ts');
    const muts = benchMuts.split(',') as Puzzle['mutations'];
    const puzzle = generatePuzzle(todayKey(), { mutations: muts });
    const scratch = createMemoryKv();
    const benchEnv = { kv: scratch, now: () => Date.now(), user: { name: 'you', avatar: null } };
    await scratch.set(`puzzle:v${puzzle.v}:${puzzle.dateKey}`, JSON.stringify(puzzle));
    return {
      state: (d) => svc.getState(benchEnv, d),
      splash: async () => ({ type: 'splash', date: puzzle.dateKey, today: puzzle.dateKey, puzzle: publicPuzzle(puzzle), solvers: 0, parCount: 0, streak: 0, stars: null, name: 'you' }),
      submit: (req) => svc.submit(benchEnv, req),
      vote: async () => {
        throw new Error('No voting on the test bench.');
      },
      leaderboard: (d) => svc.getLeaderboard(benchEnv, d),
      archive: async () => ({ type: 'archive', days: [] }),
      comment: async () => ({ ok: false, message: 'Test bench.' }),
      flair: async () => ({ ok: false, message: 'Test bench.' })
    };
  }

  return {
    state: (date) => svc.getState(env, date),
    async splash(date) {
      const s = await svc.getState(env, date);
      return {
        type: 'splash',
        date: s.date,
        today: s.today,
        puzzle: publicPuzzle(s.puzzle),
        solvers: s.day.solvers,
        parCount: s.day.parCount,
        streak: s.me?.streak ?? 0,
        stars: s.result?.stars ?? null,
        name: 'you'
      };
    },
    submit: (req) => svc.submit(env, req),
    async vote(mutation) {
      const res = await svc.castVote(env, mutation);
      if ('error' in res) throw new Error(res.error);
      return res;
    },
    leaderboard: (date) => svc.getLeaderboard(env, date),
    async archive() {
      return { type: 'archive', days: await svc.getArchive(env) };
    },
    async comment(date) {
      const s = await svc.getState(env, date);
      if (!s.result) return { ok: false, message: 'Solve the puzzle first.' };
      const text = scoring.commentText({ number: s.puzzle.number, mutations: s.puzzle.mutations, ...s.result });
      await navigator.clipboard?.writeText(text).catch(() => undefined);
      return { ok: true, message: 'Copied. Commenting works when you play on Reddit.' };
    },
    async flair() {
      return { ok: false, message: 'Flair only works on Reddit.' };
    }
  };
}

export const STANDALONE = import.meta.env.VITE_STANDALONE === '1';

export function getApi(): Promise<Api> {
  if (!STANDALONE) return Promise.resolve(remote);
  localApi ??= makeLocal();
  return localApi;
}
