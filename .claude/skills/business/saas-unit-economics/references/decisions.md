# The twelve decisions

Ask them one at a time, each with your recommendation, and skip any the codebase already answers.
The defaults are what worked for a small B2B marketplace at launch (`worked-example.md`). They are
starting points: the "deviate when" line says what would change them.

**A default is what to propose, not what to apply.** Check each one against the product's stack
and data before using it. When the host does not offer it (no managed database at the provider),
or it does not fit (health data wants protection earlier, a product used once a month wants a
lower DAU/MAU), say so, pick the alternative, and record why. Never invent a price to make a
default fit: an assumed number must still be a real offering someone could buy.

Record the answers as a table in the plan (`| # | Question | Decision |`), D-01 to D-12.

## D-01 What the price covers

**Default:** infrastructure, AI and tools. Marketing, accounting, legal and the founder's pay are
lines at 0 in the model, filled in when they become real.

**Why:** the floor is about not losing money on running the product. Mixing in costs nobody pays
yet makes the number unfalsifiable. Keeping them as zero lines means they are one edit away.

**Deviate when:** the founder already pays any of those monthly. Then they are real costs today.

## D-02 Who causes which cost

**Default:** each paying customer carries its **direct** cost (its storage, the AI it triggers,
its onboarding spread over 12 months). Costs caused by end users are shared, split by each
customer's share of usage (views, orders, seats).

**Why:** it lets the model answer both "what does one customer cost" and "what does one active
user cost", and it still works if customers later bring their own traffic.

**Deviate when:** pure single-tenant SaaS with no shared end users: everything is per customer.

## D-03 Margin and growth

**Default:** price **one tier ahead**. **Minimum = floor × 2, target = floor × 3**, with a **15 %
contingency** taken off revenue before costs.

**Why:** infrastructure grows in steps. Pricing from the next tier means an upgrade is already
paid for when it becomes necessary. ×2 survives one customer leaving or one bad month; ×3 leaves
room for marketing and pay. The contingency covers what nobody priced yet.

**Deviate when:** the product is pre-revenue and the founder wants the bare break-even only (then
show the floor, and still compute ×2 next to it).

## D-04 How capacity is measured

**Default:** scripted journeys first (to learn the session), then a load test (k6 or similar) on
**temporary clones** of production at each tier, then production metrics after launch. The limit
is **API p95 < 500 ms and errors < 1 %**.

**Why:** capacity guessed from CPU counts is wrong in both directions. Clones keep production safe
and cost cents if destroyed in the same session.

**Deviate when:** the product already has real traffic near its limit. Production metrics
(latency against concurrent users) then beat a synthetic test.

## D-05 End-user AI

**Default:** price on **typical use**, not on the per-day limit. Protect against the worst case
with a **monthly AI budget cap** (an alert at a share, then a hard stop for non-essential calls),
the provider's console spend limit, and token metrics.

**Why:** pricing on the limit (e.g. 20 photo analyses a user a day) gives absurd prices. The cap is
what actually bounds the risk.

**Deviate when:** AI is the product (an AI writing tool): then AI per user is the main line and is
priced per seat or per credit, not spread.

## D-06 Tax

**Default:** ask the legal form. Model the turnover tax rate, the VAT rate and threshold, and any
small-business limit as **parameters**, with "confirm with an accountant" beside them. Prices are
shown **without VAT**; the model flags when 12-month turnover at the target passes the threshold.

**Why:** tax changes the floor (turnover tax is a deduction from revenue) and the price shown
(VAT added). Getting the regime wrong is the most expensive single mistake.

**Deviate when:** already VAT-registered: set the flag; show prices with VAT apart.

## D-07 Currency

**Default:** costs in the providers' currency (often USD), prices in the customers' currency,
converted at the central bank's official rate **plus a 10 % buffer**, rounded **up** to round
amounts (e.g. ending in 9).

**Why:** a weaker local currency raises every cost overnight. The buffer and an alert when the rate
moves past it keep the minimum honest between yearly reviews.

**Deviate when:** prices and costs are in the same currency: buffer 0.

## D-08 Tools

**Default:** free plans wherever possible. Paid tools the founder uses for the product (an AI
coding plan, design tools) are allocated 100 % to it. Each free plan's limit (emails a day, CI
minutes, storage, egress) is written down as a future step.

**Why:** small fixed costs dominate the floor when there are 1–5 customers.

## D-09 Data safety and the managed database

**Default:** cheap protection before the first paying customer (hourly dumps off the box with a
tested restore, the database on a block-storage volume, provider snapshots: a few dollars a month).
A **managed database at about 5 paying customers**, or earlier if load needs it.

**Why:** a paying customer's data loss is a business ending event; a managed database at zero
customers is a cost with no one to pay it. The threshold becomes a step in the ladder.

**Deviate when:** regulated data, or contracts promising an RPO/RTO: managed from day one.

**When the host has no managed database** (Hetzner, many VPS hosts): the step is either a
dedicated database server on the same host with backups off it and a tested restore, priced at the
host's real sizes, or moving the database to a provider that has one in the same region, priced
from that provider's page, with the latency and data-location cost said. Decide with the user.

## D-10 Where the model lives

**Default:** one YAML file (`docs/pricing/cost-model.yaml`) is the source of truth; a tested
calculator reads it and prints scenarios; an optional page with sliders reads the same functions.
Written in the language the founder and their advisors read.

**Why:** a spreadsheet drifts from the code and the measurements; a file in the repo with sources
beside each number is reviewed like code.

## D-11 Active users and the upgrade point

**Default:** define the active user precisely (opened the product in the month). **DAU/MAU 20 %**,
**peak 15 % of DAU** online at once, so about **3 % of MAU concurrent**. **Upgrade at 50 %** of the
measured capacity (a ×2 safety factor). Replace with real ratios after launch.

**Why:** the load test measures people at once; the business counts monthly users. These ratios
are the bridge, and they are the least known numbers, hence the safety factor.

**Deviate when:** the product is used in a daily burst (school hours, a shift): raise the peak share.

## D-12 Keep the method

**Default:** keep the method as a reusable skill and the numbers in the repository, so the next
product (or next year) starts from the checklist, not from memory.
