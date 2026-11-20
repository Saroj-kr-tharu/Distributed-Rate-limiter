
import { Request, Response, NextFunction } from 'express';
import { AlgoSelect, AlgoType } from '../service/rate.limiter.algorithms';
import logger from '../config/logger.config';

interface CheckRateLimitDTO {
  namespace: string;     
  key: string;           
  algoType: AlgoType;    
  capacity: number;      
  rate: number;          
}

export const checkRateLimitCtrl = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { namespace, key, algoType, capacity, rate }: CheckRateLimitDTO = req.body;

    if (!namespace || !key || !algoType || !capacity || !rate) {
      res.status(400).json({ success: false, message: 'Missing required parameters' });
      return;
    }

    // Isolate by project namespace to avoid key collision between projects
    const compositeKey = `${namespace}:${key}`;
    const { getBucket } = AlgoSelect(algoType, capacity, rate);
    const bucket = getBucket(compositeKey);

    const allowed = await bucket.allowRequest();
    let remaining = capacity;

    if (bucket.getCurrentLoad) {
      const load = await bucket.getCurrentLoad();
      remaining = Math.max(0, capacity - load);
    }

    let retryAfterSec = 0;
    if (!allowed && bucket.getRetryAfterSeconds) {
      retryAfterSec = await bucket.getRetryAfterSeconds();
    }

     if (allowed) {
      logger.info('Rate-limit allowed', {
        namespace,
        clientKey: key,
        algo: algoType,
        remaining,
        limit: capacity,
      });
    } else {
      logger.warn('Rate-limit exceeded', {
        namespace,
        clientKey: key,
        algo: algoType,
        retryAfter: retryAfterSec,
        limit: capacity,
      });
    }

    res.status(200).json({
      allowed,
      limit: capacity,
      remaining,
      retryAfterSec,
      algo: algoType,
    });
  } catch (error) {
    next(error);
  }
};