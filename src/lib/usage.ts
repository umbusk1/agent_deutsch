import { Redis } from "@upstash/redis";

const WEEK_TTL_SECONDS = 9 * 24 * 60 * 60;

let redis: Redis | null = null;

function getRedis(): Redis {
  if (!redis) {
    redis = Redis.fromEnv();
  }
  return redis;
}

function currentWeekKey(username: string): string {
  const now = new Date();
  const day = now.getUTCDay();
  const diffToMonday = (day + 6) % 7;
  const monday = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - diffToMonday)
  );
  const mondayStr = monday.toISOString().slice(0, 10);
  return `agente-deutsch:usage:${username}:${mondayStr}`;
}

export async function peekUsage(username: string): Promise<number> {
  const value = await getRedis().get<number>(currentWeekKey(username));
  return value ?? 0;
}

export async function incrementUsage(username: string): Promise<number> {
  const key = currentWeekKey(username);
  const count = await getRedis().incr(key);
  if (count === 1) {
    await getRedis().expire(key, WEEK_TTL_SECONDS);
  }
  return count;
}
