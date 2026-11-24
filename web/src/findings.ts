/**
 * The glance's finding cards: one sentence per tab, worked out from the runs, so the highlights
 * stay true as the numbers move. Each returns undefined when the runs can't say it.
 */
import { type Figures, FAMILY_NAMES, type Fn, geomeanOf, isEvent } from './data'
import type { TabId } from './tabs'

/** Where the glance compares: arm64, Lambda's default architecture, at 256 MB. */
export const GLANCE = { arch: 'arm64', memoryMb: 256 } as const

/** What the glance measures the others against: the newest Node.js out of preview. */
export const BASELINE = 'Node24'

/** Bun's trimmed AOT executable, which the glance sets beside Bun as a runtime. */
const AOT = 'BunCompileAotTrim'

/** The functions the glance compares, by variant. */
const COMPARED = ['Llrt', BASELINE, 'BunRuntimeCmr', AOT]

/**
 * A finding drawn small: bars to compare by length, or a line per family over the memory sizes.
 * `label` says what it shows to someone who can't see it.
 */
export type Mark =
  | { kind: 'bars'; label: string; bars: { name: string; value: number; color: string }[] }
  | {
      kind: 'lines'
      label: string
      /** What the lines start and end at, e.g. `128 MB`. */
      from: string
      to: string
      lines: { name: string; values: number[] }[]
    }

export type Finding = { tab: TabId; title: string; figure: string; sub: string; mark?: Mark }

/** Below this, a difference is noise: run means move by a few percent on their own. */
const NOTABLE = 1.15

const atGlance = (f: Fn) => f.arch === GLANCE.arch && f.memoryMb === GLANCE.memoryMb

/** The functions of `functions` the glance compares. */
export const compared = (functions: Fn[]) =>
  functions.filter((f) => COMPARED.includes(f.base) && atGlance(f))

/**
 * arm64 against x86_64: the geometric mean of x86_64's cold start over arm64's across every Event
 * Function at every size, the cost per cold start at the glance's size, and where x86_64's warm
 * start is ahead.
 */
export const archFinding = (
  functions: Fn[],
  figures: Map<string, Figures>
): Finding | undefined => {
  const pairs = functions.flatMap((arm) => {
    if (!isEvent(arm) || arm.arch !== 'arm64') return []
    const x86 = functions.find(
      (f) => f.arch === 'x86_64' && f.base === arm.base && f.memoryMb === arm.memoryMb
    )
    const a = figures.get(arm.id)
    const x = x86 && figures.get(x86.id)
    return a && x ? [{ memoryMb: arm.memoryMb, a, x }] : []
  })
  const cold = geomeanOfPairs(pairs, 'cold')
  if (cold === undefined) return undefined
  const cost = geomeanOfPairs(
    pairs.filter((p) => p.memoryMb === GLANCE.memoryMb),
    'cost'
  )
  const memories = [...new Set(pairs.map((p) => p.memoryMb))].sort((a, b) => a - b)
  // Sizes where x86_64's warm start is more than 5% ahead.
  const behind = memories.filter((mb) => {
    const r = geomeanOfPairs(
      pairs.filter((p) => p.memoryMb === mb),
      'warm'
    )
    return r !== undefined && r < 1 / 1.05
  })
  const percent = cost === undefined ? undefined : Math.round((1 - 1 / cost) * 100)
  const faster = cold >= 1 ? 'arm64' : 'x86_64'
  const times = (cold >= 1 ? cold : 1 / cold).toFixed(1)
  return {
    tab: 'arch',
    title:
      `${faster} cold-starts ${times}× as fast` +
      (percent === undefined
        ? ''
        : `${faster === 'arm64' ? ' and' : '; arm64'} costs ${Math.abs(percent)}% ${percent >= 0 ? 'less' : 'more'}`),
    figure: `${times}×`,
    sub: !behind.length
      ? 'Warm, arm64 is as fast or faster at every memory size.'
      : behind.length === memories.length
        ? 'But x86_64 has the faster warm start at every memory size.'
        : `But x86_64 has the faster warm start at ${behind.join(', ')} MB.`,
    mark: {
      kind: 'bars',
      label: `How long a cold start takes: on x86_64, ${cold.toFixed(1)}× as long as on arm64`,
      bars: [
        { name: 'arm64', value: 1, color: 'var(--color-arch-arm)' },
        { name: 'x86_64', value: cold, color: 'var(--color-arch-x86)' },
      ],
    },
  }
}

/** The geometric mean of x86_64's `key` over arm64's across `pairs`. */
const geomeanOfPairs = (
  pairs: { a: Figures; x: Figures }[],
  key: keyof Figures
): number | undefined => {
  const ratios = pairs.flatMap(({ a, x }) => {
    const arm = a[key]
    const x86 = x[key]
    return typeof arm === 'number' && typeof x86 === 'number' && arm > 0 && x86 > 0
      ? [x86 / arm]
      : []
  })
  return ratios.length
    ? Math.exp(ratios.reduce((sum, r) => sum + Math.log(r), 0) / ratios.length)
    : undefined
}

/**
 * The customer-managed runtime that moves the first answer most against the variant it repackages,
 * at the glance's size; and for Bun, its trimmed AOT executable's beside the two.
 */
