// The least price per paying customer, as pure functions: no file, no clock, no network, so the
// same code runs in the tests, the command line and any page with sliders. The numbers come from a
// cost-model.yaml (assets/cost-model.yaml is the template; load.ts reads it into a CostModel).

export interface Tier {
  id: string
  name: string
  /** Monthly cost of the whole layout, in the cost currency. */
  monthly: number
  /** People at once that passed the load test (p95 < 500 ms, errors < 1 %). */
  capacity: number
  managed_db: boolean
  /** false: the capacity is an estimate, not a measurement. */
  measured: boolean
}

/** A resource priced by use, with an allowance included in some plan. */
export interface UsageItem {
  name: string
  unit: string
  per_mau: number
  per_customer: number
  included: number
  /** Past the allowance: a price per unit, or a flat plan once any of it is exceeded. */
  over: { per_unit: number } | { flat: number }
}

/** An AI (or other metered API) cost: one call's cost × calls a month. */
export interface AiItem {
  name: string
  unit_cost: number
  units_per_month: number
}

export interface FixedItem {
  name: string
  monthly: number
  /** 'cost' (default) or 'price': a cost paid in the customers' currency, such as a local domain. */
  currency?: 'cost' | 'price'
}

export interface CostModel {
  as_of: string
  currency: { cost: string; price: string }
  pricing: {
    price_one_tier_ahead: boolean
    minimum_multiple: number
    target_multiple: number
    contingency: number
    round_step: number
    round_ending: number
  }
  fx: { rate: number; buffer: number }
  tax: {
    turnover_tax: number
    small_business_limit: number | null
    vat_rate: number
    vat_threshold: number | null
    vat_registered: boolean
  }
  payment_fee: number
  /** A fixed fee per payment (Stripe's 30c), in the price currency; 0 when none. */
  payment_fee_fixed: number
  /** Payments a customer makes a month: 1 for monthly billing, 1/12 for yearly. */
  charges_per_month: number
  users: { dau_per_mau: number; peak_share_of_dau: number; upgrade_at: number }
  tiers: Tier[]
  data_safety: { hardening_monthly: number; managed_db_from_customers: number | null }
  usage: UsageItem[]
  ai: { per_customer: AiItem[]; per_mau: AiItem[] }
  fixed: FixedItem[]
  scenarios: { customers: number[]; mau_per_customer: number[] }
}

export interface Scenario {
  /** Paying customers. */
  customers: number
  /** Monthly active users, all customers together. */
  mau: number
}

/** Monthly costs, in the cost currency. */
export interface Costs {
  infra: number
  usage: number
  aiCustomers: number
  aiUsers: number
  fixed: number
  total: number
  /** Each usage item's cost, by name. */
  usageByItem: Record<string, number>
}

export interface Result {
  scenario: Scenario
  peak: number
  tier: Tier
  ahead: Tier
  pastLadder: boolean
  noTierAhead: boolean
  managedDb: boolean
  now: Costs
  priced: Costs
  perMau: number
  perCustomerDirect: number
  deductions: number
  /** The fixed payment fees of one customer's month, in the cost currency. */
  fixedFeesPerCustomer: number
  floorCost: number
  floorPrice: number
  minimum: number
  target: number
  yearlyTurnover: number
  vatRequired: boolean
  targetWithVat: number
  pastSmallBusiness: boolean
}

/** Rounds up to a round amount: step 10 and ending −1 give 42 → 49, 49 → 49, 49.5 → 59. */
export function roundUp(value: number, step: number, ending: number): number {
  if (value <= 0) return 0
  return Math.ceil((value - ending) / step) * step + ending
}

export function peakConcurrent(model: CostModel, mau: number): number {
  return mau * model.users.dau_per_mau * model.users.peak_share_of_dau
}

/**
 * The tier the load needs: the cheapest allowed tier whose capacity at the upgrade point covers
 * the peak (the largest when none does), and the next larger one that the price is set from. With
 * a managed-database threshold, only plain tiers count below it and only managed ones from it.
 */
