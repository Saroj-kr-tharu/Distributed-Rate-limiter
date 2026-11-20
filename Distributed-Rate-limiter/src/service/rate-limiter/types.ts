export interface RateLimitResult {
  allowed: boolean;
  limit: number;
  remaining: number;
  resetAfterMs: number;
  retryAfterSec: number;
}
export interface IRateLimitEngine {
  readonly name: string;
  consume(key: string, cost?: number): Promise<RateLimitResult>;
}