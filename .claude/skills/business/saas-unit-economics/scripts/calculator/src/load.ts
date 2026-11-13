import { readFile } from 'node:fs/promises'
import { parse } from 'yaml'
import type { CostModel } from './model.ts'

const required = ['as_of', 'currency', 'pricing', 'fx', 'tax', 'payment_fee', 'users', 'tiers', 'data_safety', 'usage', 'ai', 'fixed', 'scenarios']

/** Reads a cost-model.yaml, failing on a missing section or tier field rather than computing with gaps. */
export async function loadModel(path: string): Promise<CostModel> {
  const model = parse(await readFile(path, 'utf8')) as Record<string, unknown>
  const missing = required.filter((key) => !(key in model))
  if (missing.length > 0) throw new Error(`${path} lacks ${missing.join(', ')}`)
  for (const tier of model.tiers as Record<string, unknown>[]) {
    for (const key of ['id', 'monthly', 'capacity', 'managed_db']) {
      if (!(key in tier)) throw new Error(`${path}: tier ${String(tier.id)} lacks ${key}`)
    }
    tier.measured ??= true
  }
  for (const item of model.usage as Record<string, unknown>[]) {
    item.per_mau ??= 0
    item.per_customer ??= 0
    if (!item.over || typeof item.over !== 'object') throw new Error(`${path}: usage ${String(item.name)} lacks over (per_unit or flat)`)
  }
  const ai = model.ai as Record<string, unknown>
  ai.per_customer ??= []
  ai.per_mau ??= []
  model.payment_fee_fixed ??= 0
  model.charges_per_month ??= 1
  model.as_of = String(model.as_of instanceof Date ? model.as_of.toISOString().slice(0, 10) : model.as_of)
  return model as unknown as CostModel
}