export function chooseTier(model: CostModel, scenario: Scenario) {
  const threshold = model.data_safety.managed_db_from_customers
  const managedDb = threshold !== null && scenario.customers >= threshold
  const allowed = model.tiers
    .filter((tier) => threshold === null || tier.managed_db === managedDb)
    .sort((a, b) => a.monthly - b.monthly || a.capacity - b.capacity)
  if (allowed.length === 0) throw new Error(`no tier with managed_db: ${managedDb}`)

  const peak = peakConcurrent(model, scenario.mau)
  const fits = allowed.find((tier) => tier.capacity * model.users.upgrade_at >= peak)
  const tier = fits ?? allowed.reduce((a, b) => (b.capacity > a.capacity ? b : a))
  const larger = allowed.find((candidate) => candidate.capacity > tier.capacity && candidate.monthly >= tier.monthly)
  const ahead = model.pricing.price_one_tier_ahead && larger ? larger : tier
  return { tier, ahead, pastLadder: fits === undefined, noTierAhead: larger === undefined, managedDb }
}

const sumAi = (items: AiItem[]) => items.reduce((sum, item) => sum + item.unit_cost * item.units_per_month, 0)

/** One customer's AI a month. */
export function aiPerCustomer(model: CostModel): number {
  return sumAi(model.ai.per_customer)
}

function usageCost(item: UsageItem, scenario: Scenario): number {
  const quantity = scenario.mau * item.per_mau + scenario.customers * item.per_customer
  const excess = quantity - item.included
  if (excess <= 0) return 0
  return 'flat' in item.over ? item.over.flat : excess * item.over.per_unit
}

function costs(model: CostModel, scenario: Scenario, tier: Tier): Costs {
  const infra = tier.monthly + (scenario.customers >= 1 && !tier.managed_db ? model.data_safety.hardening_monthly : 0)
  const usageByItem = Object.fromEntries(model.usage.map((item) => [item.name, usageCost(item, scenario)]))
  const usage = Object.values(usageByItem).reduce((sum, value) => sum + value, 0)
  const aiCustomers = scenario.customers * aiPerCustomer(model)
  const aiUsers = scenario.mau * sumAi(model.ai.per_mau)
  const fixed = model.fixed.reduce((sum, item) => sum + (item.currency === 'price' ? item.monthly / model.fx.rate : item.monthly), 0)
  const total = infra + usage + aiCustomers + aiUsers + fixed
  return { infra, usage, aiCustomers, aiUsers, fixed, total, usageByItem }
}

export function calculate(model: CostModel, scenario: Scenario): Result {
  if (scenario.customers < 1) throw new Error('a price per customer needs at least one customer')
  const { tier, ahead, pastLadder, noTierAhead, managedDb } = chooseTier(model, scenario)
  const now = costs(model, scenario, tier)
  const priced = costs(model, scenario, ahead)

  const deductions = model.payment_fee + model.pricing.contingency + model.tax.turnover_tax
  if (deductions >= 1) throw new Error('payment fee + contingency + turnover tax must stay under 100 %')
  const fixedFeesPerCustomer = (model.payment_fee_fixed * model.charges_per_month) / model.fx.rate
  const floorCost = (priced.total / scenario.customers + fixedFeesPerCustomer) / (1 - deductions)
  const floorPrice = floorCost * model.fx.rate * (1 + model.fx.buffer)
  const round = (value: number) => roundUp(value, model.pricing.round_step, model.pricing.round_ending)
  const minimum = round(floorPrice * model.pricing.minimum_multiple)
  const target = round(floorPrice * model.pricing.target_multiple)
  const yearlyTurnover = target * scenario.customers * 12

  const perCustomerUsage = model.usage.reduce(
    (sum, item) => sum + (item.per_customer > 0 && now.usageByItem[item.name] > 0 ? now.usageByItem[item.name] / scenario.customers : 0),
    0,
  )
  return {
    scenario,
    peak: peakConcurrent(model, scenario.mau),
    tier,
    ahead,
    pastLadder,
    noTierAhead,
    managedDb,
    now,
    priced,
    perMau: scenario.mau > 0 ? now.total / scenario.mau : 0,
    perCustomerDirect: aiPerCustomer(model) + perCustomerUsage,
    deductions,
    fixedFeesPerCustomer,
    floorCost,
    floorPrice,
    minimum,
    target,
    yearlyTurnover,
    vatRequired: model.tax.vat_registered || (model.tax.vat_threshold !== null && yearlyTurnover > model.tax.vat_threshold),
    targetWithVat: target * (1 + model.tax.vat_rate),
    pastSmallBusiness: model.tax.small_business_limit !== null && yearlyTurnover > model.tax.small_business_limit,
  }
}

/** Every scenario of the model file: each customer count with each number of users a customer brings. */
export function scenarios(model: CostModel): Scenario[] {
  return model.scenarios.customers.flatMap((customers) =>
    model.scenarios.mau_per_customer.map((perCustomer) => ({ customers, mau: customers * perCustomer })),
  )
}
