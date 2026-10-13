---
name: api-security
description: >-
  Templates and rules for securing the backend: JWT access + rotating refresh
  tokens, secure-by-default authorization (roles, scopes/permissions,
  resource-based policies), Google/Facebook OAuth (plus Sign in with Apple and
  the minimum-app-version gate when a mobile app exists), register/login/refresh/
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
g.MapPost("/login", Login).AllowAnonymous();                       // explicit opt-out
```
Health probes are **not** hand-written endpoints: they are ASP.NET Core Health
Checks routes (`MapHealthChecks("/alive")`, plus `/health` when readiness exists)
marked `.AllowAnonymous()` — see `containerization-cicd`.

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

## Mobile clients (only when the repo has a mobile app)

**Code exchange for native apps.** A mobile app signs in through the system
browser with PKCE and posts the result to the API — there is no cookie-based
redirect flow to lean on:

- `POST /auth/external/{provider}` with `{ code, codeVerifier, redirectUri }`
  (anonymous, rate-limited). `ExternalLoginCommand` exchanges the code at the
  provider's token endpoint **with the verifier**, validates the `id_token`
  (signature via the provider's JWKS, `iss`, `aud`, `exp`, `nonce`), then issues
  the API's own JWT pair.
- `redirectUri` must match an allow-list from configuration (one per app
  variant: `acme://`, `acme-preview://`, …) — never trust it blindly.
- Each platform has its own OAuth client ID at the provider; accept the set of
  configured audiences, not a single one.

**Sign in with Apple — required.** App Store Review Guideline 4.8: an iOS app
offering third-party login must offer an equivalent privacy-focused option.

- `POST /auth/external/apple` with `{ identityToken, fullName? }`. Validate the
  token against Apple's JWKS (`https://appleid.apple.com/auth/keys`):
  `iss = https://appleid.apple.com`, `aud =` the app's bundle identifier (one per
  variant), `exp`, signature.
- Key the user on Apple's stable `sub`. **Name and email arrive only on the
  first sign-in** — persist them then. The email may be a private relay
  address; never require a "real" one or use email as the join key.
- Apple requires that **account deletion** also revokes the Apple token
  (`/auth/revoke`) — implement it with the delete-account use case.

**Minimum supported app version.** Mobile requests carry `X-App-Version` and
`X-App-Platform`. A small middleware compares against
`MobileClients:MinimumVersion:{ios|android}` from configuration and
short-circuits with **`426 Upgrade Required`** (problem details, no body data)
when the client is older; requests without the headers (web, tools) pass.
Raising the minimum is a config change, not a deploy — and the reason an old
version is cut off is recorded.

**Device tokens for push (on demand).** `POST /devices` / `DELETE /devices/{id}`
store one push token per user + device; logout deletes it. Sending goes through
`IPushSender` from the Worker (constitution §4) — see `mobile-device-capabilities`.

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
- [ ] Mobile app exists → code+PKCE exchange endpoint with a redirect-URI
      allow-list, Sign in with Apple, `426` minimum-version gate, account
      deletion revoking provider tokens.
- [ ] Write endpoints idempotent via `Idempotency-Key` + Redis.
- [ ] CORS named policy with explicit origins; HTTPS + HSTS + security headers.
- [ ] Rate limiting on auth endpoints; generic auth errors (no enumeration).
- [ ] `reference/owasp-hardening.md` walked and every item satisfied/justified.
- [ ] Modern C# baseline applied — see `clean-architecture` skill.
