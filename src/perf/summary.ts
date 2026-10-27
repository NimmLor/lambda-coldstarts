import type { Sample } from './keys'

const round = (value: number) => Math.round(value * 100) / 100

const percentile = (sorted: number[], p: number) =>
  sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))]!

const average = (values: number[]) =>
  round(values.reduce((sum, v) => sum + v, 0) / values.length)

/** Per function: its configuration, the init durations of every round, and their statistics. Fastest first. */
export const summarize = (samples: Sample[]) => {
  const byFunction = Map.groupBy(samples, (s) => s.functionId)
  return [...byFunction.values()]
    .map((all) => {
      const ordered = all.toSorted((a, b) => a.round - b.round)
      const init = ordered.map((s) => s.initMs).toSorted((a, b) => a - b)
      const { functionId, runtime, arch, memoryMb, codeSizeMb } = ordered[0]!
      return {
        functionId,
        runtime,
        arch,
        memoryMb,
        codeSizeMb,
        samples: ordered.length,
        initMs: {
          p50: percentile(init, 50),
          p90: percentile(init, 90),
          avg: average(init),
          min: init[0]!,
          max: init.at(-1)!,
        },
        durationMsAvg: average(ordered.map((s) => s.durationMs)),
        maxMemoryMbAvg: average(ordered.map((s) => s.maxMemoryMb)),
        /** In round order, like lambda-perf's `i`. */
        initDurations: ordered.map((s) => s.initMs),
      }
    })
    .sort((a, b) => a.initMs.p50 - b.initMs.p50)
}

export type FunctionSummary = ReturnType<typeof summarize>[number]
