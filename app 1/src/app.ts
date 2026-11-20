import express, { type Request, type Response, type NextFunction } from 'express';
import cors from 'cors';
import { useRateLimit } from './middlewares/remoteRateLimiter';

const app = express();

// Global Middlewares
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Health / Status Check Route
app.get('/', (_req: Request, res: Response) => {
  res.status(200).json({
    status: 'ok',
    service: 'app-1',
    timestamp: new Date().toISOString(),
  });
});
// ✅ Clean, zero namespace needed:
app.post(
  '/login',
  useRateLimit({
    algoType: 'sliding_window',
    capacity: 5,
    rate: 60,
    keyGenerator: (req) => `${req.ip}:${req.body?.email || ''}`,
  }),
  (req: Request, res: Response) => {
    res.status(200).json({ message: 'login passed successfully' });
  }
);

// ✅ Also clean on any other route:
app.get(
  '/items',
  useRateLimit({
    // algoType: 'token_bucket',
    // 'token_bucket' | 'leaky_bucket' | 'fixed_window_couter' | 'sliding_window';
    algoType: 'fixed_window_couter',
    capacity: 5,
    rate: 1,
  }),
  (req: Request, res: Response) => {
    res.status(200).json({ message: 'items passed successfully' });
  }
);

// 404 Not Found Handler
app.use((req: Request, res: Response) => {
  res.status(404).json({
    error: 'Not Found',
    path: req.originalUrl,
  });
});

// Global Error Handler
app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  console.error('Unhandled error:', err);
  res.status(500).json({
    error: 'Internal Server Error',
    message: err.message,
  });
});

export default app;
