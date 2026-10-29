// Where the middleware remembers single-use ids (puzzles, tokens) and counts requests.

/** Where single-use ids (puzzles, tokens) are remembered until they expire, and rates counted. */
export interface ReplayStore {
  /** Records `key` for `ttlSeconds`; resolves false when it was already there. */
  claim(key: string, ttlSeconds: number): Promise<boolean>;
  /**
   * Adds one to the counter `key` (created with `ttlSeconds` to live) and resolves its new value.
   * Optional for stores written before it existed: the middleware then falls back to claims.
   */
  incr?(key: string, ttlSeconds: number): Promise<number>;
}

/**
 * An in-memory store: fine for one process; use Redis or a database across instances. At most
 * `max` keys (default 50 000), the least recently written dropped first, so no request ever
 * scans the whole map.
 */
export function memoryStore(options: { max?: number } = {}): ReplayStore {
  const max = options.max ?? 50_000;
  const entries = new Map<string, { count: number; exp: number }>();
  const live = (key: string, now: number) => {
    const entry = entries.get(key);
    if (entry && entry.exp > now) return entry;
    if (entry) entries.delete(key);
    return undefined;
  };
  const write = (key: string, entry: { count: number; exp: number }) => {
    // Re-inserting moves the key to the end: the Map's first key is the least recently written.
    entries.delete(key);
    entries.set(key, entry);
    while (entries.size > max) {
      const oldest = entries.keys().next().value;
      if (oldest === undefined) break;
      entries.delete(oldest);
    }
  };
  return {
    async claim(key, ttl) {
      const now = Date.now();
      if (live(key, now)) return false;
      write(key, { count: 1, exp: now + ttl * 1000 });
      return true;
    },
    async incr(key, ttl) {
      const now = Date.now();
      const entry = live(key, now) ?? { count: 0, exp: now + ttl * 1000 };
      entry.count++;
      write(key, entry);
      return entry.count;
    },
  };
}

/**
 * A store over a key-value API with expiry (Cloudflare KV, Deno KV…). Best effort: KV is
 * eventually consistent, so two requests in the same second can both claim a key, and counts
 * are approximate. Use {@link redisStore} (or a Durable Object) when replays must be impossible.
 */
export function kvStore(kv: {
  get(key: string): Promise<string | null>;
  put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void>;
}): ReplayStore {
  return {
    async claim(key, ttl) {
      if (await kv.get(key)) return false;
      await kv.put(key, "1", { expirationTtl: Math.max(60, ttl) });
      return true;
    },
    async incr(key, ttl) {
      const count = (Number(await kv.get(key)) || 0) + 1;
      await kv.put(key, String(count), { expirationTtl: Math.max(60, ttl) });
      return count;
    },
  };
}

/** The Redis commands {@link redisStore} needs, as node-redis 4+ and Upstash name them. */
export interface RedisLike {
  set(
    key: string,
    value: string,
    options: { NX: true; EX: number },
  ): Promise<string | null | undefined>;
  incr(key: string): Promise<number>;
  expire(key: string, seconds: number): Promise<unknown>;
}

/** An atomic store over Redis: `SET NX EX` claims, `INCR` counts. Safe across instances. */
export function redisStore(redis: RedisLike): ReplayStore {
  return {
    async claim(key, ttl) {
      return (await redis.set(key, "1", { NX: true, EX: Math.max(1, Math.ceil(ttl)) })) === "OK";
    },
    async incr(key, ttl) {
      const count = await redis.incr(key);
      if (count === 1) await redis.expire(key, Math.max(1, Math.ceil(ttl)));
      return count;
    },
  };
}

/** Counts with `incr` when the store has it, else with claims (one per unit, up to `cap`). */
export async function countIn(
  store: ReplayStore,
  key: string,
  ttl: number,
  cap: number,
): Promise<number> {
  if (store.incr) return store.incr(key, ttl);
  for (let i = 0; i <= cap; i++) if (await store.claim(`${key}:${i}`, ttl)) return i + 1;
  return cap + 1;
}
