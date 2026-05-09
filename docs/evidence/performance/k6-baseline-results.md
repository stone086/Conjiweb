# k6 Performance Baseline Results

Status: PENDING_STAGING_RUN

## Baseline table

| Test | VUs | Duration | p50 | p95 | Error rate | CPU peak | RAM peak | Result |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| health.js | 100 | 9m | PENDING | PENDING | PENDING | PENDING | PENDING | PENDING |
| api-readiness.js | 50 | 9m | PENDING | PENDING | PENDING | PENDING | PENDING | PENDING |

## Commands

```bash
BASE_URL=https://staging.example.com k6 run examples/loadtest/health.js
BASE_URL=https://staging.example.com k6 run examples/loadtest/api-readiness.js
```

## Database evidence

Run after test:

```bash
sudo -u postgres psql conjiweb -f scripts/sql/hot_queries.sql
sudo -u postgres psql conjiweb -f scripts/sql/index_usage.sql
sudo -u postgres psql conjiweb -f scripts/sql/table_bloat_candidates.sql
```

Attach outputs here.
