/**
 * The PerfResults table holds three kinds of items, keyed so each is one Query away:
 *
 *   pk `runs`          sk <runId>                 a finished run, written by the state machine
 *   pk `summaries`     sk <runId>                 that run and its per-function statistics,
 *                                                 written by summarize.ts after it
 *   pk `run#<runId>`   sk <functionId>#<round>    one cold start, written by measure.ts
 *
 * A run's id is the ISO start time of its Step Functions execution, so runs sort by time.
 */
export const RUNS_PK = 'runs'

export const SUMMARIES_PK = 'summaries'

export const samplesPk = (runId: string) => `run#${runId}`

export const sampleSk = (functionId: string, round: number) =>
  `${functionId}#${String(round).padStart(3, '0')}`

/** One cold start and the warm invocations after it, as stored; what summary.ts aggregates. */
export type Sample = {
  functionId: string
  round: number
  runtime: string
  arch: string
  memoryMb: number
  codeSizeMb: number
  initMs: number
  durationMs: number
  billedMs: number
  maxMemoryMb: number
  /** Lambda's Duration of each warm invocation after the cold one. Missing from runs before they were measured. */
  warmMs?: number[]
  /** The handler's own `startupMs`, see src/report.ts. */
  startupMs?: number
  requestId: string
  measuredAt: string
}
