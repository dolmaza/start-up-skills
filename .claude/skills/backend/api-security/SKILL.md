---
name: api-security
description: >-
  Templates and rules for securing the backend: JWT access + rotating refresh
  tokens, secure-by-default authorization (roles, scopes/permissions,
  resource-based policies), Google/Facebook OAuth, register/login/refresh/
  password-recovery flows, write-endpoint idempotency, CORS, and OWASP hardening.
  Use whenever adding authentication, authorization, or security controls.
---

# API Security (AuthN · AuthZ · Hardening)

Constitution (when the project has one): `docs/backend/ARCHITECTURE.md` §9. The API is protected **by default**; anonymous
is an explicit, justified allow-list. For the full vulnerability checklist see
`reference/owasp-hardening.md`.

## Interfaces (declared in Application)
```csharp
public interface ITokenService
{
    AccessToken IssueAccessToken(UserId userId, IReadOnlyCollection<string> roles, IReadOnlyCollection<string> scopes);
    RefreshToken IssueRefreshToken(UserId userId, string deviceId);
    Result<ClaimsPrincipal> Validate(string accessToken);
}
public interface IIdentityService            // wraps ASP.NET Core Identity (Infra)
{
    Task<Result<UserId>> RegisterAsync(string email, string password, CancellationToken ct);
    Task<Result<UserId>> ValidateCredentialsAsync(string email, string password, CancellationToken ct);
    Task<Result<UserId>> FindOrCreateExternalAsync(ExternalLogin login, CancellationToken ct);
}
public interface ICurrentUser                // ambient identity for handlers
{ UserId Id { get; } bool IsAuthenticated { get; } IReadOnlySet<string> Scopes { get; } }
public interface IRefreshTokenStore          // rotation + reuse detection
{
    Task StoreAsync(RefreshToken token, CancellationToken ct);          // store HASH only
    Task<Result<RefreshToken>> ConsumeAsync(string raw, CancellationToken ct);
    Task RevokeFamilyAsync(Guid familyId, CancellationToken ct);
}
public interface IPasswordResetService
{ Task<Result> RequestAsync(string email, CancellationToken ct);
  Task<Result> ResetAsync(string email, string token, string newPassword, CancellationToken ct); }
```

## Secure-by-default authorization (Presentation)
```csharp
builder.Services.AddAuthentication(JwtBearerDefaults.AuthenticationScheme)
    .AddJwtBearer(o =>
    {
        o.TokenValidationParameters = new()
        {
            ValidateIssuer = true,   ValidIssuer   = cfg["Jwt:Issuer"],
            ValidateAudience = true, ValidAudience = cfg["Jwt:Audience"],
            ValidateLifetime = true, ClockSkew = TimeSpan.FromMinutes(1),
            ValidateIssuerSigningKey = true,
            IssuerSigningKey = SigningKeys.Public(cfg),   // RS256/ES256 public key
        };
    })
    .AddGoogle(o => { o.ClientId = cfg["OAuth:Google:ClientId"]!;     o.ClientSecret = cfg["OAuth:Google:Secret"]!; })
    .AddFacebook(o => { o.AppId   = cfg["OAuth:Facebook:AppId"]!;     o.AppSecret    = cfg["OAuth:Facebook:Secret"]!; });

builder.Services.AddAuthorizationBuilder()
    // GUARD: deny by default — everything requires an authenticated user unless AllowAnonymous
    .SetFallbackPolicy(new AuthorizationPolicyBuilder().RequireAuthenticatedUser().Build())
    .AddPolicy("orders:write", p => p.RequireClaim("scope", "orders:write"))
    .AddPolicy("Admin",        p => p.RequireRole("Admin"));
```
Pipeline order matters: `UseCors` → `UseAuthentication` → `UseAuthorization`.

### Endpoint usage (Minimal API)
```csharp
g.MapPost("/", PlaceOrder).RequireAuthorization("orders:write");   // scope policy
g.MapGet("/health", () => TypedResults.Ok()).AllowAnonymous();     // explicit opt-out
```

### Scopes / roles / resource-based
- **Scope/permission**: `RequireClaim("scope", "orders:write")` — prefer these
  fine-grained policies over roles.
- **Role**: `RequireRole("Admin")` for coarse buckets.
- **Resource-based** (ownership/tenant): inject `IAuthorizationService` and call
  `await authz.AuthorizeAsync(user, order, "SameOwner")` inside the handler, backed
  by an `AuthorizationHandler<SameOwnerRequirement, Order>`.

