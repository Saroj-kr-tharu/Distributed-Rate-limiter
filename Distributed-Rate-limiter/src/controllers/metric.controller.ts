import { NextFunction, Request, Response } from 'express';
import logger from '../config/logger.config';
import { register } from '../metrics/registry';
import redisClient from '../config/redis.config';

export const metricsCtrl = async (req: Request, res: Response, next: NextFunction) => {
  try {
      // console.log("heelo ")
      const metrics = await register.metrics();
      res.set('Content-Type', register.contentType);
      res.send(metrics);
    
  } catch (error) {
    next(error);
  }
};

export const healthCtrl = async (req: Request, res: Response, next: NextFunction) => {
  try {
    try {
      const pong = await redisClient.ping();
      if (pong !== 'PONG') throw new Error('Redis ping failed');
      res.json({ status: 'healthy' });
    } catch (err) { 
      logger.error('Health check failed', { error: (err as Error).message });
      res.status(503).json({ status: 'unhealthy', reason: 'redis' });
    }
  } catch (error) {
    next(error);
  }
};
