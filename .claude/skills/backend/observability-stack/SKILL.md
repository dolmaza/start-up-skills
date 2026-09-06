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
// Serilog.AspNetCore 8+: register on Services; Host.UseSerilog is the older form.
builder.Services.AddSerilog((sp, lc) => lc
    .ReadFrom.Configuration(builder.Configuration)
    .ReadFrom.Services(sp)
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

    // Explicit ctor, not a primary one: both counters come off the same Meter, and a
    // field initializer cannot reference another instance field.
    public BusinessMetrics(IMeterFactory meterFactory)
    {
        var meter = meterFactory.Create("Acme.Business");
        _ordersPlaced  = meter.CreateCounter<long>("orders.placed");
        _orderFailures = meter.CreateCounter<long>("orders.failed");
    }

    public void OrderPlaced() => _ordersPlaced.Add(1);
    public void OrderFailed(string reason) => _orderFailures.Add(1, new TagList { { "reason", reason } });
}
```
> Register as a singleton and let `IMeterFactory` own the `Meter` — do **not** dispose
> it yourself. `TagList` is the allocation-free way to attach dimensions.

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
- [ ] Modern C# baseline applied — see `clean-architecture` skill.
