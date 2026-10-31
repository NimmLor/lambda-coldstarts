/**
 * The system events a Lambda Web Function's environment logs: what src/perf/web.ts reads its
 * numbers from, since a Web Function has no REPORT line.
 * https://docs.aws.amazon.com/lambda/latest/dg/web-functions-logging-system-log-schema.html
 */
type PlatformEvent = { timestamp: string; type: string; record: Record<string, unknown> }

/** What one environment's log stream says about its start and the requests it served. */
export type EnvironmentLog = {
  /** The revision the environment runs, from `platform.initStart`. */
  revisionId?: string
  /** When initialization started, as epoch ms. */
  initStartedAt?: number
  /** `platform.initReport`'s wall-clock time and peak memory. */
  initMs?: number
  initMemoryMb?: number
  /** Each request's `platform.requestComplete` duration, by request id. */
  requestMs: Map<string, number>
}

const parse = (message: string): PlatformEvent | undefined => {
  try {
    const event = JSON.parse(message)
    return typeof event?.type === 'string' && event.type.startsWith('platform.') ? event : undefined
  } catch {
    // The application's own lines needn't be JSON.
    return undefined
  }
}

type Metrics = { totalDurationMs?: number; maxMemoryUsageMb?: number; durationMs?: number }

/** Reads the events of one log stream, in order; anything else in it is left out. */
export const readEnvironmentLog = (messages: string[]): EnvironmentLog => {
  const log: EnvironmentLog = { requestMs: new Map() }
  for (const event of messages.map(parse)) {
    if (!event) continue
    const { record } = event
    const metrics = (record.metrics ?? {}) as Metrics
    if (event.type === 'platform.initStart') {
      log.revisionId = record.revisionId as string
      log.initStartedAt = Date.parse(event.timestamp)
    } else if (event.type === 'platform.initReport' && record.status === 'success') {
      log.initMs = metrics.totalDurationMs
      log.initMemoryMb = metrics.maxMemoryUsageMb
    } else if (event.type === 'platform.requestComplete' && metrics.durationMs !== undefined) {
      log.requestMs.set(record.requestId as string, metrics.durationMs)
    }
  }
  return log
}