## Token issuance & refresh rotation (Infrastructure)
```csharp
// Access token: short-lived (15 min), claims = sub + roles + scopes. Sign RS256.
// Refresh token: opaque 256-bit random, returned to client, stored HASHED with a
// familyId. On refresh:
public sealed class RefreshTokenService(IRefreshTokenStore store, ITokenService tokens)
{
    public async Task<Result<TokenPair>> RefreshAsync(string rawRefresh, CancellationToken ct)
    {
        var consumed = await store.ConsumeAsync(rawRefresh, ct);   // marks old token used
        if (consumed.IsFailure) return Result.Failure<TokenPair>(AuthErrors.InvalidRefresh);
        if (consumed.Value.AlreadyUsed)                            // REUSE DETECTED
        {
            await store.RevokeFamilyAsync(consumed.Value.FamilyId, ct);   // nuke the family
            return Result.Failure<TokenPair>(AuthErrors.RefreshReuseDetected);
        }
        var access  = tokens.IssueAccessToken(consumed.Value.UserId, roles, scopes);
        var refresh = tokens.IssueRefreshToken(consumed.Value.UserId, consumed.Value.DeviceId); // same family
        await store.StoreAsync(refresh, ct);
        return Result.Success(new TokenPair(access, refresh));
    }
}
```

Generate and store it with the framework primitives — never hand-rolled crypto:
```csharp
var raw    = RandomNumberGenerator.GetHexString(64);        // 256 bits of entropy (.NET 9+)
var hashed = CryptographicOperations.HashData(              // one-shot SHA-256 (.NET 8+)
                 HashAlgorithmName.SHA256, Encoding.UTF8.GetBytes(raw));
// Look-ups compare with CryptographicOperations.FixedTimeEquals(a, b) — never `==`.
```

## Auth flows (CQRS commands → thin endpoints, all return `Result`)
`RegisterCommand` · `LoginCommand` · `RefreshTokenCommand` · `LogoutCommand`
(revoke family) · `ForgotPasswordCommand` (email a hashed, single-use, short-TTL
token) · `ResetPasswordCommand`. OAuth: `ExternalLoginCommand` verifies the
provider `id_token`/code **server-side**, provisions/links the user, then issues
the API's **own** JWT pair (never reuse the provider token as the access token).
> GUARD: auth failures return a **generic** message ("invalid credentials") — never
> reveal whether the email exists (no user enumeration).

## Idempotency for writes (Redis)
```csharp
// Endpoint filter on POST/PUT/PATCH/DELETE: read "Idempotency-Key" header.
// key = hash(idempotencyKey + route + userId)
//   - cache MISS → run handler, store {statusCode, body} with TTL, return it
//   - cache HIT  → return stored response WITHOUT re-running the command
//   - in-flight  → 409 Conflict (a duplicate is still processing)
// Missing header on a write → 400 (require it) per policy.
```

## CORS (named policy from config)
```csharp
builder.Services.AddCors(o => o.AddPolicy("Default", p => p
    .WithOrigins(cfg.GetSection("Cors:Origins").Get<string[]>()!)   // explicit list
    .WithMethods("GET","POST","PUT","PATCH","DELETE")
    .WithHeaders("Authorization","Content-Type","Idempotency-Key")
    .AllowCredentials()));   // GUARD: never combine AllowCredentials with AllowAnyOrigin
```

## Checklist
- [ ] Fallback policy = `RequireAuthenticatedUser()`; anonymous endpoints are an
      explicit, justified allow-list.
- [ ] JWT validated (issuer/audience/lifetime/signature); signing key from secrets.
- [ ] Refresh tokens hashed at rest, rotated on use, family revoked on reuse.
- [ ] Roles + scope policies + resource-based handlers available and applied.
- [ ] Register/login/refresh/logout/forgot/reset + Google & Facebook OAuth exposed.
- [ ] OAuth provider token verified server-side; API issues its own JWT.
- [ ] Write endpoints idempotent via `Idempotency-Key` + Redis.
- [ ] CORS named policy with explicit origins; HTTPS + HSTS + security headers.
- [ ] Rate limiting on auth endpoints; generic auth errors (no enumeration).
- [ ] `reference/owasp-hardening.md` walked and every item satisfied/justified.
- [ ] Modern C# baseline applied — see `clean-architecture` skill.
