export interface IRateLimitStore {
  evalScript<T>(script: string, keys: string[], args: (string | number)[]): Promise<T>;
  status(): 'ready' | 'connecting' | 'close';
}

export function formatRateLimitKey(prefix: string, identifier: string): string {
  return `ratelimit:${prefix}:${identifier}`;
}