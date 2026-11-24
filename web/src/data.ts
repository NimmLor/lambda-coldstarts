import type { HistoryFunction } from '../../src/perf/history'

/** What PerfApi's `/runs/latest` and `/runs/history` return per run. */
export type Run = {
  runId: string
  finishedAt: string
  rounds: number
  warmInvocations?: number
  functionCount: number
  functions: HistoryFunction[]
}

export type Family = 'Bun' | 'LLRT' | 'Node'

/** Each family's line style, as a `stroke-dasharray` for round-capped 2px strokes: solid, dotted, dashed. */
export const DASHES: Record<Family, string | undefined> = {
  Bun: undefined,
  LLRT: '0 5',
  Node: '5 4',
}

/** The architectures every function runs on, arm64 first as it's the default. */
export const ARCHS = ['arm64', 'x86_64'] as const
export type Arch = (typeof ARCHS)[number]

/**
 * Lambda's on-demand prices in STACK_REGION, in USD, at the first tier, from the AWS Price List API
 * (EUC1-Lambda-GB-Second, -ARM and EUC1-Request): arm64's GB-second costs a fifth less.
 */
export const PRICES = {
  gbSecond: { arm64: 0.0000133334, x86_64: 0.0000166667 } satisfies Record<Arch, number>,
  request: 0.0000002,
}

type Variant = {
  name: string
  /** Its name under its family's heading, when the name minus the family's isn't it. */
  short?: string
  family: Family
  /**
   * The command infra/build.ts or infra/llrt.ts builds it with, short of the entry point, `--outfile`, and for the
   * compiled ones `--target=bun-linux-<arch>` and the `--no-compile-autoload-*` flags.
   */
  build: string
  /** Built by the Bun build that `--trim` and `--aot` need rather than a release. */
  canary?: boolean
  preview?: boolean
  /**
   * A Lambda Web Function, which has a tab of its own rather than a place among the others, where
   * it's compared with `counterpart`: the same runtime as a function.
   */
  web?: { counterpart: string }
  /**
   * A Lambda MicroVM, which has a tab of its own too, against `counterpart`. It has no init, so
   * it's measured by its round trips instead, and shows nowhere else.
   */
  microvm?: { counterpart: string }
  /**
   * An Event Function on a customer-managed runtime, which the Deployment tab compares with
   * `counterpart`: the same runtime on Lambda's or in its .zip. It has both architectures and every
   * size, and ranks with the others in All results too.
   */
  cmr?: { counterpart: string }
  /** Its kind within its family, e.g. "AOT executable", which the Functions picker shows or hides together. */
  group?: string
  /** Its name in the Functions picker, under its group's, when its own would repeat that. */
  option?: string
  /** How it's deployed, for the row's tooltip. */
  about: string
}

/** Where every function runs; see sst.config.ts. */
export const STACK_REGION = 'eu-central-1'

const SST_BUNDLE = 'esbuild --bundle --format=esm --minify'
const LLRT_BUNDLE = 'bun build --target=node --format=esm --minify'

