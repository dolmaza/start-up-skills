# OWASP Hardening Checklist

Walk this list for any auth/security work. The goal is **no known vulnerability
class left unaddressed**. Each item is either satisfied or explicitly justified as
not-applicable in the PR description. Mapped to OWASP API Security Top 10 (2023) +
ASVS essentials.

## Authentication
- [ ] Strong password policy + breached-password rejection where feasible.
- [ ] Passwords hashed with Argon2id / PBKDF2 (high iterations) / ASP.NET Identity
      default. Never reversible, never logged.
- [ ] Account lockout / exponential backoff after repeated failures (anti
      brute-force). Rate limit login, refresh, forgot/reset.
- [ ] Generic failure messages — no "user not found" vs "wrong password" (prevents
      **user enumeration**). Same for registration ("if the account exists…").
- [ ] MFA-ready (hook present even if not enabled).
- [ ] Password reset tokens: random, single-use, short TTL, stored **hashed**,
      invalidated after use or password change.

## Tokens & sessions (API2: Broken Authentication)
- [ ] Access tokens short-lived; refresh tokens rotated with reuse detection.
- [ ] JWT validation: issuer, audience, lifetime, signature, `alg` pinned
      (reject `none`/algorithm-confusion); asymmetric keys preferred.
- [ ] No secrets/PII in JWT payload (signed ≠ encrypted).
- [ ] Logout/revocation actually invalidates the refresh family.
- [ ] Signing keys from secret store; rotation supported; not in source/images.

## Authorization (API1/API3/API5: BOLA, BOPLA, BFLA)
- [ ] Object-level checks: a user can only access **their** resources
      (resource-based handler), not by guessing IDs (**no IDOR/BOLA**).
- [ ] Function-level: every privileged endpoint has a role/scope policy
      (**no broken function-level authZ**).
- [ ] Property-level: bind to explicit request DTOs; never bind to entities
      (**no mass assignment / over-posting**). Response DTOs omit sensitive fields.
- [ ] Server is the single source of truth for permissions; client claims not
      minted by this API are never trusted.

## Injection & input (API8)
- [ ] All SQL parameterized (EF + Dapper `@params`); zero string concatenation.
- [ ] Validate/normalize all input via FluentValidation before use.
- [ ] Output encoding; no reflected unsanitized input. JSON only, no HTML render.
- [ ] File uploads: type/size validation, store in S3 (not web root), scan/limit.
- [ ] Open-redirect protection: validate redirect URLs against an allow-list.

## Transport & headers
- [ ] HTTPS enforced + HSTS. TLS only.
- [ ] Security headers: CSP, `X-Content-Type-Options: nosniff`,
      `X-Frame-Options`/`frame-ancestors`, `Referrer-Policy`, `Permissions-Policy`.
- [ ] CORS: explicit origin allow-list; never `AllowAnyOrigin()` with credentials.
- [ ] Cookies (if used) `HttpOnly` + `Secure` + `SameSite`; CSRF protection for any
      cookie-based flow.

## Rate limiting & resource consumption (API4)
- [ ] Global + per-endpoint rate limiting (ASP.NET `RateLimiter`).
- [ ] Request size limits, pagination caps, query timeouts; guard expensive ops.

## Secrets, config & SSRF (API7)
- [ ] No secrets in source/images/logs; use env/secret manager.
- [ ] Outbound requests (OAuth, webhooks) validate target hosts (**anti-SSRF**).
- [ ] Security misconfiguration: prod disables detailed errors/Swagger as needed;
      default creds removed; least-privilege DB user.

## Logging, monitoring & data exposure (API3/API9/API10)
- [ ] Auth events (login success/fail, lockout, refresh reuse) logged + alerted.
- [ ] No sensitive data (passwords, tokens, PII, card data) in logs or traces
      (Serilog destructuring redaction).
- [ ] Inventory of exposed endpoints; deprecated/undocumented routes removed
      (**no improper inventory management**).
- [ ] Error responses generic to the client; full detail server-side only.

## Dependencies & supply chain
- [ ] Dependency vulnerability scan in CI (e.g. `dotnet list package --vulnerable`,
      Dependabot/`CodeQL`). Pin versions; fail build on critical CVEs.

## Verification
- [ ] Each control above has an automated test where feasible (authZ denial, token
      reuse revocation, idempotency replay, CORS preflight, enumeration-resistance).
- [ ] Run the repo's `/security-review` before declaring auth work done.
