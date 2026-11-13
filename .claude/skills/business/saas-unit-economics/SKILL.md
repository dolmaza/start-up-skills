---
name: saas-unit-economics
description: Method for working out what a SaaS, marketplace or multi-tenant product costs to run and the least monthly subscription price per paying customer (shop, tenant, seat, workspace) that never runs at a loss, including after the infrastructure has to grow. Covers the cost pool, cost per active user and per customer, AI/LLM token cost metering and budget caps, session profiling, load testing for the capacity of each infrastructure tier, tier-ahead pricing, contingency, payment fees, turnover tax and VAT thresholds, currency (FX) buffers, data-safety steps, a YAML cost model with a tested calculator, and the monthly review after launch. Use it whenever someone asks how much to charge customers, what a minimum or break-even price is, what one user or tenant costs, whether a price covers hosting and AI, how many users a server can carry before an upgrade, or wants a pricing/unit-economics model, even if they only say "what should my subscription cost" or "is $X a month enough".
---

# SaaS unit economics: the least price per customer

The question this answers: **what is the lowest monthly price a paying customer can pay so that the
product never runs at a loss, today and after the next infrastructure upgrade?** Not the price to
charge (that is a market question), but the floor below which every price is a mistake.

Early products get this wrong in two predictable ways:

- **Pricing from hosting alone.** At launch the server costs a fraction of a cent per user, so
  "infra × 2" gives a meaningless number. Fixed costs (tools, protection, the box itself) and
  AI usage set the floor, and they are spread over very few paying customers.
- **Pricing from today's tier.** The first upgrade (a bigger box, a managed database) is a step,
  not a slope. A price that covers today's bill turns into a loss the month the upgrade is bought.

The method fixes both: measure what a session and a tier really cost, keep every number in one
file with its source, and price from the **next** tier, not the current one.

## Two modes

- **Quick check** ("is $15 enough?", "what should I charge?", numbers given in the message, no
  codebase to read): do step 0's cost-pool check on what the user wrote, then step 5 with their
  numbers: cost per customer, the floor, the ×2 minimum and ×3 target, how cost grows with usage
  (seats, calls, data), and the tax threshold. Use the calculator when there are tiers or several
  scenarios; plain arithmetic is fine for one. End with the three assumptions most worth measuring
  and say which phases (metering, profiling, load test) were skipped. Don't run the full procedure.
- **Full model** (a product and its repository are at hand, or the user wants the model built):
  the procedure below.

## The procedure

Work through these in order. Each phase leaves a file in the repository, so the model can be
rerun by anyone later. Phases 3–5 need the user's approval when they create billable resources.

### 0. Read before asking

Before any question, find out from the codebase and the cloud account:

- the current monthly bill, line by line (hosting, storage, registry, email, tools, domain);
- every place the product calls an LLM or another metered API: which model, what for, who triggers
  it (the customer, their end users, the platform), and the per-day limits in code;
- whether token usage is recorded anywhere (it usually is not);
- what monitoring exists (active users, request latency, host CPU);
- whether any load test has ever run.

Write these down as "what the codebase said". They decide which questions matter.

**Complete the cost pool.** A user's list of costs is rarely complete, and the missing line is
often the one that decides the answer. Walk through what the product does and ask, for each
function, what it must pay for that nobody mentioned:

- audio or video → speech-to-text, transcoding, storage of recordings;
- reminders, sign-ups, receipts → email and SMS (SMS is often the dearest line);
- uploads, images, documents → storage and egress, virus scanning;
- payments → the processor's percentage **and its fixed fee per charge**, payouts, chargebacks;
- search, maps, OCR, translation → per-call APIs;
- personal or health data → backups off the box, encryption, sometimes a DPA or EU hosting;
- the founder's own tools used for the product.

Each one becomes a cost line or an explicit "assumed 0 because …". Ask about the big ones rather
than assuming them away: in a meeting-notes product, transcription can cost more than everything
else together.

### 1. Settle the twelve decisions

`references/decisions.md` lists the twelve questions, each with a default, the reason for it and
when to deviate. Ask them **one at a time**, with your recommendation, and skip any the codebase
already answers. The answers go into a plan document (`docs/plans/cost-model.md` or similar) as a
decision table D-01 … D-12, followed by the formula and the phases. Get it approved before
building anything.

### 2. Meter the AI

AI is usually the only cost that grows per user, and most products cannot say what it costs.
Price it on the **current** models and list prices (look them up: the provider's pricing page,
or the `claude-api` skill for Claude); when the user doesn't say which model, price the current
one and show the price with the other likely one beside it. Before pricing it, record it: a usage ledger per call (model, tokens in/out, cache tokens, cost,
who pays), cost metrics, and a monthly budget cap that alerts then stops. Details and the shape
of the ledger are in `references/measuring.md` § AI.

### 3. Profile a session

Run the product's key user journeys once each (end-to-end tests are ideal) and record what one
session asks of the platform: API requests, bytes of API and of images/files, and AI calls with
their real token counts. The output is a short table per journey. It tells you which resource
matters (usually CPU and AI, rarely bandwidth) and gives the per-session numbers the model uses.
See `references/measuring.md` § Session profiles.

