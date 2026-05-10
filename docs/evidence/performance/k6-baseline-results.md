# k6 Performance Baseline Results

Status: PARTIAL_PRODUCTION_LIKE_RUN

Run date: 2026-05-10
Target: `https://cjw.52nbc.com`

Note: this target has production Nginx rate limits enabled
(`api_general` = 300 requests/minute per source IP, burst 50). Public API
readiness tests above that envelope fail with 429 responses from Nginx, not
backend latency.

## Baseline table

| Test | VUs | Duration | p50 | p95 | Error rate | CPU peak | RAM peak | Result |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| health.js | 25 | 1m15s | 4.02ms | 5.91ms | 0.00% | not captured | not captured | PASS |
| api-readiness.js | 4 | 1m15s | 3.82ms | 5.48ms | 0.00% | not captured | not captured | PASS |
| api-readiness.js | 10 | 1m15s | 3.60ms | 5.23ms | 19.07% | not captured | not captured | EXPECTED_FAIL_RATE_LIMIT |

## Commands

```bash
BASE_URL=https://cjw.52nbc.com VUS=25 RAMP_UP=15s HOLD=45s RAMP_DOWN=15s k6 run examples/loadtest/health.js
BASE_URL=https://cjw.52nbc.com VUS=4 RAMP_UP=15s HOLD=45s RAMP_DOWN=15s k6 run examples/loadtest/api-readiness.js

# Demonstrates production gateway limit, not backend saturation:
BASE_URL=https://cjw.52nbc.com VUS=10 RAMP_UP=15s HOLD=45s RAMP_DOWN=15s k6 run examples/loadtest/api-readiness.js
```

## Database evidence

Run after test:

```bash
sudo -u postgres psql conjiweb -f scripts/sql/hot_queries.sql
sudo -u postgres psql conjiweb -f scripts/sql/index_usage.sql
sudo -u postgres psql conjiweb -f scripts/sql/table_bloat_candidates.sql
```

Attach outputs here.
