# Prometheus / Alertmanager Evidence

Status: PENDING_STAGING_RUN

## Prometheus target health

| Target | Result | Evidence |
|---|---:|---|
| Conjiweb API `/api/metrics` | PENDING | Prometheus targets screenshot or curl output |
| Alert rules loaded | PENDING | `promtool check rules` output |
| Alertmanager reachable | PENDING | Alertmanager status screenshot or curl output |

## Commands

```bash
docker compose -f examples/observability/docker-compose.observability.yml up -d
curl -fsS http://127.0.0.1:9090/-/ready
curl -fsS http://127.0.0.1:9093/-/ready
curl -fsS https://staging.example.com/api/metrics | head -40
docker compose -f examples/observability/docker-compose.observability.yml exec prometheus \
  promtool check rules /etc/prometheus/rules/conjiweb-alerts.yml
```

## Sample alert-fire test

Temporarily trigger repeated admin login failures against staging and confirm `ConjiwebAdminLoginFailures` enters pending/firing state.

Result: PENDING
