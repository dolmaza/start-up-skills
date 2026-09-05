---
name: provider-research
description: >-
  Method + report template for researching an external website or API as a data
  source: API-first discovery, rendering/network analysis, request verification
  with real captures, schema mapping, constraint probing, and the
  implementation-ready REPORT.md structure written under research/. Use whenever
  researching a website, API, or data provider for integration.
---

# Provider Research

Produces the research artifacts under `research/` that let a backend
implementation agent build a provider integration without re-investigating the
target. Applies equally to products, services, doctors, clinics, laboratories,
appointments — any entity a site exposes.

## Where output goes

```text
research/
└── <target-slug>/            # kebab-case site/provider name, e.g. psp-ge
    ├── REPORT.md             # the deliverable — template below
    ├── samples/              # real captured payloads (trimmed, redacted)
    │   ├── search-response.json
    │   └── details-response.json
    └── probes/               # throwaway scripts used to verify (optional)
```

## Method

### 1. Official-surface sweep (always first)

- Search for `<site> API`, `<site> developer`, `<site> integration docs`.
- Check `robots.txt` (also reveals disallowed areas — respect them) and
  `sitemap.xml` (reveals URL structure and entity pages).
- Probe conventional spots: `/api`, `/swagger`, `/swagger/v1/swagger.json`,
  `/openapi.json`, `/graphql`, `/.well-known/`.
- If an official API exists, research **it** — the site's HTML then only fills
  gaps the API doesn't cover.

### 2. Rendering & network analysis

- Compare raw HTML (`curl`) with the rendered page: if entities are present in
  the raw HTML, the site is SSR-scrapable; if not, data arrives via JS.
- Hunt embedded state in the HTML: `__NEXT_DATA__`, `window.__INITIAL_STATE__`,
  `__NUXT__`, JSON-LD `<script type="application/ld+json">` — often the whole
  payload without any API call.
- Grep the JS bundles for endpoint strings: `/api/`, `graphql`, `fetch(`,
  `axios`, base-URL constants. Bundles name the endpoints the UI calls.
- Exercise the site's search with a known entity and observe which request
  returns the data (browser network capture via Playwright when static
  analysis is not enough).
- For GraphQL: capture the operation names, queries, and variables the site
  itself sends; try introspection once — if disabled, say so in the report.

### 3. Verification rules

- An endpoint is documented only after reproducing it with `curl` and getting
  the expected data back.
- Reduce to **minimal headers**: strip headers one by one until the request
  breaks; the survivors are the required set. Note which matter
  (`User-Agent`? `Accept`? cookies? CSRF token? `Referer`?).
- Record the exact request — method, full URL, query params, payload, required
  headers — and save the real (trimmed) response under `samples/`.
- Redact personal data from samples; keep structure and one realistic example
  per field.
- Whatever could not be verified goes into the report as a labeled
  **hypothesis**, never presented as fact.
- Keep request volume minimal — single verification calls, spaced out; never
  bulk-download during research.

### 4. Schema mapping

- Enumerate every field the search/list response exposes, then diff against
  the details-page/endpoint response: the report must state per field where
  it comes from.
- Identify how variants are modeled (separate products vs. nested variants vs.
  attribute options): strength, form, quantity, package size.
- Find the stable unique identifier (internal ID, SKU, GTIN/EAN, barcode,
  slug) and note which identifier the details call is keyed by.
- Pin down pagination (page/offset/cursor; max page size), filtering,
  sorting, and search semantics (full-text? prefix? category-scoped?).

### 5. Constraint probing

- Auth: which calls work anonymously; where tokens/cookies come from (login
  flow, bootstrap request, meta tag) and their lifetime.
- Rate limits: `X-RateLimit-*` / `Retry-After` headers, observed 429s.
- Caching: `Cache-Control`, `ETag`/`Last-Modified`, CDN headers — how fresh
  the data is and what a polite refresh interval looks like.
- Anti-bot: CDN/WAF markers (Cloudflare, Akamai, DataDome), JS challenges,
  fingerprinting. Document as constraints only — evasion is never designed.

## REPORT.md template

Every section is filled or explicitly marked `N/A — <reason>`.

```markdown
# <Target> — extraction research report

- **Date:** YYYY-MM-DD   **Target:** <urls>   **Status:** verified | partial
- **Data of interest:** <products | doctors | appointments | …>

## 1. Website overview
Purpose; frontend framework; rendering mode (SSR/CSR/hybrid); backend hints;
official API availability.

## 2. Search flow
Endpoint, method, query params / payload, response format, auth requirements,
pagination strategy, sorting and filtering capabilities — with one verified
example request (exact curl) and a pointer to `samples/search-response.json`.

## 3. Data retrieval strategy
| Data | In search response? | Details page needed? | Extra calls? | JS needed? | Auth needed? |
|------|--------------------|---------------------|--------------|-----------|--------------|

## 4. Entity schema
| Field | Type | Source (search/details/extra call) | Example | Notes |
|-------|------|-------------------------------------|---------|-------|
Cover every available field: ID, name, brand, manufacturer, category,
description, images, price, discount, availability, strength, form, quantity,
barcode, attributes, specifications, reviews, ratings, related products —
or the service-entity equivalents. State how variants are represented and
which identifier is stable.

## 5. Network analysis
Endpoint inventory (REST/GraphQL/AJAX) with purpose per endpoint; required
headers; cookies; tokens and the auth flow that yields them; caching
behavior; rate limits; anti-bot mechanisms.

## 6. Recommended extraction strategy
Chosen rung of the ladder (official API → GraphQL → public JSON →
server-rendered HTML → JS-rendered HTML/Playwright), why it is the most
reliable and maintainable here, and why the rungs above it don't apply.

## 7. Implementation guidance
Search workflow and details-retrieval workflow step by step; every required
request with its expected response shape; data mapping recommendations onto
the project's model; normalization considerations (units, locales,
identifiers); error handling; retry strategy (what is retryable, backoff);
rate limiting strategy; caching recommendations.

## 8. Risks & volatility
What is likely to break (markup, endpoint versions, tokens), how an
implementation detects breakage early, and any legal/ToS constraints noted.

## 9. Open questions & hypotheses
Everything unverified, with what it would take to verify it.
```

## Success criterion

Another AI agent can implement the integration solely from `REPORT.md` +
`samples/`, without performing further investigation into the target.
