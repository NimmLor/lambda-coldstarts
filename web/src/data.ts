import type { FunctionSummary } from '../../src/perf/summary'

/** What PerfApi's `/runs/history` returns per run. */
export type Run = {
  runId: string
  finishedAt: string
  rounds: number
  warmInvocations?: number
  functionCount: number
  functions: FunctionSummary[]
}

export type Family = 'Bun' | 'Node'

/** What each variant in infra/functions.ts deploys, in legend order, and the hue of its line. */
export const VARIANTS: Record<string, { family: Family; hue: number; ships: string; preview?: boolean }> = {
  BunRuntime: {
    family: 'Bun',
    hue: 85,
    ships: 'bun executable + bundled index.js, started by a shell bootstrap',
  },
  BunCompile: {
    family: 'Bun',
    hue: 60,
    ships: 'bun build --compile --minify --bytecode executable as bootstrap',
  },
  BunCompileTrim: {
    family: 'Bun',
    hue: 35,
    ships: 'Same with --trim, dropping the parts of Bun the code doesn’t use',
  },
  BunCompileAot: {
    family: 'Bun',
    hue: 10,
    ships: 'bun build --compile --aot executable, behind a bootstrap that preloads the mincore shim',
  },
  BunCompileAotTrim: { family: 'Bun', hue: 340, ships: 'Same with --aot --trim' },
  Node22: { family: 'Node', hue: 150, ships: 'SST’s esbuild bundle' },
  Node24: { family: 'Node', hue: 185, ships: 'SST’s esbuild bundle' },
  Node26: { family: 'Node', hue: 225, ships: 'SST’s esbuild bundle', preview: true },
}
export const ORDER = Object.keys(VARIANTS)

/** A deployed function: its variant, e.g. BunCompile, on one architecture. */
export type Fn = {
  id: string
  base: string
  arch: string
  family: Family
  color: string
  ships: string
  preview: boolean
}

/** One function's numbers in one run. */
export type Point = {
  cold: number
  p50: number
  p90: number
  initDurations: number[]
  /** The part of a cold start spent inside the process; missing from older runs. */
  startup?: number
  warm?: number
  warmP90?: number
  mem: number
  dur: number
  size: number
  runtime: string
}
export type Stat = 'cold' | 'p50' | 'p90' | 'startup' | 'warm' | 'warmP90' | 'mem' | 'dur'

export type RunPoints = {
  date: Date
  finishedAt: string
  rounds: number
  warmInvocations?: number
  memoryMb?: number
  functions: Fn[]
  points: Map<string, Point>
}

const describe = (f: FunctionSummary): Fn => {
  // With a single architecture, ids have no suffix; see infra/functions.ts.
  const base = f.functionId.replace(/(Arm64|X64)$/, '')
  const variant = VARIANTS[base] ?? {
    family: f.runtime.startsWith('nodejs') ? 'Node' : 'Bun',
    hue: 270,
    ships: '',
  }
  return {
    id: f.functionId,
    base,
    arch: f.arch,
    family: variant.family,
    color: `oklch(0.78 0.13 ${variant.hue})`,
    ships: variant.ships,
    preview: !!variant.preview,
  }
}

export const toPoints = (run: Run): RunPoints => ({
  date: new Date(run.finishedAt),
  finishedAt: run.finishedAt,
  rounds: run.rounds,
  warmInvocations: run.warmInvocations,
  memoryMb: run.functions[0]?.memoryMb,
  functions: run.functions.map(describe),
  points: new Map(
    run.functions.map((f) => [
      f.functionId,
      {
        cold: f.initMs.avg,
        p50: f.initMs.p50,
        p90: f.initMs.p90,
        initDurations: f.initDurations,
        startup: f.startupMs?.avg,
        warm: f.warmMs?.avg,
        warmP90: f.warmMs?.p90,
        mem: f.maxMemoryMbAvg,
        dur: f.durationMsAvg,
        size: f.codeSizeMb,
        runtime: f.runtime,
      },
    ])
  ),
})

export const mean = (values: (number | undefined)[]) => {
  const present = values.filter((v) => v !== undefined)
  return present.length ? present.reduce((a, b) => a + b, 0) / present.length : undefined
}

export const fixed = (value: number | undefined, digits: number) => value?.toFixed(digits) ?? '—'

/** A round axis maximum just above `value`. */
export const niceMax = (value: number) => {
  if (!(value > 0)) return 1
  const magnitude = 10 ** Math.floor(Math.log10(value))
  return [1, 1.25, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10].find((x) => x * magnitude >= value * 1.05)! * magnitude
}

export const day = (date: Date) =>
  date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })

/** What the charts and table show: the runs in range, on one architecture. */
export type View = {
  runs: RunPoints[]
  latest: RunPoints
  /** Every function on the architecture, in legend order. */
  fns: Fn[]
  /** The ones not hidden, or all of them when every one is. */
  shown: Fn[]
  hidden: Set<string>
  /** Index of the hovered run within `runs`. */
  hover?: number
  focus?: string
  /** The hovered run's value, or the mean over the range. */
  agg: (f: Fn, key: Stat) => number | undefined
  setHover: (i: number | undefined) => void
  setFocus: (base: string | undefined) => void
  toggle: (base: string) => void
}
