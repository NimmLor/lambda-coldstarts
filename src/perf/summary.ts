import type { Sample } from './keys'

const round = (value: number) => Math.round(value * 100) / 100

/**
 * Interpolates between the two nearest samples, like numpy's default. Picking the nearest rank
 * instead makes p90 of ten cold starts the slowest of them.
 */
const percentile = (sorted: number[], p: number) => {
  const rank = (p / 100) * (sorted.length - 1)
  const below = sorted[Math.floor(rank)]!
  const above = sorted[Math.ceil(rank)]!
  return round(below + (above - below) * (rank - Math.floor(rank)))
}

const average = (values: number[]) =>
  round(values.reduce((sum, v) => sum + v, 0) / values.length)

const stats = (values: number[]) => {
  const sorted = values.toSorted((a, b) => a - b)
  return {
    p50: percentile(sorted, 50),
    p90: percentile(sorted, 90),
    avg: average(sorted),
    min: sorted[0]!,
    max: sorted.at(-1)!,
  }
}

/**
 * Per function: its configuration, the init durations of every round, and statistics of those and
 * of the warm invocations' durations. Fastest cold start first.
 */
export const summarize = (samples: Sample[]) => {
  const byFunction = Map.groupBy(samples, (s) => s.functionId)
  return [...byFunction.values()]
    .map((all) => {
      const ordered = all.toSorted((a, b) => a.round - b.round)
      const warm = ordered.flatMap((s) => s.warmMs ?? [])
      const startups = ordered.flatMap((s) => (s.startupMs === undefined ? [] : [s.startupMs]))
      const { functionId, runtime, arch, memoryMb, codeSizeMb } = ordered[0]!
      return {
        functionId,
        runtime,
        arch,
        memoryMb,
        codeSizeMb,
        samples: ordered.length,
        initMs: stats(ordered.map((s) => s.initMs)),
        /** `null` for runs from before warm invocations were measured. */
        warmMs: warm.length ? { ...stats(warm), samples: warm.length } : null,
        /**
         * The handler's `startupMs` of each cold start: the part of `initMs` spent inside the
         * process, before the first event. `null` when no round has it.
         */
        startupMs: startups.length ? stats(startups) : null,
        durationMsAvg: average(ordered.map((s) => s.durationMs)),
        maxMemoryMbAvg: average(ordered.map((s) => s.maxMemoryMb)),
        /** In round order, like lambda-perf's `i`. */
        initDurations: ordered.map((s) => s.initMs),
      }
    })
    .sort((a, b) => a.initMs.p50 - b.initMs.p50)
}

export type FunctionSummary = ReturnType<typeof summarize>[number]
