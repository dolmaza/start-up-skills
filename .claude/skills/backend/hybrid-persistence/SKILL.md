---
name: hybrid-persistence
description: >-
  Templates for the hybrid ORM strategy: EF Core for writes (DbContext, entity
  configs, repositories, Unit of Work) and Dapper for high-performance reads, plus
  Redis cache-aside, S3 storage, and RabbitMQ wiring — all behind interfaces. Use
  in the Infrastructure layer.
---

# Hybrid Persistence (EF Core writes + Dapper reads)

Constitution (when the project has one): `docs/backend/ARCHITECTURE.md` §4. Concrete code lives in Infrastructure and is
exposed only via inward interfaces. `DbContext` never leaves this layer.

## Write side — EF Core
```csharp
public sealed class AppDbContext(DbContextOptions<AppDbContext> options)
    : DbContext(options), IUnitOfWork
{
    public DbSet<Order> Orders => Set<Order>();
    protected override void OnModelCreating(ModelBuilder b) =>
        b.ApplyConfigurationsFromAssembly(typeof(AppDbContext).Assembly);

    public async Task<int> SaveChangesAsync(CancellationToken ct = default)
    {
        // dispatch domain events of tracked aggregates here, then:
        return await base.SaveChangesAsync(ct);
    }
}

public sealed class OrderConfiguration : IEntityTypeConfiguration<Order>
{
    public void Configure(EntityTypeBuilder<Order> b)
    {
        b.ToTable("orders");
        b.HasKey(o => o.Id);
        b.Property(o => o.Id).HasConversion(id => id.Value, v => new OrderId(v));
        b.OwnsMany(o => o.Lines, lb => lb.ToTable("order_lines"));
    }
}

public sealed class OrderRepository(AppDbContext db) : IOrderRepository   // implements Domain interface
{
    public Task<Order?> GetByIdAsync(OrderId id, CancellationToken ct) =>
        db.Orders.Include(o => o.Lines).FirstOrDefaultAsync(o => o.Id == id, ct);

    public void Add(Order order) => db.Orders.Add(order);
}
```

## Read side — Dapper (raw SQL → DTO, no tracking)
```csharp
public interface IOrderReadService           // declared in Application
{ Task<OrderDto?> GetByIdAsync(Guid id, CancellationToken ct); }

public sealed class OrderReadService(IDbConnectionFactory factory) : IOrderReadService   // implemented here
{
    public async Task<OrderDto?> GetByIdAsync(Guid id, CancellationToken ct)
    {
        const string sql = """
            SELECT o.id AS Id, o.status AS Status, COALESCE(SUM(l.price*l.qty),0) AS Total
            FROM orders o LEFT JOIN order_lines l ON l.order_id = o.id
            WHERE o.id = @id GROUP BY o.id, o.status;
            """;
        await using var conn = await factory.CreateOpenConnectionAsync(ct);
        return await conn.QuerySingleOrDefaultAsync<OrderDto>(
            new CommandDefinition(sql, new { id }, cancellationToken: ct));
    }
}
```
> Always parameterize (`@id`). Never concatenate user input into SQL. The SQL is a
> raw string literal (`"""…"""`) — no escaping, no concatenation — and the connection
> is disposed with `await using`, not `using`.

## Integrations behind interfaces
- `ICacheStore` → Redis (StackExchange.Redis), cache-aside: try cache → on miss
  load + set with TTL. Cache DTOs, not aggregates.
- `IFileStorage` → S3-compatible (AWSSDK.S3 against AWS or MinIO).
- `IEventBus` / `IMessagePublisher` → RabbitMQ. Publish integration events on
  commit; heavy consumers run in the Worker project.

## Registration
```csharp
public static IServiceCollection AddInfrastructure(this IServiceCollection s, IConfiguration cfg)
{
    s.AddDbContext<AppDbContext>(o => o.UseNpgsql(cfg.GetConnectionString("Db")));
    s.AddScoped<IUnitOfWork>(sp => sp.GetRequiredService<AppDbContext>());
    s.AddScoped<IOrderRepository, OrderRepository>();
    s.AddScoped<IOrderReadService, OrderReadService>();
    // Redis, S3, RabbitMQ, IDbConnectionFactory ...
    return s;
}
```

## Checklist
- [ ] Writes via EF + repository + UoW; reads via Dapper to DTO.
- [ ] `DbContext` not referenced outside Infrastructure.
- [ ] SQL parameterized; connections scoped/disposed.
- [ ] Every integration registered against its interface in `AddInfrastructure`.
- [ ] Modern C# baseline applied — see `clean-architecture` skill.