export const runtimeFinding = (
  functions: Fn[],
  figures: Map<string, Figures>
): Finding | undefined => {
  let most: { f: Fn; against: Fn; before: number; after: number } | undefined
  for (const f of functions.filter((f) => f.cmr && atGlance(f))) {
    const against = functions.find(
      (c) => c.base === f.cmr!.counterpart && c.arch === f.arch && c.memoryMb === f.memoryMb
    )
    const before = against && figures.get(against.id)?.trip
    const after = figures.get(f.id)?.trip
    if (!against || before === undefined || after === undefined) continue
    if (!most || Math.abs(Math.log(after / before)) > Math.abs(Math.log(most.after / most.before)))
      most = { f, against, before, after }
  }
  if (!most || Math.abs(Math.log(most.after / most.before)) < Math.log(NOTABLE)) return undefined
  const { f, against, before, after } = most
  const times = before / after
  // The custom runtime's own name, which can name another version than its counterpart: Node.js
  // 27 alpha against Node.js 24.
  const name = f.name.replace(/, Custom Runtime.*$/, '')
  const runtime = figures.get(against.id)?.runtime
  const zipped = runtime === 'provided.al2023'
  const where = zipped ? 'with the runtime in its .zip' : `on Lambda’s ${runtime}`
  // Bun's third way onto Lambda, beside its two as a runtime: the trimmed AOT executable.
  const aot =
    f.family === 'Bun'
      ? functions.find((c) => c.base === AOT && c.arch === f.arch && c.memoryMb === f.memoryMb)
      : undefined
  const aotTrip = aot && figures.get(aot.id)?.trip
  return {
    tab: 'deployment',
    title: `${name} answers ${(times >= 1 ? times : 1 / times).toFixed(1)}× ${times >= 1 ? 'sooner' : 'later'} on a custom runtime`,
    figure: `${before.toFixed(0)} → ${after.toFixed(0)} ms`,
    sub: `Its first answer at ${GLANCE.memoryMb} MB, against ${name === against.name ? `the same ${FAMILY_NAMES[against.family]}` : against.name} ${where}.`,
    mark: {
      kind: 'bars',
      label:
        `First answer: ${before.toFixed(0)} ms ${where}, ${after.toFixed(0)} ms on a custom runtime` +
        (aotTrip === undefined ? '' : `, ${aotTrip.toFixed(0)} ms as a trimmed AOT executable`),
      bars: [
        {
          name: zipped ? 'in the .zip' : (runtime ?? against.name),
          value: before,
          color: against.color,
        },
        { name: 'custom runtime', value: after, color: f.color },
        ...(aot && aotTrip !== undefined
          ? [{ name: 'trimmed AOT', value: aotTrip, color: aot.color }]
          : []),
      ],
    },
  }
}

/**
 * How little memory size moves the cold start: per family, the geometric mean init on arm64 at each
 * size, from the lowest to the highest; and the family whose warm start memory moves most.
 */
export const memoryFinding = (
  functions: Fn[],
  figures: Map<string, Figures>
): Finding | undefined => {
  const events = functions.filter((f) => isEvent(f) && f.arch === GLANCE.arch)
  const memories = [...new Set(events.map((f) => f.memoryMb))].sort((a, b) => a - b)
  if (memories.length < 2) return undefined
  const lowest = memories[0]!
  const highest = memories.at(-1)!
  let spread = 0
  /** Each family with a cold start at every size, without one of which there's no spread to tell. */
  const lines: { name: string; values: number[] }[] = []
  let warmest: { family: Fn['family']; from: number; to: number } | undefined
  for (const family of Object.keys(FAMILY_NAMES) as Fn['family'][]) {
    const members = events.filter((f) => f.family === family)
    const at = (mb: number, key: 'cold' | 'warm') =>
      geomeanOf(
        members.filter((f) => f.memoryMb === mb),
        (f) => figures.get(f.id)?.[key]
      )
    const colds = memories.flatMap((mb) => at(mb, 'cold') ?? [])
    if (colds.length === memories.length) {
      lines.push({ name: FAMILY_NAMES[family], values: colds })
      spread = Math.max(spread, Math.max(...colds) / Math.min(...colds) - 1)
    }
    const from = at(lowest, 'warm')
    const to = at(highest, 'warm')
    if (
      from !== undefined &&
      to !== undefined &&
      (!warmest || from / to > warmest.from / warmest.to)
    )
      warmest = { family, from, to }
  }
  if (!lines.length) return undefined
  const percent = Math.max(1, Math.round(spread * 100))
  return {
    tab: 'memory',
    title:
      spread <= 0.1
        ? 'Memory size barely moves the cold start'
        : `Memory size moves the cold start by up to ${percent}%`,
    figure: `${percent}% at most`,
    sub: warmest
      ? `From ${lowest} to ${highest} MB. It does cut warm starts: ${FAMILY_NAMES[warmest.family]}’s from ${warmest.from.toFixed(1)} to ${warmest.to.toFixed(1)} ms.`
      : `From ${lowest} to ${highest} MB.`,
    mark: {
      kind: 'lines',
      label: `Each family’s cold start at every memory size from ${lowest} to ${highest} MB`,
      from: `${lowest} MB`,
      to: `${highest} MB`,
      lines,
    },
  }
}

/** Every finding the figures support, in the tabs' order. */
export const findings = (functions: Fn[], figures: Map<string, Figures>) =>
  [
    archFinding(functions, figures),
    runtimeFinding(functions, figures),
    memoryFinding(functions, figures),
  ].filter((f): f is Finding => f !== undefined)
