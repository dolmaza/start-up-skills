---
name: minimal-api-endpoints
description: >-
  Templates for the Presentation layer: feature-grouped Minimal API endpoints, the
  IEndpointGroup discovery pattern, Result→HTTP mapping, and a structural
  Program.cs built from extension methods. Use when adding endpoints or wiring the
  API host. No Controllers.
---

# Minimal API Endpoints

Constitution (when the project has one): `docs/backend/ARCHITECTURE.md` §3. Endpoints are thin: HTTP ↔ CQRS message ↔
`Result` ↔ HTTP. No business logic. `Program.cs` is structural only.

## Endpoint group abstraction
```csharp
public interface IEndpointGroup { void Map(IEndpointRouteBuilder app); }
```

## A feature group (thin — send message, map Result)
```csharp
public sealed class OrderEndpoints : IEndpointGroup
{
    public void Map(IEndpointRouteBuilder app)
    {
        var g = app.MapGroup("/orders").WithTags("Orders");

        g.MapPost("/", async (PlaceOrderRequest req, ISender sender, CancellationToken ct) =>
        {
            var result = await sender.Send(new PlaceOrderCommand(req.CustomerId), ct);
            return result.ToHttpResult(id => Results.Created($"/orders/{id}", id));
        })
        .WithName("PlaceOrder").Produces<Guid>(201).ProducesProblem(400);

        g.MapGet("/{id:guid}", async (Guid id, ISender sender, CancellationToken ct) =>
        {
            var result = await sender.Send(new GetOrderByIdQuery(id), ct);
            return result.ToHttpResult(Results.Ok);
        })
        .WithName("GetOrderById").Produces<OrderDto>(200).ProducesProblem(404);
    }
}
```

## Result → HTTP mapping (shared helper)
```csharp
public static class ResultHttpExtensions
{
    public static IResult ToHttpResult(this Result r) =>
        r.IsSuccess ? Results.NoContent() : Problem(r.Error);
    public static IResult ToHttpResult<T>(this Result<T> r, Func<T, IResult> onOk) =>
        r.IsSuccess ? onOk(r.Value) : Problem(r.Error);

    private static IResult Problem(Error e) => Results.Problem(
        title: e.Code, detail: e.Message,
        statusCode: e.Type switch
        {
            ErrorType.Validation   => StatusCodes.Status400BadRequest,
            ErrorType.NotFound     => StatusCodes.Status404NotFound,
            ErrorType.Conflict     => StatusCodes.Status409Conflict,
            ErrorType.Unauthorized => StatusCodes.Status401Unauthorized,
            _                      => StatusCodes.Status500InternalServerError,
        });
}
```

## Discovery + structural Program.cs
```csharp
public static class EndpointExtensions
{
    public static IServiceCollection AddEndpoints(this IServiceCollection s) // reflect IEndpointGroup
        => s.Scan(/* register all IEndpointGroup in the Api assembly */);

    public static IApplicationBuilder MapEndpoints(this WebApplication app)
    {
        foreach (var g in app.Services.GetServices<IEndpointGroup>()) g.Map(app);
        return app;
    }
}
```
```csharp
// Program.cs — structural only
var builder = WebApplication.CreateBuilder(args);
builder.Host.UseSerilog(/* ... */);
builder.Services
    .AddApplication()
    .AddInfrastructure(builder.Configuration)
    .AddPresentation();          // OpenAPI, endpoints, problem details, telemetry
var app = builder.Build();
app.UsePresentationPipeline();   // exception handler, swagger, etc.
app.MapEndpoints();
app.Run();
```

## Checklist
- [ ] Endpoint lambdas only translate — no business/orchestration logic.
- [ ] Errors mapped by `ErrorType`; success uses correct 200/201/204.
- [ ] Endpoints grouped by feature; registered via a single `MapEndpoints()`.
- [ ] `Program.cs` has no inline service config or route logic.
- [ ] OpenAPI metadata on every endpoint; Swagger UI + JWT bearer wiring per the
      `local-dev-environment` skill (`docs/backend/ARCHITECTURE.md` §10.3).