/** Each variant in infra/functions.ts, in legend order; its line colour is `--color-line-<id>` in tokens.css. */
export const VARIANTS: Record<string, Variant> = {
  BunRuntime: {
    name: 'Bun runtime',
    family: 'Bun',
    group: 'Runtime',
    option: 'Amazon Linux bootstrap',
    build: 'bun build --target=bun --format=esm --minify',
    about: 'The bundle plus a bun binary, started by a shell bootstrap',
  },
  BunCompile: {
    name: 'Bun executable',
    family: 'Bun',
    group: 'Executable',
    build: 'bun build --compile --format=esm --minify --bytecode',
    about: 'A single-file executable that is the bootstrap',
  },
  BunCompileCanary: {
    name: 'Bun executable, canary',
    family: 'Bun',
    group: 'Executable',
    build: 'bun build --compile --format=esm --minify --bytecode',
    canary: true,
    about: 'The same executable built with canary Bun, to compare the trimmed and AOT ones against',
  },
  BunCompileTrim: {
    name: 'Bun executable, trimmed',
    family: 'Bun',
    group: 'Executable',
    build: 'bun build --compile --trim --format=esm --minify --bytecode',
    canary: true,
    about: 'The executable minus the parts of Bun the code doesn’t use',
  },
  BunCompileAot: {
    name: 'Bun AOT executable',
    family: 'Bun',
    group: 'AOT executable',
    build: 'bun build --compile --aot',
    canary: true,
    about: 'Compiled ahead of time, started by a bootstrap that preloads the AOT shim',
  },
  BunCompileAotTrim: {
    name: 'Bun AOT executable, trimmed',
    family: 'Bun',
    group: 'AOT executable',
    build: 'bun build --compile --aot --trim',
    canary: true,
    about: 'The AOT executable minus the parts of Bun the code doesn’t use',
  },
  Llrt: {
    name: 'LLRT',
    short: 'no SDK',
    family: 'LLRT',
    build: LLRT_BUNDLE,
    about: 'The bundle, run by LLRT’s no-SDK Lambda build as the bootstrap',
  },
  LlrtBytecode: {
    name: 'LLRT, bytecode',
    family: 'LLRT',
    build: 'llrt compile',
    about:
      'The bundle as QuickJS bytecode, run by LLRT’s CLI build: the only release that reads what llrt compile writes',
  },
  LlrtStdSdk: {
    name: 'LLRT, standard SDK',
    family: 'LLRT',
    build: LLRT_BUNDLE,
    about:
      'The bundle, run by LLRT’s default Lambda build, which embeds the common AWS SDK clients the handler doesn’t import',
  },
  LlrtFullSdk: {
    name: 'LLRT, full SDK',
    family: 'LLRT',
    build: LLRT_BUNDLE,
    about:
      'The bundle, run by LLRT’s Lambda build that embeds every AWS SDK client, none of which the handler imports',
  },
  Node22: { name: 'Node.js 22', family: 'Node', build: SST_BUNDLE, about: 'SST’s default bundle' },
  Node24: { name: 'Node.js 24', family: 'Node', build: SST_BUNDLE, about: 'SST’s default bundle' },
  Node26: {
    name: 'Node.js 26',
    family: 'Node',
    build: SST_BUNDLE,
    preview: true,
    about: 'SST’s default bundle, on a runtime still in preview',
  },
  Node24Web: {
    name: 'Node.js 24, Web Function',
    family: 'Node',
    build: 'bun build --target=node --format=esm --minify',
    web: { counterpart: 'Node24' },
    about:
      'A node:http server on Lambda Web Functions, with the 2 GB and 2 vCPUs every environment gets',
  },
  Node24MicroVm: {
    name: 'Node.js 24, MicroVM',
    family: 'Node',
    build: 'bun build --target=node --format=esm --minify',
    microvm: { counterpart: 'Node24' },
    about:
      'A node:http server in Lambda’s Node.js 24 image on a Lambda MicroVM, resumed from a snapshot',
  },
  BunCompileAotTrimMicroVm: {
    name: 'Bun AOT, trimmed, MicroVM',
    family: 'Bun',
    build: 'bun build --compile --aot --trim',
    canary: true,
    microvm: { counterpart: 'BunCompileAotTrim' },
    about:
      'The same server as a trimmed AOT executable on a Lambda MicroVM, without the AOT shim, resumed from a snapshot',
  },
  Node24Cmr: {
    name: 'Node.js 24, Custom Runtime',
    family: 'Node',
    build: 'bun build --target=node --format=esm --minify',
    cmr: { counterpart: 'Node24' },
    about:
      'The handler on a customer-managed runtime built from Lambda’s own Node.js 24 image, unchanged',
  },
  Node27Cmr: {
    name: 'Node.js 27 alpha, Custom Runtime',
    family: 'Node',
    build: 'bun build --target=node --format=esm --minify',
    preview: true,
    cmr: { counterpart: 'Node24' },
    about:
      'The handler on a customer-managed runtime built from Lambda’s Node.js 24 image, its Node.js swapped for nodejs.org’s 27 alpha',
  },
  BunRuntimeCmr: {
    name: 'Bun runtime, Custom Runtime',
    family: 'Bun',
    group: 'Runtime',
    option: 'Custom Runtime, Amazon Linux',
    build: 'bun build --target=bun --format=esm --minify',
    cmr: { counterpart: 'BunRuntime' },
    about:
      'The bundle alone, on a customer-managed runtime: the bun binary and its bootstrap on Lambda’s OS-only image',
  },
  LlrtCmr: {
    name: 'LLRT, Custom Runtime',
    short: 'no SDK, Custom Runtime',
    family: 'LLRT',
    build: LLRT_BUNDLE,
    cmr: { counterpart: 'Llrt' },
    about:
      'The bundle alone, on a customer-managed runtime: LLRT’s no-SDK Lambda build on Lambda’s OS-only image',
  },
  BunRuntimeCmrAlpine: {
    name: 'Bun runtime, Custom Runtime on Alpine',
    family: 'Bun',
    group: 'Runtime',
    option: 'Custom Runtime, Alpine',
    build: 'bun build --target=bun --format=esm --minify',
    cmr: { counterpart: 'BunRuntime' },
    about:
      'The bundle on a customer-managed runtime built from Bun’s Alpine image: Bun built against musl, on another OS than Lambda’s',
  },
}
export const ORDER = Object.keys(VARIANTS)

