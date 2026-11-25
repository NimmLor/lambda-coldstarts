/**
 * A fixed piece of plain-JS work, the kind a handler does between parsing its event and answering:
 * build records, filter, sort and group them, serialize the result, over and over. Each pass works
 * on records of its own, so it takes CPU time without taking more memory: Node.js keeps ~75 MB of
 * its 128 MB smallest size for itself, and a bigger data set would measure the garbage collector
 * under pressure, or run out. It measures the engines, not
 * their startup: V8's and JavaScriptCore's JITs, an `--aot` build's native code, QuickJS's
 * interpreter. Nothing here runs at module evaluation, so `startupMs` and Init Duration stay the
 * hello world's.
 *
 * Only built-ins every runtime has, and no imports: `node:crypto` or `Intl` would
 * keep more of Bun in a `--trim` build. The records come from a seeded PRNG rather than embedded
 * data, so no variant's package grows, and every amount is whole cents, so every engine computes
 * the same digest.
 */

/** What a request asks for unless it says otherwise: records per pass, and passes. */
export const WORK_RECORDS = 2000
/**
 * Enough that compute outweighs the request fee in what a call at 1769 MB costs: one pass took
 * Bun's AOT build ~2 ms there, so short that the fee and Lambda's rounding up to the millisecond
 * made most of the bill. LLRT at 128 MB takes ~1.7 s, well inside the functions' 10 s timeout.
 */
export const WORK_PASSES = 10
/** `runWork(WORK_RECORDS, WORK_PASSES)`, which src/perf/measure.ts checks every answer against. */
export const WORK_DIGEST = 1_292_233_601

/** The Function URLs are public: no request runs a function for longer than these allow. */
const MAX_RECORDS = 20_000
const MAX_PASSES = 20

const REGIONS = ['eu-central-1', 'eu-west-1', 'us-east-1', 'us-west-2', 'ap-southeast-2']
const CATEGORIES = ['books', 'games', 'garden', 'music', 'tools', 'toys']

/** mulberry32: small, fast, and the same sequence on every engine. */
const random = (seed: number) => () => {
  seed = (seed + 0x6d2b79f5) | 0
  let t = Math.imul(seed ^ (seed >>> 15), seed | 1)
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296
}

/** FNV-1a of a string's UTF-16 code units. */
const fnv1a = (text: string) => {
  let hash = 0x811c9dc5
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193)
  }
  return hash >>> 0
}

type Order = {
  id: string
  region: string
  category: string
  quantity: number
  priceCents: number
  totalCents: number
  tags: string[]
}

type Group = {
  region: string
  orders: number
  totalCents: number
  categories: Record<string, number>
}

/** A whole number from a request, within `[1, max]`; `fallback` for anything else. */
const countOf = (value: unknown, max: number, fallback: number) => {
  const n = Number(value)
  return Number.isInteger(n) && n > 0 ? Math.min(n, max) : fallback
}

/** How many records per pass a request asks for, within bounds; the default for anything else. */
export const recordsOf = (value: unknown) => countOf(value, MAX_RECORDS, WORK_RECORDS)

/** How many passes a request asks for, within bounds; the default for anything else. */
export const passesOf = (value: unknown) => countOf(value, MAX_PASSES, WORK_PASSES)

/** `passes` passes of `records` records each; the digest of all their results. */
export const runWork = (records: number, passes: number) => {
  let digest = 0
  for (let pass = 0; pass < passes; pass++) {
    digest = Math.imul(digest ^ runPass(records, records * MAX_PASSES + pass), 0x01000193) >>> 0
  }
  return digest
}

/**
 * Builds `records` orders from `seed`, keeps the larger ones, ranks and groups them; the digest of
 * the result.
 */
const runPass = (records: number, seed: number) => {
  const next = random(seed)
  const orders: Order[] = []
  for (let i = 0; i < records; i++) {
    const quantity = 1 + Math.floor(next() * 9)
    const priceCents = 99 + Math.floor(next() * 50_000)
    const tags: string[] = []
    if (next() < 0.3) tags.push('gift')
    if (next() < 0.1) tags.push('express')
    orders.push({
      id: `order-${(i * 7919).toString(36)}`,
      region: REGIONS[Math.floor(next() * REGIONS.length)]!,
      category: CATEGORIES[Math.floor(next() * CATEGORIES.length)]!,
      quantity,
      priceCents,
      totalCents: quantity * priceCents,
      tags,
    })
  }

  const large = orders.filter((o) => o.totalCents >= 5_000 && o.tags.indexOf('express') === -1)
  // By total, then id, so ties come out the same on every engine.
  large.sort((a, b) => b.totalCents - a.totalCents || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))

  const groups: Record<string, Group> = {}
  for (const order of large) {
    const group = (groups[order.region] ??= {
      region: order.region,
      orders: 0,
      totalCents: 0,
      categories: {},
    })
    group.orders += 1
    group.totalCents += order.totalCents
    group.categories[order.category] = (group.categories[order.category] ?? 0) + order.quantity
  }

  const result = {
    records,
    kept: large.length,
    top: large
      .slice(0, 20)
      .map((o) => ({ id: o.id, totalCents: o.totalCents, tags: o.tags.join(',') })),
    groups: Object.keys(groups)
      .sort()
      .map((region) => groups[region]),
  }
  // The whole result, serialized, so no engine can skip any of the work behind it.
  return fnv1a(JSON.stringify(orders).length + JSON.stringify(result))
}
