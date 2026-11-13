# Measuring: AI, sessions, capacity

## Contents

- AI: the usage ledger and the budget cap
- Session profiles
- Load testing each tier
- Cleanup checklist

## AI: the usage ledger and the budget cap

Most products call an LLM and record nothing about it. Before AI can be priced, every call must
leave a row.

**The ledger.** One table, one row per (day or month, model, purpose, payer) with counters added
to it (an upsert), rather than a row per call:

| Column | Notes |
|---|---|
| period | the day or month the usage falls in (UTC) |
| model | the exact model id |
| purpose | what the call is for (`photo_analysis`, `description`, `search`) |
| payer | who causes it: `platform`, `customer:<id>`, `user:<id>` (nullable ids; make the unique key treat nulls as equal, e.g. Postgres `NULLS NOT DISTINCT`) |
| requests, input_tokens, output_tokens, cache_read_tokens, cache_write_tokens | from the provider's usage object on every response |
| cost | computed at write time from a price table in configuration (per model: input, output, cache read, cache write per million tokens) |

Keep the price table in configuration, not code, so a price change is an edit. Record usage in the
provider wrapper (one place), not in each feature.

**The cap.** A monthly budget in configuration. Before a non-essential call, the wrapper sums the
month's cost; past the budget it returns a typed "budget reached" error, and background jobs defer
rather than fail. Add an alert at about 80 % of the budget, and set the provider console's own
spend limit as the last line.

**Metrics.** Counters for tokens and cost by model, purpose and payer type (no ids as labels:
cardinality), a dashboard with month-to-date cost against the budget, and the alert.

**Per-call cost for the model.** Run each AI feature for real a few times and read the ledger: the
cost of one call of each purpose is what the model file uses (`unit_cost`). Note what drives it.
Images in the prompt usually dominate (about 1,500 tokens per megapixel), so the number of images
per call matters more than the output length.

## Session profiles

Goal: what one session asks of the platform, per journey. Run the product's key journeys once
each, ideally the end-to-end tests, with a fixture that records the browser's traffic:

- requests and bytes to the API (compressed, as received);
- requests and bytes of files and images (storage/CDN), with caching on, as a real visitor sees it;
- AI calls made, from the ledger.

Exclude the test's own set-up calls. Run one read-only journey against production too: demo
images are often far smaller than real ones (in the worked example, 4.5×), which changes egress.

The result is a table per journey (requests, API MB, storage requests, storage MB) and a list of
what it says: which resource matters, MB per session (a range), the cost of each AI call.

## Load testing each tier

**Targets.** A temporary copy of production per tier: today's size and the next two or three
(bigger box; bigger box with a managed database). Same compose file and released images as
production, in their own private network, with production's data shape seeded by the test.
**Never production.**

**Generator.** A separate machine in the same region (k6 in a container), calling the API over the
private network. The CDN and edge cache are not what is measured; the box is.

**Override for the targets:**

- raise **every** rate limit, including anonymous/storefront ones: all virtual users come from one
  address, so per-IP limits throttle the whole test (it shows as 429s that look like errors, with
  nothing in the API's logs);
- replace the LLM with a fake provider (cost and latency of a real one is not what is measured);
- point object storage and mail at containers on the generator;
- no TLS proxy.

**Sessions.** One iteration = one person's session with 1.5–4.5 s think time between steps, so
virtual users = people at once. Mix from the profiles (e.g. 60 % browse, 30 % signed-in user, 10 %
customer admin). Tag set-up requests apart and exclude them.

**Levels.** Steps of a few minutes each (10, 20, 40, 60, 80, 120, 160 … people at once). Stop after
the first level that breaks the limit (p95 ≥ 500 ms or errors ≥ 1 %). For each level record
sessions a minute, requests a second, p95, p99, errors, and from the target: load average, memory,
swap and the CPU of each container. The figure kept is the last level that passed.

**Pitfalls seen in practice:**

- long runs must live on the generator (`nohup`), not in a local shell or a background watcher
  that can be killed;
- `pkill -f` over SSH matches its own shell: use a pattern like `'[l]evels.sh'`;
- the k6 container runs as its own user, so the results folder must be writable by it;
- a small managed Postgres accepts about 20 connections: put the app behind the provider's pooler
  (transaction mode) and let migrations connect directly, or the first run fails with
  "too many connections";
- a level that failed in set-up is not a pass: only count levels that actually ran requests.

**Output** (`docs/pricing/capacity.md`): per tier, the layout, monthly cost, passes at, fails at,
what broke (CPU, database, memory), then the same in MAU with D-11's ratios, what it means for the
ladder, the raw tables, and the cost of the test.

## Cleanup checklist

Billing runs by the hour, so tear down in the same session and prove it:

- tag every temporary resource (`<product>-loadtest`) and delete by tag;
- Droplets/VMs, volumes, managed databases, snapshots, load balancers, reserved IPs, firewalls;
- list each resource type afterwards and report what remains (only production should);
- local state files that hold generated passwords stay git-ignored.
