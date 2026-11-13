import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'
import { loadModel } from './load.ts'
import { calculate, chooseTier, roundUp, type CostModel } from './model.ts'

const asset = (path: string) => fileURLToPath(new URL(`../../../assets/${path}`, import.meta.url))

test('roundUp_endingInNine_roundsUpToTheNextNine', () => {
  assert.equal(roundUp(42, 10, -1), 49)
  assert.equal(roundUp(49, 10, -1), 49)
  assert.equal(roundUp(49.5, 10, -1), 59)
  assert.equal(roundUp(101, 10, 0), 110)
  assert.equal(roundUp(0, 10, -1), 0)
})

// The prices New Room published from its own calculator on 2026-11-13 (references/worked-example.md).
const published: [number, number, number, number][] = [
  [1, 100, 429, 639],
  [3, 300, 149, 219],
  [5, 500, 209, 309],
  [10, 1000, 109, 169],
  [20, 2000, 59, 89],
  [50, 5000, 29, 49],
  [100, 10000, 19, 29],
]

test('newRoomExample_reproducesThePublishedPrices', async () => {
  const model = await loadModel(asset('examples/new-room.yaml'))
  for (const [customers, mau, minimum, target] of published) {
    const r = calculate(model, { customers, mau })
    assert.deepEqual([customers, r.minimum, r.target], [customers, minimum, target])
  }
})

test('newRoomExample_tenShops_pricedFromT4AheadOfT3', async () => {
  const model = await loadModel(asset('examples/new-room.yaml'))
  const r = calculate(model, { customers: 10, mau: 1000 })
  assert.equal(r.tier.id, 'T3')
  assert.equal(r.ahead.id, 'T4')
  assert.equal(r.managedDb, true)
  assert.ok(Math.abs(r.now.total - 83) < 1, `cost now ${r.now.total}`)
})

test('template_loadsAndComputes', async () => {
  const model = await loadModel(asset('cost-model.yaml'))
  model.tiers.forEach((tier, i) => Object.assign(tier, { monthly: 20 * (i + 1), capacity: 50 * (i + 1) }))
  const r = calculate(model, { customers: 3, mau: 300 })
  assert.ok(r.floorPrice > 0 && r.minimum >= r.floorPrice * 2)
})

function tiny(overrides: Partial<CostModel> = {}): CostModel {
  return {
    as_of: '2026-01-01',
    currency: { cost: 'USD', price: 'USD' },
    pricing: { price_one_tier_ahead: true, minimum_multiple: 2, target_multiple: 3, contingency: 0, round_step: 1, round_ending: 0 },
    fx: { rate: 1, buffer: 0 },
    tax: { turnover_tax: 0, small_business_limit: null, vat_rate: 0.2, vat_threshold: 1000, vat_registered: false },
    payment_fee: 0,
    payment_fee_fixed: 0,
    charges_per_month: 1,
    users: { dau_per_mau: 1, peak_share_of_dau: 1, upgrade_at: 1 },
    tiers: [
      { id: 'A', name: 'a', monthly: 10, capacity: 10, managed_db: false, measured: true },
      { id: 'B', name: 'b', monthly: 20, capacity: 20, managed_db: false, measured: true },
    ],
    data_safety: { hardening_monthly: 0, managed_db_from_customers: null },
    usage: [],
    ai: { per_customer: [], per_mau: [] },
    fixed: [],
    scenarios: { customers: [1], mau_per_customer: [1] },
    ...overrides,
  }
}

test('calculate_tierAhead_floorUsesTheNextTier', () => {
  const r = calculate(tiny(), { customers: 2, mau: 5 })
  assert.equal(r.tier.id, 'A')
  assert.equal(r.ahead.id, 'B')
  assert.equal(r.floorCost, 10) // 20 / 2
  assert.equal(r.minimum, 20)
  assert.equal(r.target, 30)
})

test('calculate_pastTheLadder_flagsIt', () => {
  const r = calculate(tiny(), { customers: 1, mau: 50 })
  assert.equal(r.pastLadder, true)
  assert.equal(r.ahead.id, 'B')
})

test('calculate_deductions_raiseTheFloor', () => {
  const model = tiny({ payment_fee: 0.1, pricing: { ...tiny().pricing, contingency: 0.15 } })
  const r = calculate(model, { customers: 1, mau: 1 })
  assert.ok(Math.abs(r.floorCost - 20 / 0.75) < 1e-9)
})

test('calculate_usage_flatPlanOnlyPastTheAllowance', () => {
  const email = { name: 'email', unit: 'emails', per_mau: 1, per_customer: 0, included: 100, over: { flat: 9 } }
  assert.equal(calculate(tiny({ usage: [email] }), { customers: 1, mau: 5 }).now.usage, 0)
  assert.equal(calculate(tiny({ usage: [email] }), { customers: 1, mau: 500, }).now.usageByItem.email, 9)
})

test('calculate_priceCurrencyFixedCost_convertedAtTheRate', () => {
  const model = tiny({ fx: { rate: 2, buffer: 0 }, fixed: [{ name: 'domain', monthly: 10, currency: 'price' }] })
  assert.equal(calculate(model, { customers: 1, mau: 1 }).now.fixed, 5)
})

test('calculate_vatThreshold_flaggedOnTurnover', () => {
  const r = calculate(tiny(), { customers: 10, mau: 5 })
  assert.equal(r.vatRequired, r.yearlyTurnover > 1000)
})

test('chooseTier_managedThreshold_switchesToManagedTiers', () => {
  const model = tiny({
    tiers: [...tiny().tiers, { id: 'M', name: 'm', monthly: 40, capacity: 20, managed_db: true, measured: true }],
    data_safety: { hardening_monthly: 3, managed_db_from_customers: 5 },
  })
  assert.equal(chooseTier(model, { customers: 4, mau: 1 }).tier.id, 'A')
  assert.equal(chooseTier(model, { customers: 5, mau: 1 }).tier.id, 'M')
  assert.equal(calculate(model, { customers: 4, mau: 1 }).now.infra, 13) // hardening on a plain tier
  assert.equal(calculate(model, { customers: 5, mau: 1 }).now.infra, 40)
})

test('calculate_fixedPaymentFee_addedPerCustomerBeforeDeductions', () => {
  const base = tiny({ payment_fee: 0.029, payment_fee_fixed: 0.3 })
  const r = calculate(base, { customers: 2, mau: 5 })
  assert.ok(Math.abs(r.floorCost - (10 + 0.3) / (1 - 0.029)) < 1e-9)
  const yearly = calculate({ ...base, charges_per_month: 1 / 12 }, { customers: 2, mau: 5 })
  assert.ok(Math.abs(yearly.fixedFeesPerCustomer - 0.025) < 1e-9)
})
