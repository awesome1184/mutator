import { redis } from '@devvit/web/server';
import type { Kv } from '../shared/service.ts';

/** Adapts Devvit Redis to the small storage interface the game service uses. */
export const redisKv: Kv = {
  get: (key) => redis.get(key),
  set: (key, value, opts) => (opts?.nx ? redis.set(key, value, { nx: true }) : redis.set(key, value)),
  del: (key) => redis.del(key),
  hGet: (key, field) => redis.hGet(key, field),
  hSet: (key, values) => redis.hSet(key, values),
  hSetNX: (key, field, value) => redis.hSetNX(key, field, value),
  hGetAll: async (key) => (await redis.hGetAll(key)) ?? {},
  hIncrBy: (key, field, by) => redis.hIncrBy(key, field, by),
  zAdd: (key, member, score) => redis.zAdd(key, { member, score }),
  zRem: (key, member) => redis.zRem(key, [member]),
  zRange: (key, start, stop, reverse) => redis.zRange(key, start, stop, reverse ? { by: 'rank', reverse: true } : { by: 'rank' }),
  zRank: (key, member) => redis.zRank(key, member),
  zScore: (key, member) => redis.zScore(key, member)
};
