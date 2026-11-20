import Redis from 'ioredis';
import logger from './logger.config';

const redisClient = new Redis({
  host: process.env.REDIS_HOST || 'redis_service',
  port: Number(process.env.REDIS_PORT) || 6379,
});

redisClient.on('connect', () => logger.info('Redis connected'));

redisClient.on('error', (err) => {
  logger.error(`Redis error: ${err.message || err.stack || JSON.stringify(err)}`, {
    stack: err.stack,
    code: (err as any).code,
  });
});
export default redisClient;
