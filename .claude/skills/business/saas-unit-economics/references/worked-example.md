# Worked example: New Room (Georgia, November 2026)

A 3D room visualizer and marketplace: shops pay a monthly subscription; shoppers design rooms with
real products and send order requests. One .NET API, a worker, Postgres, Redis and a Grafana stack
on one DigitalOcean Droplet; images on Spaces behind its CDN; AI on Claude (Sonnet for photo
analysis of products a shop adds from photos, Haiku for product descriptions). The filled model
file is `assets/examples/new-room.yaml`; the calculator's tests reproduce the prices below.

## What the codebase said

- Production cost $22 a month: s-1vcpu-2gb Droplet $12, Spaces $5, registry $5.
- AI used by shops and shoppers, with generous per-day limits in code; token usage recorded nowhere.
- No load test had ever run.

## Decisions taken

Infra + AI + tools (others at ₾0); marketplace attribution; tier ahead, ×2 / ×3, 15 % contingency;
k6 on clone Droplets, p95 < 500 ms and < 1 % errors; typical shopper AI with a $20 monthly cap;
individual entrepreneur at 1 % turnover tax, VAT flagged at ₾100,000; prices in GEL at the NBG
rate + 10 %; free plans and Claude Pro $20; hardening ($3.40) from the first paying shop, managed
Postgres from 5; YAML + calculator + an English page; DAU/MAU 20 %, peak 15 %, upgrade at 50 %.

## Measured

| What | Result |
|---|---|
| A photo analysis (Sonnet, 2 photos) | 14,350 input / 716 output tokens, $0.036 (≈ $0.08 with five photos) |
| A product description (Haiku) | ≈ $0.0002 |
| A session | 7–53 API requests, < 0.05 MB of API; 0.5–6 MB of images (production images ≈ 95 KB each) |
| T0 s-1vcpu-2gb, all on one box, $22 | 60 people at once (fails at 80: CPU) |
| T1 s-2vcpu-4gb, $34 | 160 (fails at 200: CPU) |
| T2 s-4vcpu-8gb, $58 | 280 (fails at 360: CPU) |
| T3 s-2vcpu-4gb + managed PG 1 GB via PgBouncer, $49 | 160 (fails at 200: the database) |
| Memory | 1.0–1.6 GB at peak on every size; never the limit |
| Cost of the four-tier test | ≈ $0.30 |

## Prices (minimum / target per shop a month, GEL, without VAT)

| Shops | MAU | Tier now → priced from | Cost now | Minimum | Target |
|---|---|---|---|---|---|
| 1 | 100 | T0 → T1 | $48 | ₾429 | ₾639 |
| 3 | 300 | T0 → T1 | $51 | ₾149 | ₾219 |
| 5 | 500 | T3 → T4 | $77 | ₾209 | ₾309 |
| 10 | 1,000 | T3 → T4 | $83 | ₾109 | ₾169 |
| 20 | 2,000 | T3 → T4 | $94 | ₾59 | ₾89 |
| 50 | 5,000 | T4 | $200 | ₾29 | ₾49 |
| 100 | 10,000 | T4 | $259 | ₾19 | ₾29 |

## What it said

- The number of shops set the price; users barely moved it ($0.03–0.16 per active user a month).
- One shop alone carried the box, Claude Pro and the hardening: ₾429. Below ₾150 from three shops.
- The managed-database step at 5 shops raised the floor at 5 above the floor at 3.
- The ladder past about 4,700 MAU was not measured yet; the calculator says so.
- VAT stayed far off in every scenario: spreading costs lowers each price.
