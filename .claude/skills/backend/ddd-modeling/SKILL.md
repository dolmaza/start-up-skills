---
name: ddd-modeling
description: >-
  Patterns and C# templates for the Domain layer: aggregate roots, entities,
  strongly-typed IDs, value objects, domain events, and repository interfaces with
  zero external dependencies. Use when modeling or changing domain types.
---

# DDD Modeling

Constitution (when the project has one): `docs/backend/ARCHITECTURE.md` §1. Domain has **zero** framework dependencies.

## Aggregate root (protects invariants, raises events)
```csharp
public sealed class Order : AggregateRoot<OrderId>
{
    private readonly List<OrderLine> _lines = new();
    public CustomerId CustomerId { get; private set; }
    public OrderStatus Status { get; private set; }
    public IReadOnlyList<OrderLine> Lines => _lines.AsReadOnly();

    private Order() { } // EF needs a parameterless ctor; keep it private

    public static Result<Order> Create(CustomerId customerId)
    {
        if (customerId is null) return Result.Failure<Order>(DomainErrors.Order.NoCustomer);
        var order = new Order { Id = OrderId.New(), CustomerId = customerId, Status = OrderStatus.Draft };
        order.Raise(new OrderCreatedDomainEvent(order.Id));
        return Result.Success(order);
    }

    public Result AddLine(ProductId productId, Money price, int qty)
    {
        if (Status != OrderStatus.Draft) return Result.Failure(DomainErrors.Order.NotEditable);
        if (qty <= 0) return Result.Failure(DomainErrors.Order.InvalidQuantity);
        _lines.Add(new OrderLine(productId, price, qty));
        return Result.Success();
    }
}
```

## Strongly-typed ID (value object)
```csharp
public readonly record struct OrderId(Guid Value)
{
    public static OrderId New() => new(Guid.NewGuid());
}
```

## Value object (validate on construction, compare by value)
```csharp
public sealed record Money
{
    public decimal Amount { get; }
    public string Currency { get; }
    private Money(decimal amount, string currency) { Amount = amount; Currency = currency; }

    public static Result<Money> Create(decimal amount, string currency) =>
        amount < 0          ? Result.Failure<Money>(DomainErrors.Money.Negative)
      : string.IsNullOrWhiteSpace(currency) ? Result.Failure<Money>(DomainErrors.Money.NoCurrency)
      : Result.Success(new Money(amount, currency.ToUpperInvariant()));
}
```

## Domain event + repository interface
```csharp
public sealed record OrderCreatedDomainEvent(OrderId OrderId) : IDomainEvent;

public interface IOrderRepository            // interface lives in Domain
{
    Task<Order?> GetByIdAsync(OrderId id, CancellationToken ct);
    void Add(Order order);
}
```

## Errors as data (no thrown exceptions for business rules)
```csharp
public static class DomainErrors
{
    public static class Order
    {
        public static readonly Error NotEditable =
            new("Order.NotEditable", "Only draft orders can be modified.", ErrorType.Conflict);
        public static readonly Error InvalidQuantity =
            new("Order.InvalidQuantity", "Quantity must be positive.", ErrorType.Validation);
    }
}
```

## Checklist
- [ ] No framework `using`s in the Domain project.
- [ ] State changes only via methods; setters private.
- [ ] Factory/behavior returns `Result`; aggregate can't exist invalid.
- [ ] IDs strongly typed; events raised for cross-context state changes.
