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

/**
 * One cold start and the warm invocations after it, as stored; what summary.ts aggregates. A
 * MicroVM's is one launch until its first answer: it resumes a snapshot rather than initializing,
 * and Lambda reports no numbers of its own for it.
 */
export type Sample = {
  functionId: string
  round: number
  runtime: string
  arch: string
  memoryMb: number
  codeSizeMb: number
  /** Missing for a MicroVM, which has no init. */
  initMs?: number
  /** Missing for a MicroVM. */
  durationMs?: number
  /** Missing for a Web Function, which bills CPU time rather than duration. */
  billedMs?: number
  /** For a MicroVM, the server process's peak RSS, by its own account. */
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
  /**
   * How long the cold invocation or request took, as PerfMeasure saw it. A MicroVM's runs from
   * calling RunMicrovm until the first response arrives. Missing from an Event Function's runs
   * before it was measured. PerfMeasure has a sliver of a vCPU, which rounds the few milliseconds
   * a warm round trip takes up to its 20 ms time slices, so only the cold one is kept.
   */
  roundTripMs?: number
  /**
   * A MicroVM's: how long its first request took, which the endpoint holds until the MicroVM is
   * running; the rest of `roundTripMs` went to RunMicrovm and CreateMicrovmAuthToken.
   */
  firstRequestMs?: number
  /** A MicroVM's: which Graviton it ran on, which Lambda picks for each MicroVM. */
  graviton?: string
  /**
   * A Web Function's: Lambda started the environment before the request went out, so the
   * request waited for less of `initMs` than a cold start would.
   */
  prewarmed?: boolean
  requestId: string
  measuredAt: string
}
