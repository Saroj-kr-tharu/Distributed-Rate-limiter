import { AlgoType } from "../service/rate.limiter.algorithms";

export const rateLimiterConfig = {
  ttlMs: Number(process.env.RATE_LIMITER_REDIS_TTL_MS) || 300_000,
  defaultAlgo: (process.env.RATE_LIMITER_ALGO as AlgoType) ?? 'sliding_window',
};