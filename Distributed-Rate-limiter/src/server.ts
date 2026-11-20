
import express from 'express';
import { serverConfig } from './config';
import logger from './config/logger.config';
import redisClient from './config/redis.config';
import { prismaClient } from './config/db.config';


import { appErrorHandler, genericErrorHandler } from './middlewares/error.middleware';
// import { createRateLimiter } from './middlewares/rate.limiter.middleware';


import v1Router from './routers/v1/index.router';

import { startBucketMonitor } from './metrics/bucketMonitor';



const app = express();
app.set('trust proxy', 1);
app.use(express.json());


// const globalRateLimiter = createRateLimiter(
//  'fixed_window_couter',
//   5, // capacity 
//   10, // rate 
// );
// app.use(globalRateLimiter); 

// API routes
app.use('/api/v1', v1Router);

// Register Error Handlers (must be AFTER routes)
app.use(appErrorHandler);
app.use(genericErrorHandler);

const stopBucketMonitor = startBucketMonitor();

const httpServer = app.listen(serverConfig.PORT, () => {
  logger.info(`Server is running on http://localhost:${serverConfig.PORT}`);
  logger.info('Press Ctrl+C to stop the server.');
});

async function gracefulShutdown(signal: NodeJS.Signals) {
  logger.info(`Received ${signal} – beginning graceful shutdown`);

  // 1. Stop bucket monitor
  try {
    stopBucketMonitor();
    logger.info('Bucket monitor stopped');
  } catch (e) {
    logger.warn('Error stopping bucket monitor', {
      error: (e as Error).message,
    });
  }

  // 2. Close HTTP server
  try {
    await new Promise<void>((resolve, reject) => {
      httpServer.close((err) => (err ? reject(err) : resolve()));
    });
    logger.info('HTTP server closed');
  } catch (e) {
    logger.error('Error closing HTTP server', {
      error: (e as Error).message,
    });
  }

  // 3. Disconnect Redis
  try {
    await redisClient.quit();
    logger.info('Redis client disconnected');
  } catch (e) {
    logger.error('Error disconnecting Redis', {
      error: (e as Error).message,
    });
  }


   // 4. Disconnect Prisma Database Connection Pool
  try {
    await prismaClient.$disconnect();
    logger.info('Database client disconnected');
  } catch (e) {
    logger.error('Error disconnecting Database', {
      error: (e as Error).message,
    });
  }

  logger.info('Graceful shutdown complete – exiting');
  process.exit(0);
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

process.on('unhandledRejection', (reason) => {
  logger.error('Unhandled promise rejection', { reason });
});

process.on('uncaughtException', (err) => {
  logger.error('Uncaught exception', {
    error: err.message,
    stack: err.stack,
  });
});