/** Each family's name, in the page's order. */
export const FAMILY_NAMES: Record<Family, string> = { Bun: 'Bun', LLRT: 'LLRT', Node: 'Node.js' }

/**
 * A variant's name under its family's heading: `short`, or its name without the family's, e.g.
 * "AOT executable, trimmed" for "Bun AOT executable, trimmed" and "24" for "Node.js 24".
 */
export const shortName = (base: string) => {
  const v = VARIANTS[base]
  if (!v) return base
  const family = FAMILY_NAMES[v.family]
  if (v.short) return v.short
  return v.name.startsWith(family) ? v.name.slice(family.length).replace(/^[\s,]+/, '') : v.name
}

/** A deployed function: its variant, e.g. BunCompile, on one architecture with one memory size. */
export type Fn = Variant & {
  /** `<variant>/<arch>/<memoryMb>`, the same across runs however the function was named. */
  id: string
  /** The variant's id. */
  base: string
  arch: string
  memoryMb: number
  color: string
}

/** One function's numbers in one run. */
export type Point = {
  /** The init statistics, which a MicroVM doesn't have. */
  cold?: number
  p50?: number
  p90?: number
  initDurations: number[]
  /** The part of a cold start spent inside the process; missing from older runs. */
  startup?: number
  warm?: number
  warmP90?: number
  /**
   * How long the cold invocation or request took from PerfMeasure, or a MicroVM's launch until its
   * first response; missing from older runs.
   */
  trip?: number
  /** A MicroVM's first request alone, which waited for it to be running. */
  firstRequest?: number
  mem: number
  /** Missing for a MicroVM. */
  dur?: number
  size: number
  /** Lambda's runtime, e.g. `nodejs24.x` or `provided.al2023`. */
  runtime: string
  /** What it ran on, e.g. `llrt-lambda-arm64-no-sdk@v0.9.0-beta`; missing from older runs. */
  version?: string
}
export type Stat =
  'cold' | 'p50' | 'p90' | 'startup' | 'warm' | 'warmP90' | 'trip' | 'firstRequest' | 'mem' | 'dur'

export type RunPoints = {
  date: Date
  finishedAt: string
  rounds: number
  warmInvocations?: number
  functions: Fn[]
  points: Map<string, Point>
}

const describe = (f: HistoryFunction): Fn => {
  // With a single architecture or memory size, ids go without that suffix; see infra/functions.ts.
  const base = f.functionId.replace(/M\d+$/, '').replace(/(Arm64|X64)$/, '')
  const variant = VARIANTS[base] ?? {
    name: base,
    family: f.runtime.startsWith('nodejs') ? 'Node' : 'Bun',
    build: '',
    about: '',
  }
  return {
    ...variant,
    // The MicroVMs' section shows every size at once, each its own line, so each says which it is.
    ...(variant.microvm && { name: `${variant.name} · ${f.memoryMb / 1024} GB` }),
    id: `${base}/${f.arch}/${f.memoryMb}`,
    base,
    arch: f.arch,
    memoryMb: f.memoryMb,
    color: variant.microvm
      ? `var(--color-line-${base}-${f.memoryMb}, var(--color-line-${base}))`
      : `var(--color-line-${base}, var(--color-line-other))`,
  }
}

export const toPoints = (run: Run): RunPoints => {
  const functions = run.functions.map(describe)
  return {
    date: new Date(run.finishedAt),
    finishedAt: run.finishedAt,
    rounds: run.rounds,
    warmInvocations: run.warmInvocations,
    functions,
    points: new Map(
      run.functions.map((f, i) => [
        functions[i]!.id,
        {
          cold: f.initMs?.avg,
          p50: f.initMs?.p50,
          p90: f.initMs?.p90,
          initDurations: f.initDurations,
          startup: f.startupMs?.avg,
          warm: f.warmMs?.avg,
          warmP90: f.warmMs?.p90,
          // Summaries from before these were measured lack them.
          trip: f.roundTripMs?.avg,
          firstRequest: f.firstRequestMs?.avg,
          mem: f.maxMemoryMbAvg,
          dur: f.durationMsAvg ?? undefined,
          size: f.codeSizeMb,
          runtime: f.runtime,
          version: f.version ?? undefined,
        },
      ])
    ),
  }
}

