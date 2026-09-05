---
name: grafana-dashboards
description: >-
  Method for audience-driven Grafana observability: telemetry discovery, the
  dashboard hierarchy (executive, service health, API, database, infrastructure,
  business, UX, background jobs, integrations), PromQL patterns (RED/USE),
  provisioning dashboards + alert rules as code under deploy/grafana/, SLO-based
  alerting, and the missing-instrumentation gap analysis. Use when designing,
  reviewing, or improving dashboards, alerts, or observability coverage.
---

# Grafana Dashboards (audience-driven observability)

Telemetry wiring: `observability-stack` skill. Stack + `deploy/` layout:
`local-dev-environment` skill §10. Rule zero: **start from the questions an
audience needs answered, then find (or request) the telemetry** — never build
dashboards just because metrics exist.

## 1. Discovery (before any dashboard)

1. **Emitted metrics** — grep the code for `IMeterFactory`/`Meter(` (custom
   meters + exact metric names), OTel `With(Tracing|Metrics)` setup (which
   instrumentations are on), Serilog config (structured fields → Loki queries).
2. **Live names** — when the stack runs, verify against a real scrape:
   `curl -s localhost:9090/api/v1/label/__name__/values` (or the service's
   `/metrics`). PromQL is written against these names, never guessed ones.
3. **Existing provisioning** — `deploy/grafana/provisioning/**` (what exists,
   what's stale), `deploy/prometheus.yaml` scrape targets, datasource UIDs.
4. **The product** — whatever states the product intent (a spec, a README, or
   the user directly): critical user journeys, business events, NFRs → these
   define the business panels and SLOs. Domain KPIs must trace to a stated
   requirement, never be invented.
5. **Audiences** — who will look at each dashboard (on-call engineer, operator,
   product owner/executive) and what decision each needs to make.

## 2. Dashboard hierarchy

Top-down, linked for drill-down; every dashboard opens with its KPIs
(stat/gauge row) before detail panels. Build what the product warrants — a
service with no background jobs gets no jobs dashboard.

| Dashboard | Audience | Core content |
|---|---|---|
| **Executive / overview** | management, product | availability, overall error rate, active users (DAU/MAU), request volume, domain KPIs (orders, revenue, conversions), user growth |
| **Service health** (one per service) | on-call | RED (rate, errors, duration p50/p95/p99) + resources (CPU, memory, GC, threads), connection pools, container restarts, dependency failures |
| **API detail** | developers | per-endpoint latency/count/status codes, slowest endpoints, error distribution, auth failures, rate limiting, top consumers |
| **Database** | developers, ops | query duration, slow queries, pool saturation, locks/deadlocks, cache hit ratio, transactions, replication lag, storage growth |
| **Infrastructure** | ops | node/container CPU, memory, disk, network; restarts, scaling events, load balancers |
| **Business** | product owner | domain events from the requirements — e.g. searches (total/failed/latency), top products/providers, bookmarks, notification subscriptions + delivery success, registrations, retention |
| **User experience** | frontend, product | Core Web Vitals (LCP, INP, CLS), page load, JS error rate, user-perceived API latency, browser/device split — when frontend telemetry exists (else a gap) |
| **Background processing** | on-call | queue depth, processing time, failures, retries, dead-letter depth, worker utilization |
| **Integrations** | on-call | per-dependency latency, failures, retries, circuit-breaker state, timeouts, rate-limit responses |

Design rules: actionable panels only (delete what nobody acts on); meaningful
grouping via rows; business vs technical clearly separated but cross-linked
(data links from a business dip to the service health of the same window);
consistent units, thresholds, and time ranges.

## 3. PromQL patterns

```promql
# RED — request rate, error ratio, latency quantile (ASP.NET Core OTel metrics)
sum by (service) (rate(http_server_request_duration_seconds_count[5m]))
sum(rate(http_server_request_duration_seconds_count{http_response_status_code=~"5.."}[5m]))
  / sum(rate(http_server_request_duration_seconds_count[5m]))
histogram_quantile(0.95,
  sum by (le) (rate(http_server_request_duration_seconds_bucket[5m])))

# USE — saturation examples
process_runtime_dotnet_gc_heap_size_bytes
sum(db_client_connections_usage{state="used"}) / sum(db_client_connections_max)

# Business counter (custom meter, e.g. Acme.Business / orders.placed)
sum(increase(orders_placed_total[1h]))
```

Label conventions and exact names come from discovery (§1). Loki panels use the
structured Serilog fields; Tempo panels link via trace ID from logs/exemplars.

## 4. Provisioning as code

```text
deploy/grafana/provisioning/
├── datasources/datasources.yaml        # Prometheus / Loki / Tempo (stable UIDs)
├── dashboards/dashboards.yaml          # file provider → folder per audience
├── dashboards/<area>/<slug>.json       # e.g. overview/executive.json, services/api-health.json
└── alerting/alerts.yaml                # alert rules + notification policies
```

Dashboard JSON conventions: stable `uid` (slug, never auto-generated),
`schemaVersion` current, datasource by UID not name, templating variables for
service/instance/environment, `time` default 6h, tags (`audience:oncall`,
`area:business`) so folders and search stay navigable. Validate by reloading
the local stack (`docker compose restart grafana`) and checking every panel
renders data (or an explicit "no data yet — needs instrumentation X" text
panel — never a silently broken query).

## 5. Alerts & SLOs

Define SLIs/SLOs from the NFRs and critical journeys first (e.g. availability
99.9%, p95 < 500ms, notification delivery > 99%). Then alert on:

- **SLO burn** — multi-window burn rate (fast: 5m/1h, slow: 30m/6h), not raw
  threshold flapping.
- **Symptoms over causes** — error rate, latency, availability, queue backlog,
  dead-letter growth, dependency failure ratio, cert/token expiry.
- **Business anomalies** — sudden drop in a KPI (orders, searches, logins) vs
  same window baseline; unusual traffic spikes.

Every rule states: what broke *for users*, the runbook/first action, and the
owning dashboard link. If nobody would act on it at 3am, it's a warning on a
dashboard, not a page. Route via notification policies; group to avoid storms.

## 6. Missing-instrumentation analysis

Compare the questions (§1.4–1.5) against the telemetry (§1.1–1.3). Each gap is
specified — never silently skipped:

```markdown
GAP-N | <missing signal> | priority
Question it answers: … (audience)
Instrument: e.g. Counter `notifications.delivered` + `reason` label in
  NotificationDispatcher; OTel span around provider call; structured log field
Dashboards unlocked: business §delivery, integrations §provider
→ route to `observability-engineer`
```

Typical gaps: business events with no counter, external calls with no span or
failure metric, missing health checks, no frontend/Web-Vitals telemetry, logs
missing the field a Loki panel needs.

## 7. Deliverables & report

```markdown
## Observability assessment — <date>
Telemetry inventory: <n> metrics / traces / log streams (sources)
### Dashboards (provisioned)
name | uid | audience | question it answers | file
### Alerts (provisioned)
rule | SLO/symptom | severity | runbook action
### Instrumentation gaps (prioritized)
GAP-N | missing | why it matters | route
### Not covered
<journeys/services still unobservable and why>
```

Success = every critical journey observable, per-service health dashboards,
business KPIs visible to stakeholders, alerts actionable (MTTD/MTTR down),
and business ↔ technical metrics linked so a KPI dip leads to the failing
component in two clicks.
