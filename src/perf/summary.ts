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

const average = (values: number[]) => round(values.reduce((sum, v) => sum + v, 0) / values.length)

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

/** `stats` of the values present, or `null` when there are none, such as before they were measured. */
const statsOf = (values: (number | undefined)[]) => {
  const present = values.filter((v) => v !== undefined)
  return present.length ? stats(present) : null
}

/**
 * Per function: its configuration, the init durations of every round, and statistics of those and
 * of the warm invocations' durations. Fastest cold start first, then the MicroVMs, which have none.
 */
export const summarize = (samples: Sample[]) => {
  const byFunction = Map.groupBy(samples, (s) => s.functionId)
  return [...byFunction.values()]
    .map((all) => {
      const ordered = all.toSorted((a, b) => a.round - b.round)
      const warm = ordered.flatMap((s) => s.warmMs ?? [])
      const workWarm = ordered.flatMap((s) => s.workMs?.slice(1) ?? [])
      const workDurations = ordered.flatMap((s) => s.workDurationMs?.slice(1) ?? [])
      const durations = ordered.flatMap((s) => (s.durationMs === undefined ? [] : [s.durationMs]))
      const { functionId, runtime, arch, memoryMb, codeSizeMb } = ordered[0]!
      return {
        functionId,
        runtime,
        /** What it ran on, see `Sample`'s `version`; `null` when no round has it. */
        version: ordered.find((s) => s.version)?.version ?? null,
        arch,
        memoryMb,
        codeSizeMb,
        samples: ordered.length,
        /** `null` for a MicroVM, which has no init. */
        initMs: statsOf(ordered.map((s) => s.initMs)),
        /** `null` for runs from before warm invocations were measured. */
        warmMs: warm.length ? { ...stats(warm), samples: warm.length } : null,
        /**
         * The handler's `startupMs` of each cold start: the part of `initMs` spent inside the
         * process, before the first event. `null` when no round has it.
         */
        startupMs: statsOf(ordered.map((s) => s.startupMs)),
        /**
         * The workload's first run in each round's environment, src/work.ts's code never having
         * run there before. `null` when no round has it.
         */
        workFirstMs: statsOf(ordered.map((s) => s.workMs?.[0])),
        /** How many orders a `/work` call processed, see `Sample`; `null` when no round says. */
        workSize: ordered.findLast((s) => s.workSize !== undefined)?.workSize ?? null,
        /** Its runs after the first, pooled; `null` when there are none. */
        workWarmMs: workWarm.length ? { ...stats(workWarm), samples: workWarm.length } : null,
        /**
         * Lambda's Duration of those runs after the first: what a `/work` call is billed for once
         * the environment has served one. `null` when there are none.
         */
        workDurationMs: workDurations.length
          ? { ...stats(workDurations), samples: workDurations.length }
          : null,
        /**
         * How long each cold invocation or request took as PerfMeasure saw it, or, for a MicroVM,
         * its launch until the first response. `null` when no round has it.
         */
        roundTripMs: statsOf(ordered.map((s) => s.roundTripMs)),
        /** A MicroVM's `firstRequestMs` of each round; `null` for everything else. */
        firstRequestMs: statsOf(ordered.map((s) => s.firstRequestMs)),
        /** `null` for a MicroVM. */
        durationMsAvg: durations.length ? average(durations) : null,
        maxMemoryMbAvg: average(ordered.map((s) => s.maxMemoryMb)),
        /** In round order, like lambda-perf's `i`; empty for a MicroVM. */
        initDurations: ordered.flatMap((s) => (s.initMs === undefined ? [] : [s.initMs])),
      }
    })
    .sort((a, b) => (a.initMs?.p50 ?? Infinity) - (b.initMs?.p50 ?? Infinity))
}

export type FunctionSummary = ReturnType<typeof summarize>[number]
