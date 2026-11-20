
import client from '@prometheus-io/client';


export const register = new client.Registry();

client.collectDefaultMetrics({ register });


export const activeBucketsGauge = new client.Gauge({
  name: 'process_rate_limiter_active_buckets',
  help: 'Number of currently active rate‑limiter buckets (Redis keys)',
  registers: [register],
});