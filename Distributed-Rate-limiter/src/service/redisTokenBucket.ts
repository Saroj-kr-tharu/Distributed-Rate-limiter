import redisClient from '../config/redis.config';
import logger from '../config/logger.config';
import { rateLimiterConfig } from '../config/rateLimiter.config';   

const TOKEN_BUCKET_SCRIPT = `
  local key = KEYS[1]
  local capacity = tonumber(ARGV[1])
  local refillRate = tonumber(ARGV[2])   -- tokens per second
  local now = tonumber(ARGV[3])

  local bucket = redis.call('HMGET', key, 'tokens', 'last')
  local tokens = tonumber(bucket[1]) or capacity
  local last = tonumber(bucket[2]) or now

   local elapsed = now - last
  local refill = (elapsed / 1000) * refillRate
  tokens = math.min(capacity, tokens + refill)

  local allowed = tokens >= 1
  if allowed then
    tokens = tokens - 1
  end

  redis.call('HMSET', key,
    'tokens', tokens,
    'last', now
  )
  redis.call('PEXPIRE', key, ${rateLimiterConfig.ttlMs})
  return allowed and 1 or 0
`;

export async function redisTokenBucketAllow(
  key: string,
  capacity: number,
  refillRate: number,
): Promise<boolean> {
  const now = Date.now();

  
  logger.debug('Token‑bucket check started', {
    bucketKey: key,
    capacity,
    refillRate,
    timestamp: now,
  });

  try {
    const result = await redisClient.eval(
      TOKEN_BUCKET_SCRIPT,
      1,
      `ratelimit:token:${key}`,
      capacity.toString(),
      refillRate.toString(),
      now.toString(),
    );

    const allowed = result === 1;

    
    if (allowed) {
      logger.info('Token-bucket allowed request', {
        bucketKey: key,
        remaining: capacity - 1,   
        timestamp: now,
      });
    } else {
      logger.warn('Token-bucket throttled request', {
        bucketKey: key,
        capacity,
        refillRate,
        timestamp: now,
      });
    }

    return allowed;
  } catch (err) {
    
    logger.error('Token-bucket Redis error', {
      bucketKey: key,
      error: (err as Error).message,
      stack: (err as Error).stack,
    });
    
    return false;
  }
}