---
name: cqrs-result-pattern
description: >-
  Templates for the CQRS write/read flow, the Result/Error pattern, and
  FluentValidation wiring in the Application layer. Use when adding a command,
  query, handler, or validator, or when implementing the Result type itself.
---

# CQRS + Result Pattern

Constitution (when the project has one): `docs/backend/ARCHITECTURE.md` §2. Handlers return `Result`; expected failures are
values, not exceptions. Handlers use repository interfaces, never `DbContext`.

## Result / Error (BuildingBlocks)
```csharp
public enum ErrorType { Validation, NotFound, Conflict, Unauthorized, Failure }
public sealed record Error(string Code, string Message, ErrorType Type)
{
    public static readonly Error None = new(string.Empty, string.Empty, ErrorType.Failure);
}

public class Result
{
    // Explicit ctors, NOT primary constructors: a primary constructor is always as
    // accessible as the type, and these must stay protected/internal so `Result`
    // can only be built through the factories below.
    protected Result(bool isSuccess, Error error) => (IsSuccess, Error) = (isSuccess, error);

    public bool IsSuccess { get; }
    public bool IsFailure => !IsSuccess;
    public Error Error { get; }

    public static Result Success() => new(true, Error.None);
    public static Result Failure(Error e) => new(false, e);
    public static Result<T> Success<T>(T value) => new(value, true, Error.None);
    public static Result<T> Failure<T>(Error e) => new(default!, false, e);
}

public sealed class Result<T> : Result
{
    private readonly T _value;
    internal Result(T value, bool isSuccess, Error error) : base(isSuccess, error) => _value = value;

    public T Value => IsSuccess ? _value : throw new InvalidOperationException("No value on failure.");

    public static implicit operator Result<T>(T value) => Success(value);
}
```

## Command + handler (write side — repositories only)
```csharp
public sealed record PlaceOrderCommand(Guid CustomerId) : IRequest<Result<Guid>>;

// Primary constructor: no fields, no assignments — parameters are in scope in the body.
public sealed class PlaceOrderHandler(IOrderRepository orders, IUnitOfWork uow)
    : IRequestHandler<PlaceOrderCommand, Result<Guid>>
{
    public async Task<Result<Guid>> Handle(PlaceOrderCommand cmd, CancellationToken ct)
    {
        var created = Order.Create(new CustomerId(cmd.CustomerId));
        if (created.IsFailure) return Result.Failure<Guid>(created.Error);

        orders.Add(created.Value);
        await uow.SaveChangesAsync(ct);
        return Result.Success(created.Value.Id.Value);
    }
}
```
> Inject `IOrderRepository` + `IUnitOfWork` — **never** `DbContext`.

## Validator (runs before the handler via a pipeline behavior)
```csharp
public sealed class PlaceOrderValidator : AbstractValidator<PlaceOrderCommand>
{
    public PlaceOrderValidator() => RuleFor(x => x.CustomerId).NotEmpty();
}
```
```csharp
// ValidationBehavior<TReq,TResp>: run validators, and on failure short-circuit to
// Result.Failure(new Error("Validation", msg, ErrorType.Validation)) — do NOT throw.
```

## Query + handler (read side — Dapper → DTO, no domain, no tracking)
```csharp
public sealed record GetOrderByIdQuery(Guid Id) : IRequest<Result<OrderDto>>;
public sealed record OrderDto(Guid Id, string Status, decimal Total);

// `reads` is Dapper-backed; the interface itself is declared here in Application.
public sealed class GetOrderByIdHandler(IOrderReadService reads)
    : IRequestHandler<GetOrderByIdQuery, Result<OrderDto>>
{
    public async Task<Result<OrderDto>> Handle(GetOrderByIdQuery q, CancellationToken ct)
    {
        var dto = await reads.GetByIdAsync(q.Id, ct);
        return dto is null
            ? Result.Failure<OrderDto>(new Error("Order.NotFound", "Order not found.", ErrorType.NotFound))
            : Result.Success(dto);
    }
}
```

## Checklist
- [ ] One folder per use case (`Application/<Feature>/Commands|Queries/<UseCase>/`):
      command/query + handler + validator together; a use-case-local DTO stays
      with it, DTOs shared across the feature's use cases go in `<Feature>/Dtos/`.
- [ ] Handler returns `Result`/`Result<T>`; no thrown exceptions for expected paths.
- [ ] Writes go through repository + UoW; reads through a Dapper read interface.
- [ ] Validator exists and is wired into the validation behavior.
- [ ] No EF Core / Infrastructure reference in the Application project.
- [ ] Modern C# baseline applied — see `clean-architecture` skill.
