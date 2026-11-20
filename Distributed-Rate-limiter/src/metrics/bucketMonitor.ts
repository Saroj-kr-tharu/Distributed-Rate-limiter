
import redisClient from '../config/redis.config';
import { activeBucketsGauge } from './registry';

const monitorIntervalMs = Number(process.env.RATE_LIMITER_CLEANUP_MS) || 60_000;

async function countKeysMatching(pattern: string): Promise<number> {
  let count = 0;
  return new Promise((resolve) => {
    const stream = redisClient.scanStream({ match: pattern, count: 100 });
    stream.on('data', (keys: string[]) => {
      count += keys.length;
    });
    stream.on('end', () => resolve(count));
    stream.on('error', () => resolve(count)); // Fail-safe
  });
}

export function startBucketMonitor(): () => void {
  const timer = setInterval(async () => {
    try {
      const [tokenCount, leakyCount, fixedCount, slidingCount] = await Promise.all([
        countKeysMatching('ratelimit:token:*'),
        countKeysMatching('ratelimit:leaky:*'),
        countKeysMatching('ratelimit:fixed:*'),
        countKeysMatching('ratelimit:sliding:*'),
      ]);

      activeBucketsGauge.set(tokenCount + leakyCount + fixedCount + slidingCount);
    } catch {
      // Swallow error to prevent monitor crashes
    }
  }, monitorIntervalMs).unref();

  return () => clearInterval(timer);
}