import { context, reddit, redis } from '@devvit/web/server';
import type { Env } from '../shared/service.ts';
import { redisKv } from './kv.ts';

const AVATAR_TTL_MS = 12 * 60 * 60 * 1000;

async function lookupAvatars(names: string[]): Promise<Record<string, string | null>> {
  const out: Record<string, string | null> = {};
  await Promise.all(
    names.map(async (name) => {
      const key = `avatar:${name}`;
      const cached = await redis.get(key);
      if (cached !== undefined && cached !== null) {
        out[name] = cached || null;
        return;
      }
      let url: string | undefined;
      try {
        url = await reddit.getSnoovatarUrl(name);
      } catch {
        url = undefined;
      }
      await redis.set(key, url ?? '', { expiration: new Date(Date.now() + AVATAR_TTL_MS) });
      out[name] = url ?? null;
    })
  );
  return out;
}

export async function currentEnv(): Promise<Env> {
  let name = context.username ?? null;
  if (!name && context.userId) {
    try {
      name = (await reddit.getCurrentUsername()) ?? null;
    } catch {
      name = null;
    }
  }
  return {
    kv: redisKv,
    now: () => Date.now(),
    user: { name, avatar: context.snoovatar ?? null },
    avatars: lookupAvatars
  };
}

/** Env for jobs and triggers that do not act for a particular player. */
export function systemEnv(): Env {
  return { kv: redisKv, now: () => Date.now(), user: { name: null, avatar: null }, avatars: lookupAvatars };
}
