/**
 * The response every variant returns, so the Bun and Node functions report the same numbers.
 * Kept free of `node:fs` and other heavy imports: whatever this module pulls in stays in a
 * `--trim` build.
 */
import { availableParallelism } from 'node:os'

const round = (value: number) => Math.round(value * 100) / 100
const toMb = (bytes: number) => round(bytes / 1024 / 1024)

// `performance.now()` counts from process start, and this module is evaluated before the first
// event arrives, so this is roughly what the process spent before it could serve: the part of a
// cold start that a smaller or ahead-of-time compiled build shrinks.
const startupMs = round(performance.now())
let invocations = 0

// Fixed for the life of the process, so read once rather than per invocation: `process.env` and
// `process.versions` are built-in objects, where every read is a lookup by name in an --aot build.
const bunVersion = process.versions.bun
const runtime = bunVersion ? `bun ${bunVersion}` : `node ${process.versions.node}`
const variant = process.env.VARIANT
const functionName = process.env.AWS_LAMBDA_FUNCTION_NAME
const region = process.env.AWS_REGION
const configuredMemoryMb = Number(process.env.AWS_LAMBDA_FUNCTION_MEMORY_SIZE)
const vcpus = availableParallelism()

type UrlEventLike = {
  rawPath?: string
  requestContext?: { http?: { method?: string } }
}

export type ReportInput = {
  event: unknown
  remainingTimeMs: number
  /** Size of the file the process was started from: the Bun executable or the Node binary. */
  executableBytes: number
}

export const buildReport = ({
  event,
  remainingTimeMs,
  executableBytes,
}: ReportInput) => {
  const handlerStart = performance.now()
  invocations += 1
  const { rss, heapUsed, heapTotal } = process.memoryUsage()
  const urlEvent = (event ?? {}) as UrlEventLike

  const body = {
    variant,
    runtime,
    request: {
      method: urlEvent.requestContext?.http?.method ?? 'INVOKE',
      path: urlEvent.rawPath ?? null,
    },
    lambda: {
      functionName,
      region,
      configuredMemoryMb,
      vcpus,
      remainingTimeMs,
    },
    container: {
      coldStart: invocations === 1,
      invocation: invocations,
      startupMs,
      uptimeMs: round(performance.now()),
    },
    memory: {
      rssMb: toMb(rss),
      // `maxRSS` is in KiB: the peak Lambda reports as "Max Memory Used".
      maxRssMb: toMb(process.resourceUsage().maxRSS * 1024),
      heapUsedMb: toMb(heapUsed),
      heapTotalMb: toMb(heapTotal),
    },
    executable: {
      path: process.execPath,
      arch: process.arch,
      sizeMb: toMb(executableBytes),
    },
    handlerMs: 0,
  }
  body.handlerMs = round(performance.now() - handlerStart)

  return {
    statusCode: 200,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  }
}
