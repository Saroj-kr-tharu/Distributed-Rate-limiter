
import { Request, Response, NextFunction } from 'express';
import crypto from 'crypto';
import path from 'path';

interface RemoteLimiterConfig {
  
  algoType: 'token_bucket' | 'leaky_bucket' | 'fixed_window_couter' | 'sliding_window';
  capacity: number;
  rate: number;
  keyGenerator?: (req: Request) => string;
}

const RATE_LIMITER_HOST = process.env.RATE_LIMITER_SERVICE_URL || 'http://localhost:3000';

// 1. Generate a persistent, unique fingerprint for this specific project folder
const folderPath = process.cwd(); 
const folderName = path.basename(folderPath).replace(/[^a-zA-Z0-9-_]/g, '_');
const folderHash = crypto.createHash('md5').update(folderPath).digest('hex').slice(0, 4);

const pkgName = process.env.npm_package_name || 'app';

const defaultNamespace = `${pkgName}_${folderName}_${folderHash}`;

export function useRateLimit(config: RemoteLimiterConfig) {
  return async (req: Request, res: Response, next: NextFunction) => {
    
    const key = config.keyGenerator ? config.keyGenerator(req) : req.ip || '127.0.0.1';

    try {
      const response = await fetch(`${RATE_LIMITER_HOST}/api/v1/rate-limit/check`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          namespace: defaultNamespace,
          key,
          algoType: config.algoType,
          capacity: config.capacity,
          rate: config.rate,
        }),
      });

      // 1. If Rate Limiter service returned 404 HTML, 500, or 503, fail-open safely
      if (!response.ok) {
        console.warn(`Rate-limiter returned HTTP ${response.status}, failing open.`);
        return next();
      }

    
      const contentType = response.headers.get('content-type') || '';
      if (!contentType.includes('application/json')) {
        console.warn(`Rate-limiter returned non-JSON (${contentType}), failing open.`);
        return next();
      }

      const data = (await response.json()) as any;

      // 3. Set headers only if values exist
      if (data?.limit !== undefined) {
        res.setHeader('X-RateLimit-Limit', data.limit.toString());
      }
      if (data?.remaining !== undefined) {
        res.setHeader('X-RateLimit-Remaining', data.remaining.toString());
      }

      // 4. Handle throttled response
      if (data && data.allowed === false) {
        if (data.retryAfterSec) {
          res.setHeader('Retry-After', data.retryAfterSec.toString());
        }
        res.status(429).json({ message: 'Too many requests, please slow down.' });
        return;
      }

      next();
    } catch (err) {
      // 5. Fail-open if rate-limiter is completely offline
      console.warn('Rate-limiter service unreachable, allowing request.', err);
      next();
    }
  };
}