---
name: dotnet-testing
description: >-
  Templates and rules for the testing pyramid with xUnit + FluentAssertions + Moq
  + WireMock + Testcontainers: unit tests for domain/handlers, integration tests
  for infra/external deps, and E2E tests through WebApplicationFactory. Use when
  adding test coverage for any feature.
---

# .NET Testing (the pyramid)

Constitution (when the project has one): `docs/backend/ARCHITECTURE.md` §8. Every feature ships with tests. AAA,
deterministic, isolated, descriptive names. Mock only true externals.

## Unit — domain & handlers (the bulk)
```csharp
public class PlaceOrderHandlerTests
{
    [Fact]
    public async Task Handle_ValidCommand_PersistsOrderAndReturnsId()
    {
        // Arrange
        var orders = new Mock<IOrderRepository>();
        var uow = new Mock<IUnitOfWork>();
        var sut = new PlaceOrderHandler(orders.Object, uow.Object);

        // Act
        var result = await sut.Handle(new PlaceOrderCommand(Guid.NewGuid()), default);

        // Assert
        result.IsSuccess.Should().BeTrue();
        orders.Verify(o => o.Add(It.IsAny<Order>()), Times.Once);
        uow.Verify(u => u.SaveChangesAsync(It.IsAny<CancellationToken>()), Times.Once);
    }
}
```
Domain tests assert invariants directly (no mocks): `Order.AddLine` on a non-draft
order returns `Result.Failure(DomainErrors.Order.NotEditable)`.

## Integration — real infra via Testcontainers; WireMock for external HTTP
```csharp
public class OrderRepositoryTests : IClassFixture<PostgresFixture>
{
    // spin up a real Postgres container, run migrations, exercise the repository,
    // assert round-trip persistence. Use WireMock.Server for any external API/LLM.
}
```

## E2E — critical journeys through the host (fewest)
```csharp
public class PlaceOrderEndpointTests : IClassFixture<ApiFactory> // : WebApplicationFactory<Program>
{
    [Fact]
    public async Task PostOrder_ThenGet_ReturnsCreatedOrder()
    {
        var client = _factory.CreateClient();
        var post = await client.PostAsJsonAsync("/orders", new { customerId = Guid.NewGuid() });
        post.StatusCode.Should().Be(HttpStatusCode.Created);
        // follow Location, GET, assert body
    }
}
```

## Architecture fitness tests (run by the reviewer) — NetArchTest
```csharp
[Fact]
public void Domain_HasNoDependencyOnOtherLayers()
{
    var result = Types.InAssembly(typeof(Order).Assembly)
        .ShouldNot().HaveDependencyOnAny("Acme.Application","Acme.Infrastructure","Acme.Api",
            "Microsoft.EntityFrameworkCore","Microsoft.AspNetCore")
        .GetResult();
    result.IsSuccessful.Should().BeTrue(string.Join(", ", result.FailingTypeNames));
}

[Fact]
public void Handlers_DoNotDependOnDbContext() { /* assert no AppDbContext dependency */ }
```

## Practices
- AAA in every test; one logical assertion focus per test.
- Names: `Method_Scenario_ExpectedOutcome`.
- Share setup via fixtures/`ICollectionFixture` and data builders — no copy-paste.
- Tests are order-independent and repeatable; no shared mutable state, no real
  clock/network unless containerized.
- FluentAssertions for all assertions.

## Checklist
- [ ] New behavior → unit tests. Cross-component → integration. Critical journey → E2E.
- [ ] External deps mocked (Moq/WireMock); real infra via Testcontainers.
- [ ] Fitness tests encode the constitution's `[GUARD]`s.
- [ ] `dotnet test` green before "done".
