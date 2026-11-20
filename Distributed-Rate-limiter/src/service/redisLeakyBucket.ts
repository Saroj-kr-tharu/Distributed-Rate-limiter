
import redisClient from '../config/redis.config';
import { rateLimiterConfig } from '../config/rateLimiter.config';



const LEAKY_BUCKET_SCRIPT = `
  local key = KEYS[1]
  local capacity = tonumber(ARGV[1])
  local leakRate = tonumber(ARGV[2])   -- units per second
  local now = tonumber(ARGV[3])

  local bucket = redis.call('HMGET', key, 'level', 'last')
  local level = tonumber(bucket[1]) or 0
  local last = tonumber(bucket[2]) or now

  -- leak
  local elapsed = now - last
  local leaked = (elapsed / 1000) * leakRate
  level = math.max(0, level - leaked)

  local allowed = level < capacity
  if allowed then
    level = level + 1
  end

  redis.call('HMSET', key,
    'level', level,
    'last', now
  )
  redis.call('PEXPIRE', key, ${rateLimiterConfig.ttlMs})
  return allowed and 1 or 0
`;


export async function redisLeakyBucketAllow(
  key: string,
  capacity: number,
  leakRate: number,
): Promise<boolean> {
  const now = Date.now();
  

  try {
    const result = await redisClient.eval(
      LEAKY_BUCKET_SCRIPT,
      1,
      `ratelimit:leaky:${key}`,
      capacity.toString(),
      leakRate.toString(),
      now.toString(),
    );

    const allowed = result === 1;
    return allowed;
  } catch (err) {
    
    return false;
  }
}