### 4. Load-test each tier

Capacity is measured, never guessed. Build a temporary copy of production at each tier of the
ladder (today's size and the next two or three), drive it with a scripted session mix until the
API's **p95 passes 500 ms or errors pass 1 %**, record "people at once" that passed, then destroy
everything. Production is never the target. A run of four tiers costs well under a dollar if torn
down promptly; say that cost up front and tear down in the same session. Method, pitfalls and the
cleanup checklist: `references/measuring.md` § Load testing.

### 5. Write the model file and run the calculator

Copy `assets/cost-model.yaml` into the repository (`docs/pricing/cost-model.yaml`) and fill it.
Every number carries its source and date beside it, or the word `assumption`. Then run the bundled
calculator against it:

```sh
cd <skill>/scripts/calculator && npm install
npm run calc -- --model /path/to/cost-model.yaml            # the scenario table
npm run calc -- --model /path/to/cost-model.yaml 10 1000    # 10 customers, 1,000 MAU, with the breakdown
npm test                                                    # the method's tests
```

Copy `scripts/calculator` into the repository too (e.g. `tools/cost-model`) when the project wants
to keep it; it has no dependency beyond `yaml`. Then write `docs/pricing/METHODOLOGY.md`: the
method in steps, today's scenario table, what it says in plain words, what to keep up to date,
and the assumptions not yet measured. An interactive page with sliders is a nice viewer, but it
must read the same functions and hold no numbers of its own.

### 6. Protect the data before the first paying customer

Paying customers change what a data loss costs. Before the first one: automated backups off the
box with a tested restore, the database on a volume that survives the server, provider snapshots.
A managed database comes later, at a customer count set in decision D-09, and its cost becomes a
step in the ladder. The model adds the protection cost from the first paying customer.

### 7. After launch: replace assumptions monthly

Each month: DAU/MAU and the peak share from analytics, AI cost from the ledger, egress from the
storage provider, then rerun the calculator. Review prices yearly, or when the currency moves past
the buffer or the capacity alert fires.

## The formula

```text
peak            = MAU × dau_per_mau × peak_share_of_dau            (≈ 3 % of MAU by default)
tier            = cheapest allowed tier with capacity × upgrade_at ≥ peak
ahead           = the next larger tier (the price is set from it)
cost(ahead)     = tier monthly + protection + usage over allowances + AI (customers + users) + tools + other
fixed fees      = fixed fee per payment × payments a month             (Stripe's 30c; 1/12 when billed yearly)
floor (cost cur)= (cost(ahead) / customers + fixed fees) / (1 − payment_fee − contingency − turnover_tax)
floor (price)   = floor × fx_rate × (1 + fx_buffer)
minimum         = round_up(floor × 2)        below it, one customer leaving is a loss
target          = round_up(floor × 3)        leaves room for marketing and pay
```

Prices are shown **without VAT**. The calculator flags when yearly turnover at the target passes
the VAT registration threshold, and when it passes a small-business tax limit.

## What the numbers usually say

These held for the worked example and are worth checking against any new product:

- **The number of paying customers sets the price; end users barely move it.** An active user
  costs cents a month. The first customers pay for the fixed costs, so the floor falls steeply from
  1 to 10 customers. Show that curve; it is the most useful thing the model tells a founder.
- **CPU runs out before memory** on small boxes running an API, a worker and Postgres.
- **A managed database is for data safety, not capacity** at small sizes; the smallest plans are
  often the new bottleneck, and they need a connection pooler.
- **A step at the managed-database threshold** can make the floor at N customers higher than at
  N−2. A package price set before then should already cover it.
- **AI cost is dominated by images in the prompt**, not by output. Smaller images are the lever.

## Outputs, checklist

- [ ] `docs/plans/cost-model.md`: what the codebase said, D-01…D-12, formula, phases
- [ ] AI usage ledger, cost metrics, budget cap with an alert (code + dashboard)
- [ ] `docs/pricing/session-profiles.md`: per-journey requests, bytes, AI calls
- [ ] `docs/pricing/capacity.md`: people at once per tier, what broke, cost of the test
- [ ] load-test kit in the repo, and **every temporary resource deleted** (list them to prove it)
- [ ] `docs/pricing/cost-model.yaml`: every number with a source or `assumption`
- [ ] calculator with tests, and `docs/pricing/METHODOLOGY.md` with today's scenario table
- [ ] data protection in place before the first paying customer

## Reference files

| File | Read when |
|---|---|
| `references/decisions.md` | step 1: the twelve questions, defaults and when to deviate |
| `references/measuring.md` | steps 2–4: AI ledger, session profiling, load-test method and pitfalls |
| `references/worked-example.md` | you want real numbers to compare against (New Room, Georgia, 2026) |
| `assets/cost-model.yaml` | step 5: the template model file, commented |
| `assets/examples/new-room.yaml` | a filled model file; the calculator's tests reproduce its published prices |
| `scripts/calculator/` | step 5: `calc` prints scenarios, `test` checks the method |
