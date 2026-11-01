import type { HistoryFunction } from '../../src/perf/history'

/** What PerfApi's `/runs/history` returns per run. */
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
   * A Lambda Web Function, which has a section of its own rather than a place among the others,
   * where it's compared with `counterpart`: the same runtime as a function.
   */
  web?: { counterpart: string }
  /**
   * A Lambda MicroVM, which has a section of its own too, against `counterpart`. It has no init, so
   * it's measured by its round trips instead, and shows nowhere else.
   */
  microvm?: { counterpart: string }
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
    build: 'bun build --target=bun --format=esm --minify',
    about: 'The bundle plus a bun binary, started by a shell bootstrap',
  },
  BunCompile: {
    name: 'Bun executable',
    family: 'Bun',
    build: 'bun build --compile --format=esm --minify --bytecode',
    about: 'A single-file executable that is the bootstrap',
  },
  BunCompileCanary: {
    name: 'Bun executable, canary',
    family: 'Bun',
    build: 'bun build --compile --format=esm --minify --bytecode',
    canary: true,
    about: 'The same executable built with canary Bun, to compare the trimmed and AOT ones against',
  },
  BunCompileTrim: {
    name: 'Bun executable, trimmed',
    family: 'Bun',
    build: 'bun build --compile --trim --format=esm --minify --bytecode',
    canary: true,
    about: 'The executable minus the parts of Bun the code doesn’t use',
  },
  BunCompileAot: {
    name: 'Bun AOT executable',
    family: 'Bun',
    build: 'bun build --compile --aot',
    canary: true,
    about: 'Compiled ahead of time, started by a bootstrap that preloads the AOT shim',
  },
  BunCompileAotTrim: {
    name: 'Bun AOT executable, trimmed',
    family: 'Bun',
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
}
export const ORDER = Object.keys(VARIANTS)

/** Each family's name, in the page's order. */
export const FAMILY_NAMES: Record<Family, string> = { Bun: 'Bun', LLRT: 'LLRT', Node: 'Node.js' }

/** A variant's name on its own, with `short` when the name alone doesn't tell it apart. */
export const fullName = (base: string) => {
  const v = VARIANTS[base]
  if (!v) return base
  return v.short ? `${FAMILY_NAMES[v.family]}, ${v.short}` : v.name
}

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
