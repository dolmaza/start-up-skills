---
name: performance-optimization
description: >-
  Measurement-first method for optimizing existing features: baselining
  (latency, throughput, queries, allocations, traces, load runs), the
  bottleneck taxonomy with root causes, an optimization catalog mapped to this
  stack (indexes, Dapper read models, cache-aside, batching, streaming, outbox +
  queue offloading, parallelization), the phased refactoring-plan template, and
  the before/after validation report. Use when a feature is slow, throughput is
  low, or an architecture needs a performance review.
---

# Performance Optimization (measure → root cause → redesign → prove)

Rule zero: **no baseline, no change; no re-measurement, no claimed win.**
Optimize based on evidence, at the architecture level, inside the constitution
(`docs/backend/ARCHITECTURE.md`) — the goal is the NFR, not "as fast as
possible".

## 1. Baseline (reproducible, recorded)

Define the scenario precisely (endpoint/flow, payload, data volume, warm/cold)
and script it so the identical run repeats after the change. Measure against
the local compose stack (or staging):

```bash
# load: latency percentiles + throughput (commit the script)
k6 run perf/place-order.js          # or: bombardier -c 20 -d 60s https://localhost:5001/api/orders
# runtime: CPU, GC, allocations, threadpool
dotnet-counters monitor -p <pid> System.Runtime Microsoft.AspNetCore.Hosting
dotnet-trace collect -p <pid>       # hot-path flamegraph when CPU-bound
# database: what actually ran
# EF: EnableSensitiveDataLogging + LogTo in dev → count queries per request
# Postgres: EXPLAIN (ANALYZE, BUFFERS) <query>;  pg_stat_statements for the top offenders
```

Use the existing telemetry first — Tempo traces show where the time goes
across API → DB → broker → Worker; Prometheus/Grafana show rates and
saturation (`grafana-dashboards` skill). Record: p50/p95/p99 latency,
req/s, query count per request, rows read, allocations/req, CPU%, error rate.

Micro-benchmarks (BenchmarkDotNet) only for genuinely CPU-bound inner loops —
never as a substitute for the end-to-end scenario.

## 2. Bottleneck taxonomy → root cause

Attribute the time before fixing anything — the trace tells you which bucket:

| Symptom | Likely root causes | First evidence to pull |
|---|---|---|
| High DB share of trace | N+1s, missing index, full scans, over-fetching, chatty round trips, large transactions | query log count, `EXPLAIN ANALYZE`, rows read vs returned |
| High app CPU | inefficient algorithm/data structure, serialization overhead, excessive allocations → GC | flamegraph, `dotnet-counters` GC/alloc rates |
| Latency without CPU | blocking/sync I/O, sequential awaits that could compose, lock/pool contention, external call chain | thread pool queue length, per-span waterfall |
| Fine alone, dies under load | pool exhaustion (DB/HTTP), lock contention, missing backpressure, no pagination on hot lists | saturation metrics at the breaking concurrency |
| Slow cross-service flow | chattiness, sync where async fits, missing timeout/retry budgets, payload bloat | span count per flow, bytes on the wire |

Name the cause **and its share** ("62 queries → 78% of p95"). A fix targeting
an unmeasured cause is not proposed.

## 3. Optimization catalog (this stack, ROI order)

Cheapest wins first — each entry stays behind the existing interfaces:

1. **Do less work**: kill N+1s (`Include`/projection), select only needed
   columns (`.Select` to DTO), `AsNoTracking` on reads, paginate every
   unbounded list, compress/trim payloads.
2. **Index right**: covering/partial indexes from real `EXPLAIN` plans; verify
   the plan changed. Watch write amplification.
3. **Read models**: hot/aggregating reads move to Dapper read services
   (`hybrid-persistence`) — purpose-built SQL, no ORM overhead; materialized
   views for expensive aggregations (with refresh strategy).
4. **Batch & bulk**: N round trips → one (bulk insert/update, `IN` queries,
   batched messages).
5. **Cache deliberately**: Redis cache-aside for read-heavy stable data —
   *with* TTL + explicit invalidation on the write path, stated staleness
   tolerance; HTTP/response caching and CDN for public GETs. Never cache to
   hide a fixable query.
6. **Async & parallel**: truly independent awaits composed with
   `Task.WhenAll`; `IAsyncEnumerable`/streaming for large exports; no
   `.Result`/`.Wait()` blocking anywhere.
7. **Offload**: work that needn't block the request (emails, projections,
   heavy processing) → domain event → outbox → RabbitMQ → Worker. Sagas for
   multi-step consistency. The response returns when the *user's* need is met.
8. **Allocate less** (only when GC provably hurts): pooling, `Span<T>`,
   streaming serialization.
9. **Scale out** (last, after the above): stateless API instances behind a
   LB, partitioned queue consumers — never scale hardware around an N+1.

## 4. Refactoring plan (present before large changes)

```markdown
## Optimization plan — <feature> (<date>)
Target: <NFR, e.g. p95 < 400ms @ 50 rps>   Baseline: <numbers, scenario ref>
### Current architecture   <2-5 lines / diagram of the flow as-is>
### Bottlenecks            BN-1 … | root cause | share of latency | evidence
### Proposed architecture  <flow to-be; which catalog items, where>
### Phases                 P1 (low-risk quick wins) → P2 → P3, each: change,
                           expected gain, risk, effort (S/M/L), rollback
### Risks                  behavior/migration/staleness risks + mitigations
```

Incremental beats big-bang: each phase ships alone, tests green, re-measured.
Stop early when the target is met — remaining phases stay documented, unbuilt.

## 5. Validation & report

Re-run the **identical** baseline scenario per phase:

```markdown
## Performance report — <feature>
| Metric | Baseline | After P1 | After P2 | Target |
| p95 latency | 2,340ms | 610ms | 380ms | 400ms ✅ |
| queries/req | 62 | 4 | 4 | — |
| req/s @ SLA | 11 | 46 | 71 | 50 ✅ |
Root causes fixed: … | Deliberately not done: <item — trade-off>
Regressions: <anything worse, honestly> | Gates: tests ✅ architecture ✅
```

Commit the load scripts + this report next to the feature's progress notes so
the next optimization starts from a known baseline. Gate the final diff against
the `clean-architecture` skill layer rules; the acceptance criteria must still pass.
