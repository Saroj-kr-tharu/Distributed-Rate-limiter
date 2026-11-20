# Distributed Rate Limiter Service

A high-performance, production-ready distributed rate-limiting and authentication microservice built with **Node.js**, **TypeScript**, **Express 5**, **Redis**, and **PostgreSQL (via Prisma 7)**. Fully containerized with **Docker Compose** and instrumented with **Prometheus**.

---

## Table of Contents

- [Architecture & Purpose](#architecture--purpose)
- [API Specification](#api-specification)
  - [Rate Limiting Check API](#rate-limiting-check-api)
  - [Health & Observability APIs](#health--observability-apis)
  - [Authentication & User Management APIs](#authentication--user-management-apis)
- [Algorithm Implementations & Redis Data Models](#algorithm-implementations--redis-data-models)
  - [1. Token Bucket](#1-token-bucket)
  - [2. Leaky Bucket](#2-leaky-bucket)
  - [3. Fixed Window Counter](#3-fixed-window-counter)
  - [4. Sliding Window Log](#4-sliding-window-log)
- [Database & Prisma ORM](#database--prisma-orm)
- [Prometheus Metrics & Observability](#prometheus-metrics--observability)
- [Docker & Container Orchestration](#docker--container-orchestration)
- [Configuration Reference](#configuration-reference)
- [Production Deployment & Operational Best Practices](#production-deployment--operational-best-practices)

---

## Architecture & Purpose

This service operates as the **central state authority** for rate limiting across any number of upstream microservices. By centralizing rate checks around Redis, horizontal scaling of client applications does not compromise rate-limiting guarantees.

```
Incoming Request from Client Microservice
                  │
                  ▼
        POST /api/v1/rate-limit/check
                  │
        ┌─────────┴─────────┐
        ▼                   ▼
 Validate Payload    Resolve Algorithm Bucket
        │                   │
        └─────────┬─────────┘
                  │
                  ▼
         Execute Redis Lua Script
                  │
    ┌─────────────┴─────────────┐
    ▼                           ▼
[Allowed]                   [Throttled]
Return 200 OK               Return 200 OK
{ allowed: true,            { allowed: false,
  remaining: N,               remaining: 0,
  retryAfterSec: 0 }          retryAfterSec: T }
```

---

## API Specification

### Rate Limiting Check API

#### `POST /api/v1/rate-limit/check`
Used by client microservice middlewares to verify whether an incoming request is allowed.

- **Request Headers:** `Content-Type: application/json`
- **Request Body (JSON):**

| Field | Type | Required | Description | Example |
| :--- | :--- | :---: | :--- | :--- |
| `namespace` | `string` | **Yes** | Logical isolation boundary (e.g. service name or project ID) | `"app-1"` |
| `key` | `string` | **Yes** | Client or route identifier | `"login:192.168.1.5"` |
| `algoType` | `string` | **Yes** | Algorithm identifier (`token_bucket`, `leaky_bucket`, `fixed_window_couter`, `sliding_window`) | `"sliding_window"` |
| `capacity` | `number` | **Yes** | Maximum tokens / bucket limit / window limit | `5` |
| `rate` | `number` | **Yes** | Refill rate (tokens/s), leak rate (units/s), or window size (seconds) | `60` |

- **Success Response (`200 OK`):**
```json
{
  "allowed": true,
  "limit": 5,
  "remaining": 4,
  "retryAfterSec": 0,
  "algo": "sliding_window"
}
```

- **Throttled Response (`200 OK` with `allowed: false`):**
```json
{
  "allowed": false,
  "limit": 5,
  "remaining": 0,
  "retryAfterSec": 12,
  "algo": "sliding_window"
}
```

- **Validation Error (`400 Bad Request`):**
```json
{
  "success": false,
  "message": "Missing required parameters"
}
```

---

### Health & Observability APIs

#### `GET /api/v1/health`
Probes Redis connectivity. Used by Kubernetes/Docker liveness and readiness checks.
- **Success (`200 OK`):** `{"status": "healthy"}`
- **Failure (`503 Service Unavailable`):** `{"status": "unhealthy", "reason": "redis"}`

#### `GET /api/v1/metrics`
Exposes system and custom rate-limiter metrics formatted for Prometheus scraping.
- **Response Format:** `text/plain; version=0.0.4; charset=utf-8`

#### `GET /api/v1/ping`
Basic lightweight HTTP ping handler.
- **Response (`200 OK`):** `{"message": "Pong!"}`

---

### Authentication & User Management APIs

| Method | Path | Description | Auth Required | Headers |
| :--- | :--- | :--- | :---: | :--- |
| `POST` | `/api/v1/auth/register` | Register new user account | No | - |
| `POST` | `/api/v1/auth/login` | Authenticate credentials & return JWT | No | - |
| `GET` | `/api/v1/auth/token` | Verify access token validity | Yes | `x-access-token: <jwt>` |
| `PATCH` | `/api/v1/auth/update` | Update username / user profile | Yes | `x-access-token: <jwt>` |
| `POST` | `/api/v1/auth/changepassword` | Secure password update | Yes | `x-access-token: <jwt>` |

---

## Algorithm Implementations & Redis Data Models

### 1. Token Bucket
- **Redis Key Structure:** `ratelimit:token:<namespace>:<key>` (Redis Hash)
- **Fields:**
  - `tokens`: Current token count available in the bucket.
  - `last`: Unix epoch millisecond timestamp of last token consumption.
- **Refill Logic:**
  $$\text{refill} = \left(\frac{\text{now} - \text{last}}{1000}\right) \times \text{refillRate}$$
  $$\text{tokens} = \min(\text{capacity}, \text{tokens} + \text{refill})$$
- **Atomic Lua Script Execution:** Fetches hash, computes elapsed time, refills tokens up to capacity, subtracts 1 token if $\ge 1$, persists updated state, and sets TTL.

---

### 2. Leaky Bucket
- **Redis Key Structure:** `ratelimit:leaky:<namespace>:<key>` (Redis Hash)
- **Fields:**
  - `level`: Current volume of requests waiting to leak.
  - `last`: Unix epoch millisecond timestamp of last leak.
- **Drain Logic:**
  $$\text{leaked} = \left(\frac{\text{now} - \text{last}}{1000}\right) \times \text{leakRate}$$
  $$\text{level} = \max(0, \text{level} - \text{leaked})$$
- **Atomic Lua Script Execution:** Drains accumulated volume, checks if $\text{level} + 1 \le \text{capacity}$, increments level if allowed, and updates Redis hash.

---

### 3. Fixed Window Counter
- **Redis Key Structure:** `ratelimit:fixed:<namespace>:<key>` (Redis String)
- **Storage:** Integer counter.
- **Atomic Lua Script Execution:**
```lua
local current = redis.call('INCR', KEYS[1])
if current == 1 then
  redis.call('EXPIRE', KEYS[1], ARGV[1])
end
return current
```
- **Reset:** Key automatically expires via Redis TTL at the end of the window ($ARGV[1]$ in seconds).

---

### 4. Sliding Window Log
- **Redis Key Structure:** `ratelimit:sliding:<namespace>:<key>` (Redis Sorted Set `ZSET`)
- **Members & Scores:**
  - `score`: Unix epoch millisecond timestamp of request arrival.
  - `member`: Unique request ID `${timestamp}-${redis_time_seconds}${redis_time_micros}`.
- **Atomic Lua Script Execution:**
  1. `ZREMRANGEBYSCORE key 0 (now - windowMs)` (Prunes timestamps older than rolling window).
  2. `ZCARD key` (Counts remaining requests in the rolling window).
  3. If $\text{count} < \text{capacity}$: `ZADD` current request and `PEXPIRE` key for `windowMs`.
  4. Returns `1` (allowed) or `0` (throttled).

---

## Database & Prisma ORM

- **Driver:** PostgreSQL 16 with `@prisma/adapter-pg`.
- **Schema Location:** `prisma/schema.prisma`.
- **Database Client:** Auto-generated at `src/generated/prisma`.

### Common Database Commands

```bash
# Generate Prisma Client after schema changes
npx prisma generate

# Create and apply a new migration in development
npx prisma migrate dev --name <migration_name>

# Apply pending migrations in production / CI
npx prisma migrate deploy

# Open Prisma Studio web visualizer
npx prisma studio
```

---

## Prometheus Metrics & Observability

The service uses `@prometheus-io/client` to publish operational telemetry at `GET /api/v1/metrics`:

- `process_cpu_user_seconds_total`, `process_resident_memory_bytes` (Node runtime metrics)
- `nodejs_eventloop_lag_seconds` (Event loop latency tracking)
- `process_rate_limiter_active_buckets` (Gauge tracking active Redis rate-limiter keys)

### Prometheus Scrape Configuration (`prometheus.yml`):
```yaml
global:
  scrape_interval: 15s

scrape_configs:
  - job_name: "backend"
    metrics_path: /api/v1/metrics
    static_configs:
      - targets: ["backend_service:3000"]
```

---

## Docker & Container Orchestration

### `docker-compose.yml` Services

| Service Name | Image | Port | Description |
| :--- | :--- | :---: | :--- |
| `backend_service` | Multi-stage Node 24 Alpine | `3001:3000` | Rate limiter service instance |
| `redis_service` | `redis:alpine` | `6380:6379` | Redis cache with Append-Only File (`AOF`) persistence |
| `postgres_service` | `postgres:16-alpine` | `5432:5432` | Relational database with healthchecks |
| `prometheus_service`| `prom/prometheus:latest` | `9090:9090` | Time-series metrics engine |

### Build & Run
```bash
# Build and start all containers in detached mode
docker compose up --build -d

# View live container logs
docker compose logs -f backend_service

# Stop and tear down containers
docker compose down
```

---

## Configuration Reference

| Environment Variable | Default Value | Description |
| :--- | :--- | :--- |
| `PORT` | `3000` | HTTP port for the Express application |
| `NODE_ENV` | `development` | Runtime environment (`development`, `production`, `test`) |
| `DATABASE_URL` | - | PostgreSQL connection URI |
| `REDIS_HOST` | `localhost` | Redis server hostname or Docker service name |
| `REDIS_PORT` | `6379` | Redis server port |
| `PRIVATEJWT` | - | Secret key for signing Access Tokens (HS256) |
| `RefreshPRIVATEJWT` | - | Secret key for signing Refresh Tokens (HS256) |
| `SALT_ROUNDS` | `10` | Bcrypt salt generation rounds for password hashing |
| `RATE_LIMITER_REDIS_TTL_MS` | `300000` (5m) | Inactivity expiration for Redis hashes |
| `RATE_LIMITER_CLEANUP_MS` | `60000` (1m) | Gauge interval for active key count |

---

## Production Deployment & Operational Best Practices

1. **Redis Clustering / Sentinel:** Deploy Redis with replication and Sentinel or Redis Cluster for zero-downtime failover.
2. **Secrets Management:** Never commit `.env` to source control. Inject secrets via AWS Secrets Manager, HashiCorp Vault, or Kubernetes Secrets.
3. **Graceful Shutdown:** The service handles `SIGTERM` and `SIGINT`, shutting down the HTTP listener, closing active Redis connections via `redisClient.quit()`, and disconnecting Prisma connection pools before exit.
4. **Key Expiry Strategy:** Every Redis key generated by algorithms includes a strict TTL (`EXPIRE` / `PEXPIRE`) to prevent unbounded memory growth over time.
