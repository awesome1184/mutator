import { Hono } from 'hono';
import type { TaskResponse } from '@devvit/web/server';
import type { TriggerResponse, UiResponse } from '@devvit/web/shared';
import { systemEnv } from '../env.ts';
import { ensureDailyPost } from '../posts.ts';

export const internal = new Hono();

internal.post('/menu/post-today', async (c) => {
  try {
    const post = await ensureDailyPost(systemEnv());
    return c.json<UiResponse>({ navigateTo: post.url }, 200);
  } catch (err) {
    console.log(`MUTATOR: menu post failed: ${String(err)}`);
    return c.json<UiResponse>({ showToast: 'Could not create today’s post. Check the app logs.' }, 400);
  }
});

const createToday = async (): Promise<void> => {
  const post = await ensureDailyPost(systemEnv());
  console.log(`MUTATOR: daily post ${post.created ? 'created' : 'already existed'}: ${post.postId}`);
};

internal.post('/triggers/on-app-install', async (c) => {
  try {
    await createToday();
  } catch (err) {
    console.log(`MUTATOR: install post failed: ${String(err)}`);
  }
  return c.json<TriggerResponse>({}, 200);
});

internal.post('/triggers/on-app-upgrade', async (c) => {
  try {
    await createToday();
  } catch (err) {
    console.log(`MUTATOR: upgrade post failed: ${String(err)}`);
  }
  return c.json<TriggerResponse>({}, 200);
});

internal.post('/scheduler/daily-post', async (c) => {
  try {
    await createToday();
  } catch (err) {
    console.log(`MUTATOR: scheduled post failed: ${String(err)}`);
  }
  return c.json<TaskResponse>({}, 200);
});
