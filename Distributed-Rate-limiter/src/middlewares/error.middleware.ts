import { NextFunction, Request, Response } from 'express';
import logger from '../config/logger.config';


export const appErrorHandler = (
  err: any,
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  logger.error('Request error', {
    message: err.message,
    stack: err.stack,
    path: req.path,
  });
  const statusCode = typeof err.statusCode === 'number' ? err.statusCode : 500;
  const isProduction = process.env.NODE_ENV === 'production';
  res.status(statusCode).json({
    success: false,
    message: statusCode === 500 && isProduction ? 'Internal Server Error' : err.message,
    // Never leak raw internal error objects or stack traces to client
    ...(isProduction ? {} : { stack: err.stack }),
  });
};

export const genericErrorHandler = (
  err: Error,
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  logger.info(err);

  res.status(500).json({
    success: false,
    message: 'Internal Server Error',
    error: err.message
  });
};
