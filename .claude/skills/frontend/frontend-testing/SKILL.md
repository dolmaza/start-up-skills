---
name: frontend-testing
description: >-
  Templates and rules for the frontend testing pyramid with Vitest + React Testing
  Library + MSW + Playwright: unit tests for hooks/utils/stores/schemas, component
  tests with mocked network, and E2E for critical journeys. Use when adding test
  coverage for any feature.
---

# Frontend Testing (the pyramid)

Constitution (when the project has one): `docs/frontend/ARCHITECTURE.md` §10. Test behavior, not implementation. Mock
only true externals (network via MSW). Every feature ships with tests.

## Unit — hooks, utils, stores, schemas (the bulk)
```ts
import { renderHook, waitFor } from "@testing-library/react";

test("useOrderList_sortsByDate_returnsOrdered", async () => {
  // Arrange (wrap with QueryClientProvider + MSW handler), Act, Assert
  const { result } = renderHook(() => useOrderList({ status: "open" }), { wrapper });
  await waitFor(() => expect(result.current.isLoading).toBe(false));
  expect(result.current.orders.map((o) => o.id)).toEqual(["b", "a"]);
});

test("orderSchema_rejectsNegativeTotal", () => {
  expect(orderSchema.safeParse({ id: "1", total: -5 }).success).toBe(false);
});
```

## Component — React Testing Library + MSW
```tsx
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

test("OrderList_whenRequestFails_showsErrorState", async () => {
  server.use(http.get("/orders", () => HttpResponse.json({}, { status: 500 })));
  render(<OrderList filters={{ status: "all" }} />, { wrapper });
  expect(await screen.findByRole("alert")).toHaveTextContent(/something went wrong/i);
});

test("PlaceOrderButton_onClick_submitsAndConfirms", async () => {
  render(<PlaceOrderForm />, { wrapper });
  await userEvent.type(screen.getByLabelText(/customer/i), "Acme");
  await userEvent.click(screen.getByRole("button", { name: /place order/i }));
  expect(await screen.findByText(/order placed/i)).toBeInTheDocument();
});
```
> Query by role/label/text (as a user would). Don't assert on internal state or
> snapshot large DOM trees.

## MSW handlers (shared)
```ts
export const handlers = [
  http.get("/orders", () => HttpResponse.json([{ id: "a" }, { id: "b" }])),
  http.post("/orders", () => HttpResponse.json({ id: "new" }, { status: 201 })),
];
export const server = setupServer(...handlers);  // started in setupTests.ts
```

## E2E — Playwright (critical journeys only)
```ts
test("user places an order end to end", async ({ page }) => {
  await page.goto("/orders");
  await page.getByRole("button", { name: "New order" }).click();
  await page.getByLabel("Customer").fill("Acme");
  await page.getByRole("button", { name: "Place order" }).click();
  await expect(page.getByText("Order placed")).toBeVisible();
});
```

Critical journeys run in **both a desktop and a mobile-viewport project**
(constitution §10 `[GUARD]`) — write role/label-based selectors that survive the
responsive transformations (a "Filter" Drawer button on mobile vs. an inline
toolbar on desktop):

```ts
// playwright.config.ts
projects: [
  { name: "desktop", use: { ...devices["Desktop Chrome"] } },
  { name: "mobile",  use: { ...devices["Pixel 7"] } },
],
```

## Practices
- AAA; deterministic, isolated, order-independent. No real network (MSW) in unit/
  component tests.
- Cover loading / empty / error / success for data-driven UI.
- Descriptive `Subject_Scenario_ExpectedOutcome` names; share `render` wrappers and
  fixtures — no copy-paste.

## Checklist
- [ ] New hook/util/store/schema → unit tests.
- [ ] New component → RTL tests with MSW covering error + success.
- [ ] Critical journey → a Playwright E2E, green on desktop **and** mobile
      viewport projects.
- [ ] `vitest run` + E2E green; queries are role/label based.
