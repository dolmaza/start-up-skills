// The scenario table of a cost model:
//   npm run calc -- --model path/to/cost-model.yaml              every scenario of the file
//   npm run calc -- --model path/to/cost-model.yaml 10 1000      10 customers, 1,000 MAU, with the breakdown
// Without --model it reads ./cost-model.yaml.
import { loadModel } from './load.ts'
import { calculate, scenarios, type Result } from './model.ts'

const args = process.argv.slice(2)
const at = args.indexOf('--model')
const path = at >= 0 ? args.splice(at, 2)[1] : 'cost-model.yaml'
const model = await loadModel(path)
const [customers, mau] = args.map(Number)

const { cost: costCur, price: priceCur } = model.currency
const money = (value: number, cur: string) => `${cur} ${value.toFixed(value < 10 ? 2 : 0)}`
const c = (value: number) => money(value, costCur)
const p = (value: number) => `${priceCur} ${Math.round(value).toLocaleString('en-US')}`
const count = (value: number) => Math.round(value).toLocaleString('en-US')
const flags = (r: Result) =>
  [
    r.pastLadder ? 'past the measured ladder' : '',
    r.noTierAhead && !r.pastLadder ? 'no tier ahead' : '',
    r.vatRequired ? 'VAT' : '',
    r.pastSmallBusiness ? 'past small-business limit' : '',
    r.ahead.measured ? '' : `${r.ahead.id} estimated`,
  ]
    .filter(Boolean)
    .join(', ')

if (customers && mau !== undefined && !Number.isNaN(mau)) {
  const r = calculate(model, { customers, mau })
  const line = (label: string, now: number, priced: number) => `  ${label.padEnd(18)} ${c(now).padStart(12)} ${c(priced).padStart(14)}`
  console.log(`${customers} customers, ${count(mau)} monthly active users (model of ${model.as_of})`)
  console.log(`Peak: ${r.peak.toFixed(1)} people at once. Tier now ${r.tier.id} (${r.tier.name}), priced from ${r.ahead.id}.`)
  console.log(`\n  ${'Monthly'.padEnd(18)} ${'now'.padStart(12)} ${'priced from'.padStart(14)}`)
  console.log(line('infrastructure', r.now.infra, r.priced.infra))
  for (const name of Object.keys(r.now.usageByItem)) console.log(line(`  ${name}`, r.now.usageByItem[name], r.priced.usageByItem[name]))
  console.log(line('AI, customers', r.now.aiCustomers, r.priced.aiCustomers))
  console.log(line('AI, users', r.now.aiUsers, r.priced.aiUsers))
  console.log(line('fixed', r.now.fixed, r.priced.fixed))
  console.log(line('total', r.now.total, r.priced.total))
  console.log(`\n  Per active user          ${c(r.perMau)} a month`)
  console.log(`  One customer's own cost  ${c(r.perCustomerDirect)} a month (its AI and usage)`)
  console.log(`  Deductions               ${(r.deductions * 100).toFixed(1)} % of revenue (fees, contingency, turnover tax)`)
  if (r.fixedFeesPerCustomer > 0) console.log(`  Fixed payment fees       ${c(r.fixedFeesPerCustomer)} a customer a month`)
  console.log(`  Floor per customer       ${c(r.floorCost)} = ${p(r.floorPrice)} with the FX buffer`)
  console.log(`  Minimum (×${model.pricing.minimum_multiple})             ${p(r.minimum)} a month`)
  console.log(`  Target (×${model.pricing.target_multiple})              ${p(r.target)} a month${r.vatRequired ? `, ${p(r.targetWithVat)} with VAT` : ''}`)
  console.log(`  Turnover at target       ${p(r.yearlyTurnover)} a year${flags(r) ? ` (${flags(r)})` : ''}`)
} else {
  console.log(`Cost model of ${model.as_of}: monthly prices per customer, in ${priceCur}, without VAT.\n`)
  console.log('| Customers | MAU | Peak at once | Tier now → priced from | Cost now / month | Per MAU | Floor | Minimum | Target | Notes |')
  console.log('|---|---|---|---|---|---|---|---|---|---|')
  for (const scenario of scenarios(model)) {
    const r = calculate(model, scenario)
    console.log(
      `| ${scenario.customers} | ${count(scenario.mau)} | ${r.peak.toFixed(1)} | ${r.tier.id} → ${r.ahead.id} | ${c(r.now.total)} | ${c(r.perMau)} | ${p(r.floorPrice)} | **${p(r.minimum)}** | ${p(r.target)} | ${flags(r)} |`,
    )
  }
}