export const mean = (values: (number | undefined)[]) => {
  const present = values.filter((v) => v !== undefined)
  return present.length ? present.reduce((a, b) => a + b, 0) / present.length : undefined
}

/**
 * What a million cold starts of `f` cost: since August 2025 Lambda bills the init as duration on
 * every runtime, so each is billed for its init plus the invocation, and the request.
 */
export const coldStartCost = (f: Fn, cold?: number, dur?: number) => {
  const price = PRICES.gbSecond[f.arch as Arch]
  if (cold === undefined || dur === undefined || price === undefined) return undefined
  return (((cold + dur) / 1e3) * (f.memoryMb / 1024) * price + PRICES.request) * 1e6
}

/** The geometric mean, which averages ratios as they multiply; undefined for none. */
export const geomean = (values: number[]) =>
  values.length
    ? Math.exp(values.reduce((sum, v) => sum + Math.log(v), 0) / values.length)
    : undefined

export const fixed = (value: number | undefined, digits: number) => value?.toFixed(digits) ?? '—'

/** A round axis maximum just above `value`. */
export const niceMax = (value: number) => {
  if (!(value > 0)) return 1
  // The magnitude of the padded value, so a value just under a power of ten, like 960, still
  // finds a step: 1000 is short of 960 × 1.05, and 10 × 100 is the last step from 100.
  const padded = value * 1.05
  const magnitude = 10 ** Math.floor(Math.log10(padded))
  return [1, 1.25, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10].find((x) => x * magnitude >= padded)! * magnitude
}

/** A run by when it finished, to the minute: there is one every 4 hours. */
export const when = (date: Date) =>
  date.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
    timeZone: 'UTC',
  })

export const day = (date: Date) =>
  date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })

/** What the charts and table show: the runs in range, on one architecture with one memory size. */
export type View = {
  runs: RunPoints[]
  latest: RunPoints
  /** The memory size `fns` have. */
  memoryMb: number
  /** Every function on the architecture with the memory size, in legend order. */
  fns: Fn[]
  /** The ones not hidden, or all of them when every one is. */
  shown: Fn[]
  /**
   * The shown variants on every architecture at every memory size, which the axes scale to, so they
   * hold still when either is switched.
   */
  scaled: Fn[]
  hidden: Set<string>
  /** Index of the hovered or picked run within `runs`. */
  hover?: number
  focus?: string
  /** The function every other is compared with, from `fns`; none when the picked variant isn't there. */
  baseline?: Fn
  /** The hovered or picked run's value, or the mean over the range. */
  agg: (f: Fn, key: Stat) => number | undefined
  setHover: (i: number | undefined) => void
  setFocus: (base: string | undefined) => void
  toggle: (base: string) => void
}

const DAY_MS = 864e5

/**
 * Which runs a function's figures are the mean of: those on the build it runs now, or those of the
 * last 7 or 14 days. /runs/history holds 15 days.
 */
export const WINDOWS = ['current', '7', '14'] as const
export type Window = (typeof WINDOWS)[number]
export const WINDOW_NAMES: Record<Window, string> = {
  current: 'Current builds',
  '7': '7 days',
  '14': '14 days',
}
export const isWindow = (value: unknown): value is Window => WINDOWS.includes(value as Window)

/**
 * The runs of `runs`, oldest first, that measured function `id` within `window`. Its current
 * build's are those since its version last changed, so a mean never mixes two builds: Bun 1.4.5
 * nearly doubled the released executable's cold start. A run that's missing the function, as when
 * its rounds failed, doesn't end the series.
 */
export const runsOf = (runs: RunPoints[], id: string, window: Window) => {
  const latest = runs.at(-1)
  if (!latest) return []
  const measured = runs.filter((r) => r.points.has(id))
  if (window !== 'current') {
    const since = latest.date.getTime() - Number(window) * DAY_MS
    return measured.filter((r) => r.date.getTime() > since)
  }
  const version = measured.at(-1)?.points.get(id)!.version
  let first = measured.length
  while (first > 0 && measured[first - 1]!.points.get(id)!.version === version) first--
  return measured.slice(first)
}

