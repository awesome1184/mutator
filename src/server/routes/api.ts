import { Hono } from 'hono';
import type { Context as HonoContext } from 'hono';
import { context, reddit } from '@devvit/web/server';
import type { ActionResponse, ErrorResponse, SubmitRequest, VoteRequest } from '../../shared/api.ts';
import { commentText, flairText } from '../../shared/scoring.ts';
import {
  castVote,
  getArchive,
  getDayStats,
  getLeaderboard,
  getProfile,
  getState,
  loadPuzzle,
  resolveDate,
  setFlairPref,
  submit
} from '../../shared/service.ts';
import { publicPuzzle } from '../../shared/engine/generator.ts';
import { todayKey } from '../../shared/engine/date.ts';
import { currentEnv } from '../env.ts';

export const api = new Hono();

/** Date requested by the client, falling back to the post's own date. */
function requestedDate(c: HonoContext): string | undefined {
  const q = c.req.query('date');
  if (q) return q;
  const fromPost = context.postData?.date;
  return typeof fromPost === 'string' ? fromPost : undefined;
}

function fail(c: HonoContext, err: unknown, status: 400 | 500 = 500) {
  console.log(`MUTATOR api error: ${String(err)}`);
  return c.json<ErrorResponse>({ status: 'error', message: err instanceof Error ? err.message : String(err) }, status);
}

api.get('/state', async (c) => {
  try {
    const env = await currentEnv();
    return c.json(await getState(env, requestedDate(c)));
  } catch (err) {
    return fail(c, err);
  }
});

/** Small payload for the in-feed preview. */
api.get('/splash', async (c) => {
  try {
    const env = await currentEnv();
    const date = resolveDate(env, requestedDate(c));
    const puzzle = await loadPuzzle(env, date);
    const [day, me] = await Promise.all([getDayStats(env, date), env.user.name ? getProfile(env, env.user.name) : null]);
    let stars: number | null = null;
    if (env.user.name) {
      const raw = await env.kv.hGet(`results:${date}`, env.user.name);
      if (raw) stars = (JSON.parse(raw) as { stars: number }).stars;
    }
    return c.json({
      type: 'splash',
      date,
      today: todayKey(env.now()),
      puzzle: publicPuzzle(puzzle),
      solvers: day.solvers,
      parCount: day.parCount,
      streak: me?.streak ?? 0,
      stars,
      name: env.user.name
    });
  } catch (err) {
    return fail(c, err);
  }
});

api.post('/submit', async (c) => {
  try {
    const env = await currentEnv();
    const body = await c.req.json<SubmitRequest>();
    const res = await submit(env, body);
    // Keep flair in step with the streak for players who opted in.
    if (res.ranked && res.me?.flair && env.user.name && context.subredditName) {
      try {
        await reddit.setUserFlair({
          subredditName: context.subredditName,
          username: env.user.name,
          text: flairText(res.me.streak),
          backgroundColor: '#ff6c2f',
          textColor: 'dark'
        });
      } catch (err) {
        console.log(`MUTATOR: flair update failed: ${String(err)}`);
      }
    }
    return c.json(res);
  } catch (err) {
    return fail(c, err);
  }
});

api.post('/vote', async (c) => {
  try {
    const env = await currentEnv();
    const body = await c.req.json<VoteRequest>();
    const res = await castVote(env, body.mutation);
    if ('error' in res) return c.json<ErrorResponse>({ status: 'error', message: res.error }, 400);
    return c.json(res);
  } catch (err) {
    return fail(c, err);
  }
});

api.get('/leaderboard', async (c) => {
  try {
    const env = await currentEnv();
    return c.json(await getLeaderboard(env, requestedDate(c)));
  } catch (err) {
    return fail(c, err);
  }
});

api.get('/archive', async (c) => {
  try {
    const env = await currentEnv();
    return c.json({ type: 'archive', days: await getArchive(env) });
  } catch (err) {
    return fail(c, err);
  }
});

/** Posts the player's result as a comment on the post, as the player. */
api.post('/comment', async (c) => {
  try {
    const env = await currentEnv();
    const name = env.user.name;
    const postId = context.postId;
    if (!name || !postId) return c.json<ActionResponse>({ ok: false, message: 'Log in to comment.' }, 400);
    const date = resolveDate(env, requestedDate(c));
    const raw = await env.kv.hGet(`results:${date}`, name);
    if (!raw) return c.json<ActionResponse>({ ok: false, message: 'Solve the puzzle first.' }, 400);
    const result = JSON.parse(raw) as { moves: number; par: number; clean: boolean; route: string };
    const puzzle = await loadPuzzle(env, date);
    const sharedKey = `commented:${date}`;
    if ((await env.kv.hSetNX(sharedKey, name, '1')) === 0) {
      return c.json<ActionResponse>({ ok: false, message: 'You already posted today’s result.' });
    }
    await reddit.submitComment({
      id: postId,
      text: commentText({ number: puzzle.number, mutations: puzzle.mutations, ...result }),
      runAs: 'USER'
    });
    return c.json<ActionResponse>({ ok: true, message: 'Posted to the comments.' });
  } catch (err) {
    return fail(c, err);
  }
});

api.post('/flair', async (c) => {
  try {
    const env = await currentEnv();
    const { on } = await c.req.json<{ on: boolean }>();
    const name = env.user.name;
    if (!name || !context.subredditName) return c.json<ActionResponse>({ ok: false, message: 'Log in first.' }, 400);
    const me = await setFlairPref(env, on);
    if (on) {
      await reddit.setUserFlair({
        subredditName: context.subredditName,
        username: name,
        text: flairText(me?.streak ?? 0),
        backgroundColor: '#ff6c2f',
        textColor: 'dark'
      });
      return c.json<ActionResponse>({ ok: true, message: 'Flair on. It updates when you solve.' });
    }
    await reddit.removeUserFlair(context.subredditName, name);
    return c.json<ActionResponse>({ ok: true, message: 'Flair removed.' });
  } catch (err) {
    return fail(c, err);
  }
});
