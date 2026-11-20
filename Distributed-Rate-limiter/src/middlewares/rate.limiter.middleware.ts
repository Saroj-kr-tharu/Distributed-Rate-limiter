// src/middlewares/rate.limiter.middleware.ts
import logger from '../config/logger.config';
import redisClient from '../config/redis.config';
import { AlgoSelect, AlgoType } from '../service/rate.limiter.algorithms';
import { NextFunction, Response, Request } from 'express';

export function createRateLimiter(
  algoType: AlgoType,
  capacity: number,
  rate: number,
) {
  const { getBucket } = AlgoSelect(algoType, capacity, rate);
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {

    if (
      req.path === '/health' ||
      req.path === '/metrics' ||
      req.path.endsWith('/health') ||
      req.path.endsWith('/metrics') 
      
    ) {
      return next();
    }
    // Fast in-memory check (0ms overhead, avoids an extra network ping per request)
    if (redisClient.status !== 'ready') {
      logger.error('Rate-limiter rejected request – Redis unreachable', {
        ip: req.ip,
        path: req.path,
        redisStatus: redisClient.status,
      });
      res.status(503).json({ message: 'Rate-limiter unavailable (Redis down)' });
      return;
    }

    const key = req.ip ?? 'unknown';
    const bucket = getBucket(key);

    try {
      const allowed = await bucket.allowRequest();

      // Standard Rate-Limit response headers
      res.setHeader('X-RateLimit-Limit', capacity.toString());
      res.setHeader('X-RateLimit-Algo', algoType);

      if (bucket.getCurrentLoad) {
        const load = await bucket.getCurrentLoad();
        const remaining = Math.max(0, capacity - load);
        res.setHeader('X-RateLimit-Remaining', remaining.toString());
      }

      if (allowed) {
        logger.info('Rate-limit allowed', {
          ip: req.ip,
          path: req.path,
          algo: algoType,
        });
        next();
        return;
      } else {
        logger.warn('Rate-limit exceeded', {
          ip: req.ip,
          path: req.path,
          algo: algoType,
        });

        if (bucket.getRetryAfterSeconds) {
          const retryAfter = await bucket.getRetryAfterSeconds();
          res.setHeader('Retry-After', retryAfter.toString());
        }

        res
          .status(429)
          .json({ message: 'Too many requests, please try again later.' });
        return;
      }
    } catch (e) {
      logger.error('Rate-limit middleware error', {
        ip: req.ip,
        path: req.path,
        error: (e as Error).message,
        stack: (e as Error).stack,
      });
      res.status(503).json({ message: 'Rate-limiter error' });
      return;
    }
  };
}