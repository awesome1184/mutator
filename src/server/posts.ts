import { context, reddit } from '@devvit/web/server';
import { addDays, padNumber, todayKey, weekdayName } from '../shared/engine/date.ts';
import { TIERS } from '../shared/engine/schedule.ts';
import { mutationTitle } from '../shared/scoring.ts';
import { loadPuzzle, postFor, recapText, recordPost, type Env } from '../shared/service.ts';

export type DailyPost = { postId: string; url: string; created: boolean };

function postUrl(postId: string): string {
  const id = postId.replace(/^t3_/, '');
  return `https://www.reddit.com/r/${context.subredditName}/comments/${id}`;
}

/** Creates today's post once (idempotent), pins it, and leaves a recap of yesterday. */
export async function ensureDailyPost(env: Env, date = todayKey(env.now())): Promise<DailyPost> {
  const existing = await postFor(env.kv, date);
  if (existing) return { postId: existing, url: postUrl(existing), created: false };

  const puzzle = await loadPuzzle(env, date);
  const tier = TIERS[puzzle.weekday];
  const title = `MUTATOR #${padNumber(puzzle.number)}: ${mutationTitle(puzzle.mutations)} (${weekdayName(date)}, ${tier?.label.toLowerCase() ?? 'daily'})`;

  // A second check right before posting narrows the window for duplicates.
  const raced = await postFor(env.kv, date);
  if (raced) return { postId: raced, url: postUrl(raced), created: false };

  const post = await reddit.submitCustomPost({
    subredditName: context.subredditName,
    title,
    entry: 'default',
    postData: { date },
    textFallback: {
      text: `Today's MUTATOR puzzle: ${mutationTitle(puzzle.mutations)}. Par is ${puzzle.par} moves. Open this post on new Reddit or in the app to play.`
    }
  });
  await recordPost(env.kv, date, post.id);

  // Pin the new day, unpin yesterday's.
  try {
    const yesterday = await postFor(env.kv, addDays(date, -1));
    if (yesterday) await (await reddit.getPostById(yesterday as `t3_${string}`)).unsticky();
    await post.sticky(1);
  } catch (err) {
    console.log(`MUTATOR: could not pin post: ${String(err)}`);
  }

  try {
    const recap = await recapText(env, addDays(date, -1));
    if (recap) await reddit.submitComment({ id: post.id, text: recap });
  } catch (err) {
    console.log(`MUTATOR: could not post recap: ${String(err)}`);
  }

  return { postId: post.id, url: postUrl(post.id), created: true };
}
