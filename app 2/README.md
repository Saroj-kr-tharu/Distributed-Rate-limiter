# App 2 — Client Microservice

A production-styled Node.js and Express microservice demonstrating multi-tenant / multi-service distributed rate limiting via the centralized `Distributed-Rate-limiter` service.

---

## Table of Contents

- [Overview](#overview)
- [Architecture & Multi-Service Isolation](#architecture--multi-service-isolation)
- [API Endpoints & Throttling Rules](#api-endpoints--throttling-rules)
- [Middleware Configuration (`useRateLimit`)](#middleware-configuration-useratelimit)
- [Multi-Service Isolation Verification](#multi-service-isolation-verification)
- [Fail-Open Resiliency & Failure Modes](#fail-open-resiliency--failure-modes)
- [Environment Configuration](#environment-configuration)
- [Development & Execution](#development--execution)
- [Testing & Verification](#testing--verification)

---

## Overview

`App 2` operates alongside `App 1` to demonstrate how multiple distinct microservices share the same Redis-backed rate-limiting infrastructure while maintaining logical isolation. 

- **Default Port:** `5000`
- **Language / Runtime:** TypeScript / Node.js 22+
- **Bundler:** `tsup`

---

## Architecture & Multi-Service Isolation

```
       ┌────────────────────────┐      ┌────────────────────────┐
       │      App 1 (4000)      │      │      App 2 (5000)      │
       │ Namespace: app_1_...   │      │ Namespace: app_2_...   │
       └───────────┬────────────┘      └───────────┬────────────┘
                   │                               │
POST /rate-limit/check { namespace: "app_1" }      │ POST /rate-limit/check { namespace: "app_2" }
                   │                               │
                   └───────────────┬───────────────┘
                                   ▼
                   ┌────────────────────────────────┐
                   │ Distributed-Rate-limiter (3000)│
                   └───────────────┬────────────────┘
                                   ▼
                   ┌────────────────────────────────┐
                   │          Redis Cluster         │
                   │  Keys:                         │
                   │  ratelimit:sliding:app_1:...   │
                   │  ratelimit:sliding:app_2:...   │
                   └────────────────────────────────┘
```

Because requests include their service `namespace`, requests saturating App 1's quotas do not degrade or throttle legitimate traffic targeting App 2.

---

## API Endpoints & Throttling Rules

| Method | Endpoint | Algorithm | Limit | Window / Rate | Key Strategy | Description |
| :--- | :--- | :--- | :---: | :---: | :--- | :--- |
| `GET` | `/` | *None* | $\infty$ | - | - | Health / service status probe |
| `POST` | `/login` | `sliding_window` | 5 | 60 seconds | `${req.ip}:${req.body.email}` | Authentication brute-force defense |
| `GET` | `/items` | `sliding_window` | 5 | 1 second | `${req.ip}` | High-volume items listing API (Sliding Window Log) |

---

## Middleware Configuration (`useRateLimit`)

```typescript
import { useRateLimit } from './middlewares/remoteRateLimiter';

// Route: Sliding window on items
app.get(
  '/items',
  useRateLimit({
    algoType: 'sliding_window',
    capacity: 5,        // 5 requests
    rate: 1,            // Rolling 1-second window
  }),
  (_req, res) => {
    res.status(200).json({ message: 'items passed successfully' });
  }
);
```

### Standard Response Headers Injected
- `X-RateLimit-Limit`: Configured capacity for the route.
- `X-RateLimit-Remaining`: Remaining request quota.
- `Retry-After`: (On `429` status) Seconds until quota resets.

---

## Multi-Service Isolation Verification

To prove that App 1 and App 2 maintain isolated quotas despite sharing the same Redis instance:

1. **Exhaust App 1 quota:**
   ```bash
   for i in {1..6}; do curl -s -o /dev/null -w "App 1: %{http_code}\n" http://localhost:4000/items; done
   # Expect: 200, 200, 200, 200, 200, 429
   ```

2. **Immediately query App 2:**
   ```bash
   curl -i http://localhost:5000/items
   # Expect: 200 OK (App 2 quota remains intact)
   ```

---

## Fail-Open Resiliency & Failure Modes

1. **Rate Limiter Outage:** If `Distributed-Rate-limiter` crashes or becomes unreachable, the client middleware fails open, allowing application traffic to proceed without interruption.
2. **Graceful Fallback:** Catches non-JSON error payloads (such as HTML gateway errors) and invokes `next()` cleanly.

---

## Environment Configuration

Configure variables in `.env` (refer to `.env.example`):

```env
PORT=5000
RATE_LIMITER_SERVICE_URL="http://localhost:3000"
```

| Variable | Default | Description |
| :--- | :--- | :--- |
| `PORT` | `5000` | HTTP port for App 2 |
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

### Test Sliding Window Throttling on Items (`GET /items`)
```bash
for i in {1..7}; do
  curl -i -s http://localhost:5000/items | grep -E "HTTP/|X-RateLimit|message"
done
```

**Expected Result:**
- Requests 1–5 succeed with `200 OK`.
- Requests 6–7 return `429 Too Many Requests`.
