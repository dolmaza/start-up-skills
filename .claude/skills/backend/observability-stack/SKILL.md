---
name: observability-stack
description: >-
  Wiring for Serilog structured logging, OpenTelemetry traces + metrics over OTLP
  to the Grafana stack (Tempo/Prometheus/Loki), custom business metrics, and
  dashboards/alerts as code. Use when adding observability to the API or Worker.
---

# Observability Stack

Constitution (when the project has one): `docs/backend/ARCHITECTURE.md` §6. Log all errors with context; `LogInformation`
only for crucial lifecycle events. Telemetry wiring lives in extension methods.
Locally the whole Grafana stack + OTel Collector run via docker-compose — the
stack, its `deploy/` configs, and the URL table are in the `local-dev-environment`
skill (§10).

## Serilog (structured, trace-correlated)
```csharp
builder.Host.UseSerilog((ctx, lc) => lc
    .ReadFrom.Configuration(ctx.Configuration)
    .Enrich.FromLogContext()
    .Enrich.WithSpan()                 // attach trace/span IDs
    .WriteTo.Console(new RenderedCompactJsonFormatter())
    .WriteTo.OpenTelemetry());         // ship logs to Loki via OTLP
```
- Errors: `logger.LogError(ex, "Failed to {Operation} for {OrderId}", op, id);`
  — always the exception + structured context.
- Redact secrets/PII via destructuring policies; never log tokens or payloads with
  personal data.

## OpenTelemetry (traces + metrics → Grafana via OTLP)
```csharp
builder.Services.AddOpenTelemetry()
    .ConfigureResource(r => r.AddService(serviceName))
    .WithTracing(t => t
        .AddAspNetCoreInstrumentation()
        .AddHttpClientInstrumentation()
        .AddEntityFrameworkCoreInstrumentation()
        .AddNpgsql()
        .AddSource("Messaging.RabbitMQ")
        .AddOtlpExporter())            // → Tempo
    .WithMetrics(m => m
        .AddAspNetCoreInstrumentation()
        .AddRuntimeInstrumentation()
        .AddMeter("Acme.Business")
        .AddOtlpExporter());           // → Prometheus
```

## Custom business metrics
```csharp
public sealed class BusinessMetrics
{
    private readonly Counter<long> _ordersPlaced;
    private readonly Counter<long> _orderFailures;
    public BusinessMetrics(IMeterFactory f)
    {
        var m = f.Create("Acme.Business");
        _ordersPlaced  = m.CreateCounter<long>("orders.placed");
        _orderFailures = m.CreateCounter<long>("orders.failed");
    }
    public void OrderPlaced() => _ordersPlaced.Add(1);
    public void OrderFailed(string reason) => _orderFailures.Add(1, KeyValuePair.Create("reason", (object?)reason));
}
```

## Dashboards & alerts as code
- Commit Grafana provisioning (`grafana/provisioning/dashboards/*.json`,
  datasources, `alerting/*.yaml`).
- Two dashboard families: **infrastructure** (CPU, memory, DB connections, GC) and
  **business** (transaction rate, failure ratio, domain counters).
- Alert rules for: error-rate spike, dependency latency, DB connection saturation,
  unhandled-exception surge → route to the team's channel.

## Checklist
- [ ] Trace IDs flow across API → DB → broker → Worker.
- [ ] Every error logged with exception + context; no info-log noise.
- [ ] OTLP exporters point at the Grafana stack; metrics include business signals.
- [ ] Dashboards + alerts committed to the repo.
