/**
 * The PerfResults table holds three kinds of items, keyed so each is one Query away:
 *
 *   pk `runs`          sk <runId>                 a finished run, written by the state machine
 *   pk `summaries`     sk <runId>                 that run and its per-function statistics,
 *                                                 written by summarize.ts after it
 *   pk `run#<runId>`   sk <functionId>#<round>    one cold start, written by measure.ts
 *
 * A run's id is the ISO start time of its Step Functions execution, so runs sort by time, and its
 * month is the id's first seven characters. Every item of a run carries the same `expiresAt`,
 * which DynamoDB's TTL deletes it after; export.ts copies each month to S3 long before that.
 */
export const RUNS_PK = 'runs'

export const SUMMARIES_PK = 'summaries'

export const SAMPLES_PREFIX = 'run#'

export const samplesPk = (runId: string) => `${SAMPLES_PREFIX}${runId}`

/** How long PerfResults keeps a run, counted from its start. */
export const RETENTION_DAYS = 120

/** When a run's items expire, in the epoch seconds TTL reads. */
export const expiresAt = (runId: string) =>
  Math.floor(Date.parse(runId) / 1000) + RETENTION_DAYS * 86_400

/** The run a stored item belongs to, from its key; undefined for an item of no run. */
export const runIdOf = ({ pk, sk }: { pk: string; sk: string }) => {
  if (pk === RUNS_PK || pk === SUMMARIES_PK) return sk
  if (pk.startsWith(SAMPLES_PREFIX)) return pk.slice(SAMPLES_PREFIX.length)
  return undefined
}

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
  /**
   * What it ran on: the function's description, which infra/functions.ts sets to what built it, e.g.
   * `bun 1.4.4-canary.1+72ab4f530`, or else the handler's own `runtime`, e.g. `node 24.11.1`.
   * Missing from older runs.
   */
  version?: string
  requestId: string
  measuredAt: string
}
