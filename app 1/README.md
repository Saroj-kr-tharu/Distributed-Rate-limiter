# App 1 — Client Microservice

A production-styled Node.js and Express microservice demonstrating client-tier distributed rate limiting via the centralized `Distributed-Rate-limiter` service.

---

## Table of Contents

- [Overview](#overview)
- [Architecture & Rate Limiting Integration](#architecture--rate-limiting-integration)
- [API Endpoints & Throttling Rules](#api-endpoints--throttling-rules)
- [Middleware Configuration (`useRateLimit`)](#middleware-configuration-useratelimit)
- [Fail-Open Resiliency & Failure Modes](#fail-open-resiliency--failure-modes)
- [Environment Configuration](#environment-configuration)
- [Development & Execution](#development--execution)
- [Testing & Verification](#testing--verification)

---

## Overview

`App 1` simulates an independent business service in a distributed microservice topology. Rather than managing in-memory rate-limiting counters (which fail when horizontally scaled across multiple instances), `App 1` delegates quota validation to the centralized `Distributed-Rate-limiter` tier.

- **Default Port:** `4000`
- **Language / Runtime:** TypeScript / Node.js 22+
- **Bundler:** `tsup`

---

## Architecture & Rate Limiting Integration

```
Client Request
      │
      ▼
┌──────────────┐
│  App 1 (4000)│
└──────┬───────┘
       │
       ▼
┌──────────────────────────────┐
│  useRateLimit Middleware     │
│  1. Extract Client Key       │
│  2. POST /rate-limit/check   │──────▶ Distributed-Rate-limiter (3000)
│  3. Inspect Result           │◀────── [allowed, remaining, retryAfterSec]
└──────┬───────────────────────┘
       │
       ├───────────────────────────────┐
       ▼ [Allowed]                     ▼ [Throttled]
  Execute Route Handler           Return HTTP 429
  Set X-RateLimit-* Headers       Set Retry-After Header
```

---

## API Endpoints & Throttling Rules

| Method | Endpoint | Algorithm | Limit | Window / Rate | Key Strategy | Description |
| :--- | :--- | :--- | :---: | :---: | :--- | :--- |
| `GET` | `/` | *None* | $\infty$ | - | - | Health / service status probe |
| `POST` | `/login` | `sliding_window` | 5 | 60 seconds | `${req.ip}:${req.body.email}` | Authentication brute-force defense |
| `GET` | `/items` | `fixed_window_couter` | 5 | 1 second | `${req.ip}` | High-volume items listing API |

---

## Middleware Configuration (`useRateLimit`)

The `remoteRateLimiter` middleware allows declarative rate-limiting policies per route:

```typescript
import { useRateLimit } from './middlewares/remoteRateLimiter';

// Example: Strict sliding-window rate limit on login
app.post(
  '/login',
  useRateLimit({
    algoType: 'sliding_window',
    capacity: 5,        // Maximum 5 attempts
    rate: 60,           // Rolling 60-second window
    keyGenerator: (req) => `${req.ip}:${req.body?.email || ''}`,
  }),
  (req, res) => {
    res.status(200).json({ message: 'login passed successfully' });
  }
);
```

### Standard Response Headers Injected
On every rate-limited response, the middleware injects standard IETF headers:
- `X-RateLimit-Limit`: Maximum requests allowed for the configured window.
- `X-RateLimit-Remaining`: Remaining request quota.
- `Retry-After`: (On `429` status) Seconds to wait before retrying.

---

## Fail-Open Resiliency & Failure Modes

In high-availability microservice systems, rate-limiting failure must never cause cascading outages for core business operations:

1. **Rate Limiter Service Offline:** If the rate limiter service is unreachable (`ECONNREFUSED`, network timeout), the middleware catches the error, logs a warning, and allows the request to pass (`fail-open`).
2. **Non-200 / 5xx Status:** If the rate limiter returns a 500 error or HTML error page, the middleware falls back to passing the request through.
3. **Response Timeout Guard:** Client requests are not blocked indefinitely if the rate-limiting tier experiences latency.

---

## Environment Configuration

Configure variables in `.env` (refer to `.env.example`):

```env
PORT=4000
RATE_LIMITER_SERVICE_URL="http://localhost:3000"
```

| Variable | Default | Description |
| :--- | :--- | :--- |
| `PORT` | `4000` | HTTP port for App 1 |
| `RATE_LIMITER_SERVICE_URL` | `http://localhost:3000` | Base URL of the central rate limiter service |

---

## Development & Execution

```bash
# 1. Install dependencies
npm install

# 2. Run in development watch mode
npm run dev

# 3. Build for production (outputs to dist/server.js)
npm run build

# 4. Start production build
npm start
```

---

## Testing & Verification

### Test Sliding Window Login Protection
Send 6 rapid requests to `/login`:

```bash
for i in {1..6}; do
  curl -i -X POST http://localhost:4000/login \
    -H "Content-Type: application/json" \
    -d '{"email":"engineer@company.com"}'
done
```

**Expected Result:**
- Requests 1–5: `200 OK`
- Request 6: `429 Too Many Requests` (`{"message":"Too many requests, please slow down."}`)
