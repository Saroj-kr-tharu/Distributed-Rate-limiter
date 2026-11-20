import { Request, Response, NextFunction } from 'express';
import { IRateLimitEngine } from '../service/rate-limiter/types';
export interface RateLimiterOptions {
  engine: IRateLimitEngine;
  keyGenerator?: (req: Request) => string;
  cost?: number | ((req: Request) => number);
  failOpen?: boolean; // If Redis fails, allow request through (High Availability)
}
export function routeRateLimit(options: RateLimiterOptions) {
  const {
    engine,
    keyGenerator = (req) => req.ip || 'anonymous',
    cost = 1,
    failOpen = true,
  } = options;
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const key = keyGenerator(req);
    const requestCost = typeof cost === 'function' ? cost(req) : cost;
    try {
      const result = await engine.consume(key, requestCost);
      // Set Standard IETF & Custom Headers
      res.setHeader('X-RateLimit-Limit', result.limit.toString());
      res.setHeader('X-RateLimit-Remaining', result.remaining.toString());
      res.setHeader('X-RateLimit-Reset', Math.ceil(result.resetAfterMs / 1000).toString());
      res.setHeader('X-RateLimit-Algo', engine.name);
      if (!result.allowed) {
        res.setHeader('Retry-After', result.retryAfterSec.toString());
        res.status(429).json({
          success: false,
          message: 'Too many requests, please try again later.',
          retryAfterSeconds: result.retryAfterSec,
        });
        return;
      }
      next();
    } catch (error) {
      if (failOpen) {
        // High-availability fallback: log and let request pass
        next();
      } else {
        res.status(503).json({ message: 'Rate limiter unavailable' });
      }
    }
  };
}