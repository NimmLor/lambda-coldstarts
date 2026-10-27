/** The numbers of the `REPORT` line Lambda logs after every invocation. */
export type Report = {
  requestId: string
  /** Only on the first invocation of an execution environment: its cold start. */
  initMs?: number
  durationMs: number
  billedMs: number
  maxMemoryMb: number
}

/** Finds the `REPORT` line in a function's log, e.g. the tail Lambda returns with `LogType: Tail`. */
export const parseReport = (log: string): Report => {
  const report = log.split('\n').find((line) => line.startsWith('REPORT'))
  if (!report) throw new Error(`No REPORT line in:\n${log}`)
  const ms = (label: string) => {
    const match = report.match(new RegExp(`(?:^|\\t)${label}: ([\\d.]+) ms`))
    return match ? Number(match[1]) : undefined
  }
  return {
    requestId: report.match(/RequestId: (\S+)/)?.[1] ?? '',
    initMs: ms('Init Duration'),
    durationMs: ms('Duration') ?? Number.NaN,
    billedMs: ms('Billed Duration') ?? Number.NaN,
    maxMemoryMb: Number(report.match(/Max Memory Used: (\d+) MB/)?.[1]),
  }
}