/** The `p`th percentile of ascending `sorted`, interpolated like summary.ts's; none for none. */
export const percentile = (sorted: number[], p: number) => {
  if (!sorted.length) return undefined
  const rank = (p / 100) * (sorted.length - 1)
  const below = sorted[Math.floor(rank)]!
  const above = sorted[Math.ceil(rank)]!
  return below + (above - below) * (rank - Math.floor(rank))
}

/** A function's figures over the runs of a window, as the page shows them. */
export type Figures = {
  /** How many runs they're over, and the first of them. */
  runs: number
  since: Date
  /**
   * Lambda's init duration: the mean of each run's, and the fastest and percentiles of every cold
   * start.
   */
  cold?: number
  min?: number
  p50?: number
  p90?: number
  p99?: number
  startup?: number
  warm?: number
  warmP90?: number
  trip?: number
  firstRequest?: number
  mem?: number
  /** The cold invocation's duration: the first call after the cold start. */
  dur?: number
  /**
   * What the first answer spent outside the init and the first call: fetching the code, placing
   * the environment and the Invoke API itself.
   */
  load?: number
  /** USD per million cold starts, see `coldStartCost`; none for a Web Function or a MicroVM. */
  cost?: number
  size: number
  runtime: string
  version?: string
}

/** `f`'s figures over the runs of `window`; undefined when no run has it. */
export const figuresOf = (runs: RunPoints[], f: Fn, window: Window): Figures | undefined => {
  const counted = runsOf(runs, f.id, window)
  if (!counted.length) return undefined
  const points = counted.map((r) => r.points.get(f.id)!)
  const avg = (key: Stat) => mean(points.map((p) => p[key]))
  const durations = points.flatMap((p) => p.initDurations).sort((a, b) => a - b)
  const latest = points.at(-1)!
  const cold = avg('cold')
  const dur = avg('dur')
  const trip = avg('trip')
  return {
    runs: counted.length,
    since: counted[0]!.date,
    cold,
    min: durations[0],
    p50: percentile(durations, 50),
    p90: percentile(durations, 90),
    p99: percentile(durations, 99),
    startup: avg('startup'),
    warm: avg('warm'),
    warmP90: avg('warmP90'),
    trip,
    firstRequest: avg('firstRequest'),
    mem: avg('mem'),
    dur,
    load:
      trip !== undefined && cold !== undefined && dur !== undefined ? trip - cold - dur : undefined,
    // A Web Function bills CPU time, a MicroVM by the second; neither as duration times memory.
    cost: f.web || f.microvm ? undefined : coldStartCost(f, cold, dur),
    size: latest.size,
    runtime: latest.runtime,
    version: latest.version,
  }
}

/** `figuresOf` every function of the latest run, by id. */
export const figuresFor = (runs: RunPoints[], window: Window) =>
  new Map(
    (runs.at(-1)?.functions ?? []).flatMap((f) => {
      const figures = figuresOf(runs, f, window)
      return figures ? [[f.id, figures] as const] : []
    })
  )

/** The geometric mean of `value` over `fns`, leaving out those without one. */
export const geomeanOf = (fns: Fn[], value: (f: Fn) => number | undefined) =>
  geomean(
    fns.flatMap((f) => {
      const v = value(f)
      return v !== undefined && v > 0 ? [v] : []
    })
  )

/** An Event Function on Lambda's runtime or with the runtime in its .zip: what most tabs show. */
export const isEvent = (f: Fn) => !f.web && !f.microvm && !f.cmr

/**
 * A build's version as its release: `Bun 1.4.5`, `Bun 1.4.6-canary.1`, `LLRT 0.10.0-beta`,
 * `Node.js 24.22.3`; anything else as it is.
 */
export const versionName = (version: string) => {
  const bun = version.match(/^bun (\d[^+]*)/)
  if (bun) return `Bun ${bun[1]}`
  const llrt = version.match(/^llrt-.*@v(.+)$/)
  if (llrt) return `LLRT ${llrt[1]}`
  const node = version.match(/^node (.+)$/)
  if (node) return `Node.js ${node[1]}`
  return version
}

/** Each time one of `fns` changed build within `runs`: the run that first had the new version. */
export const buildChanges = (runs: RunPoints[], fns: Fn[]) =>
  fns.flatMap((f) => {
    const changes: { index: number; f: Fn; from: string; to: string }[] = []
    let previous: string | undefined
    runs.forEach((r, index) => {
      const version = r.points.get(f.id)?.version
      if (version === undefined) return
      if (previous !== undefined && version !== previous) {
        changes.push({ index, f, from: previous, to: version })
      }
      previous = version
    })
    return changes
  })
