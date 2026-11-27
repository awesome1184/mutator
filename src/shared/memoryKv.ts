// In-memory implementation of the service storage interface. Used by tests
// and by the standalone web build (persisted to localStorage there).

import type { Kv } from './service.ts';

type Data = {
  str: Record<string, string>;
  hash: Record<string, Record<string, string>>;
  zset: Record<string, Record<string, number>>;
};

export function createMemoryKv(initial?: Data, onChange?: (data: Data) => void): Kv & { data: Data } {
  const data: Data = initial ?? { str: {}, hash: {}, zset: {} };
  const changed = (): void => onChange?.(data);
  const hash = (k: string): Record<string, string> => (data.hash[k] ??= {});
  const zset = (k: string): Record<string, number> => (data.zset[k] ??= {});
  const sorted = (k: string): { member: string; score: number }[] =>
    Object.entries(data.zset[k] ?? {})
      .map(([member, score]) => ({ member, score }))
      .sort((a, b) => a.score - b.score || (a.member < b.member ? -1 : a.member > b.member ? 1 : 0));

  return {
    data,
    async get(key) {
      return data.str[key];
    },
    async set(key, value, opts) {
      if (opts?.nx && key in data.str) return null;
      data.str[key] = value;
      changed();
      return 'OK';
    },
    async hGet(key, field) {
      return data.hash[key]?.[field];
    },
    async hSet(key, values) {
      Object.assign(hash(key), values);
      changed();
      return Object.keys(values).length;
    },
    async hSetNX(key, field, value) {
      const h = hash(key);
      if (field in h) return 0;
      h[field] = value;
      changed();
      return 1;
    },
    async hGetAll(key) {
      return { ...(data.hash[key] ?? {}) };
    },
    async hIncrBy(key, field, by) {
      const h = hash(key);
      const v = Number(h[field] ?? 0) + by;
      h[field] = String(v);
      changed();
      return v;
    },
    async zAdd(key, member, score) {
      zset(key)[member] = score;
      changed();
      return 1;
    },
    async zRem(key, member) {
      delete zset(key)[member];
      changed();
      return 1;
    },
    async zRange(key, start, stop, reverse) {
      const all = sorted(key);
      if (reverse) all.reverse();
      const end = stop < 0 ? all.length + stop : stop;
      return all.slice(start, end + 1);
    },
    async zRank(key, member) {
      const i = sorted(key).findIndex((e) => e.member === member);
      return i < 0 ? undefined : i;
    },
    async zScore(key, member) {
      return data.zset[key]?.[member];
    }
  };
}
