/**
 * What PerfApi's /runs/history sends of each stored summary: what the site in web/ reads of it,
 * which is about four fifths. PerfResults and the archive keep the summaries whole.
 */
import type { FunctionSummary } from './summary'

type Stats = { p50: number; p90: number; avg: number }

/** The site shows no extremes, and every function of a run has the same number of rounds. */
const typical = (stats: Stats | null | undefined) =>
  stats && { p50: stats.p50, p90: stats.p90, avg: stats.avg }

/** Summaries from before a statistic was measured lack it rather than holding `null`. */
export const toHistoryFunction = ({
  samples,
  initMs,
  warmMs,
  startupMs,
  roundTripMs,
  firstRequestMs,
  ...summary
}: FunctionSummary) => ({
  ...summary,
  initMs: typical(initMs),
  warmMs: typical(warmMs),
  startupMs: typical(startupMs),
  roundTripMs: typical(roundTripMs),
  firstRequestMs: typical(firstRequestMs),
})

export type HistoryFunction = ReturnType<typeof toHistoryFunction>

/** A stored summary item, without its keys and with each function's summary trimmed. */
export const toHistoryRun = ({
  pk,
  sk,
  expiresAt,
  functions,
  ...run
}: Record<string, unknown>): Record<string, unknown> & { functions: HistoryFunction[] } => ({
  ...run,
  functions: (functions as FunctionSummary[]).map(toHistoryFunction),
})
