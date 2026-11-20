import redisClient from "../config/redis.config";
import { redisLeakyBucketAllow } from "./redisLeakyBucket";
import { redisTokenBucketAllow } from "./redisTokenBucket";

export interface IRateLimiter {
  allowRequest(): boolean | Promise<boolean>;
  getCurrentLoad?(): number | Promise<number>;
  getRetryAfterSeconds?(): number | Promise<number>;
}

export type AlgoType =
  | 'token_bucket' 
  | 'leaky_bucket'
  | 'fixed_window_couter'
  | 'sliding_window';


export class RedisFixedWindowAlgo implements IRateLimiter {
  private key: string;
  private windowSizeSec: number;
  private maxRequests: number;

  constructor(key: string, windowSizeSec: number, maxRequests: number) {
    this.key = `ratelimit:fixed:${key}`;
    this.windowSizeSec = windowSizeSec;
    this.maxRequests = maxRequests;
  }

   public async allowRequest(): Promise<boolean> {
      const FIXED_WINDOW_SCRIPT = `
        local current = redis.call('INCR', KEYS[1])
        if current == 1 then
          redis.call('EXPIRE', KEYS[1], ARGV[1])
        end
        return current
      `;
      const count = (await redisClient.eval(
        FIXED_WINDOW_SCRIPT,
        1,
        this.key,
        this.windowSizeSec.toString(),
      )) as number;
      return count <= this.maxRequests;
    }

  public async getRetryAfterSeconds(): Promise<number> {
    const ttl = await redisClient.ttl(this.key);
    return ttl > 0 ? ttl : this.windowSizeSec;
  }

  public async getCurrentLoad(): Promise<number> {
    const val = await redisClient.get(this.key);
    return val ? parseInt(val, 10) : 0;
  }
}

const SLIDING_WINDOW_SCRIPT = `
local key = KEYS[1]
local now = tonumber(ARGV[1])
local windowMs = tonumber(ARGV[2])
local maxRequests = tonumber(ARGV[3])

local cutoff = now - windowMs

redis.call("ZREMRANGEBYSCORE", key, 0, cutoff)
local count = redis.call("ZCARD", key)

if count < maxRequests then
    local time = redis.call("TIME")
    local member = now .. "-" .. time[1] .. time[2]
    redis.call("ZADD", key, now, member)
    redis.call("PEXPIRE", key, windowMs)
    return 1
else
    return 0
end
`;

export class RedisSlidingWindowAlgo implements IRateLimiter {
  private key: string;
  private windowMs: number;
  private maxRequests: number;

  constructor(key: string, windowMs: number, maxRequests: number) {
    this.key = `ratelimit:sliding:${key}`;
    this.windowMs = windowMs;
    this.maxRequests = maxRequests;
  }

  public async allowRequest(): Promise<boolean> {
    const now = Date.now();
    const result = (await redisClient.eval(
      SLIDING_WINDOW_SCRIPT,
      1,
      this.key,
      now.toString(),
      this.windowMs.toString(),
      this.maxRequests.toString(),
    )) as number;

    return result === 1;
  }

  public async getCurrentLoad(): Promise<number> {
    const now = Date.now();
    const cutoff = now - this.windowMs;
    await redisClient.zremrangebyscore(this.key, 0, cutoff);
    return redisClient.zcard(this.key);
  }
  
}


function createBucket(
  algoType: AlgoType,
  capacity: number,
  rate: number,
  key: string,
): IRateLimiter {
  switch (algoType) {
    case 'token_bucket':
      return {
        async allowRequest() {
          return redisTokenBucketAllow(key, capacity, rate);
        },
        async getCurrentLoad() {
          const data = await redisClient.hgetall(`ratelimit:token:${key}`);
          return data.tokens ? Math.max(0, capacity - Number(data.tokens)) : 0;
        },
      };

    case 'leaky_bucket':
      return {
        async allowRequest() {
          return redisLeakyBucketAllow(key, capacity, rate);
        },
        async getCurrentLoad() {
          const data = await redisClient.hgetall(`ratelimit:leaky:${key}`);
          return data.level ? Number(data.level) : 0;
        },
      };

    case 'fixed_window_couter':
      return new RedisFixedWindowAlgo(key, rate, capacity);

    case 'sliding_window':
      return new RedisSlidingWindowAlgo(key, rate * 1000, capacity);

    default:
      throw new Error(`Unknown algorithm type: ${algoType}`);
  }
}

export function AlgoSelect(
  algoType: AlgoType,
  capacity: number,
  rate: number,
) {
 
  const getBucket = (key: string): IRateLimiter => {
    return createBucket(algoType, capacity, rate, key);
  };
  return { getBucket };
}