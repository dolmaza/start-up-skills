---
name: llm-provider-abstraction
description: >-
  Patterns for embedding LLMs/agents in the product without vendor lock-in:
  ILlmProvider/ILlmAgent interfaces, swappable providers (Gemini/Claude/OpenAI),
  native C# tools for deterministic steps, and bounded system prompts. Use when
  building AI features into the generated backend.
---

# LLM Provider Abstraction

Constitution (when the project has one): `docs/backend/ARCHITECTURE.md` §5. No vendor SDK in Domain/Application. Push
deterministic work into code; the agent only orchestrates.

## Interfaces (declared inward, in Application)
```csharp
public interface ILlmProvider
{
    Task<Result<string>> CompleteAsync(LlmRequest request, CancellationToken ct);
    Task<Result<T>> CompleteStructuredAsync<T>(LlmRequest request, CancellationToken ct);
}

public interface ILlmTool                 // a deterministic, code-backed capability
{
    string Name { get; }
    string JsonSchema { get; }            // describes inputs to the model
    Task<Result<string>> InvokeAsync(string argumentsJson, CancellationToken ct);
}

public interface ILlmAgent                // high-level orchestrator
{
    Task<Result<AgentOutcome>> RunAsync(AgentContext context, CancellationToken ct);
}
```

## Provider implementations (Infrastructure, chosen by config)
```csharp
// appsettings: "Llm:Provider": "Claude" | "Gemini" | "OpenAI"
s.AddSingleton<ILlmProvider>(sp => cfg["Llm:Provider"] switch
{
    "Claude" => new ClaudeProvider(/* SDK */),
    "Gemini" => new GeminiProvider(/* SDK */),
    _        => new OpenAiProvider(/* SDK */),
});
```
Swapping providers is a config change — no business code touches a vendor type.

## Deterministic tooling first
Before letting the model produce something, ask: *can code do this?* If yes, build
an `ILlmTool` and expose it. The model decides *whether/when* to call it; code does
the work.
```csharp
public sealed class GetInvoiceTotalsTool : ILlmTool   // code fetches/computes — model does not guess
{
    public string Name => "get_invoice_totals";
    public string JsonSchema => /* { invoiceId: string } */;
    public async Task<Result<string>> InvokeAsync(string argsJson, CancellationToken ct)
        => /* query read model, return JSON totals */;
}
```

## Bounded system prompts
- State the agent's concrete objective, allowed tools, and explicit out-of-scope
  list. No open-ended "be helpful".
- Require structured output; validate it (`CompleteStructuredAsync<T>` + a
  validator) before it touches domain state — bad output returns `Result.Failure`.
- Control cost/non-determinism: low temperature for structured steps, cache
  deterministic tool results, prefer tools over free-form generation.

## Checklist
- [ ] No vendor SDK type in Domain/Application.
- [ ] Provider selected by configuration; swap requires no code change.
- [ ] Every code-expressible step is a tool, not a model guess.
- [ ] System prompt has concrete objective + explicit boundaries.
- [ ] Model output validated before use; failure path returns `Result`.
