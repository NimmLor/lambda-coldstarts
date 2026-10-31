/**
 * The response every variant returns, so the Bun and Node functions report the same numbers.
 * Kept free of `node:fs` and other heavy imports: whatever this module pulls in stays in a
 * `--trim` build.
 */
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
// LLRT reports its version as `llrt` and, for packages that check, Node's as 0.0.0.
const runtime = bunVersion
  ? `bun ${bunVersion}`
  : process.versions.llrt
    ? `llrt ${process.versions.llrt}`
    : `node ${process.versions.node}`
const variant = process.env.VARIANT
const functionName = process.env.AWS_LAMBDA_FUNCTION_NAME
const region = process.env.AWS_REGION
const configuredMemoryMb = Number(process.env.AWS_LAMBDA_FUNCTION_MEMORY_SIZE)
// What `os.availableParallelism()` returns, on Bun and on Node 21+, without the import: `node:os`
// keeps all of itself and `node:path` in a `--trim` build.
const vcpus = Number(navigator.hardwareConcurrency)

type UrlEventLike = {
  rawPath?: unknown
  requestContext?: { http?: { method?: unknown } }
}

/**
 * The method and path of a Function URL request, or `INVOKE` for a direct invocation. The event is
 * parsed JSON, so its fields are checked here, once, and the report gets plain strings.
 */
const readRequest = (event: unknown) => {
  const { rawPath, requestContext } = (event ?? {}) as UrlEventLike
  const method = requestContext?.http?.method
  return {
    method: typeof method === 'string' ? method : 'INVOKE',
    path: typeof rawPath === 'string' ? rawPath : null,
  }
}

export type ReportInput = {
  event: unknown
  /** Until the invocation times out; a Web Function's requests have no deadline to report. */
  remainingTimeMs?: number
  /** Size of the file the process was started from: the Bun executable or the Node binary. */
  executableBytes: number
}

export const buildReport = ({ event, remainingTimeMs, executableBytes }: ReportInput) => {
  const handlerStart = performance.now()
  invocations += 1
  const memory = process.memoryUsage()

  const body = {
    variant,
    runtime,
    request: readRequest(event),
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
    // `Number` proves to an --aot build that what a built-in returned is a number, which spares
    // this function a type guard on every invocation.
    memory: {
      rssMb: toMb(Number(memory.rss)),
      // `maxRSS` is in KiB: the peak Lambda reports as "Max Memory Used".
      maxRssMb: toMb(Number(process.resourceUsage().maxRSS) * 1024),
      heapUsedMb: toMb(Number(memory.heapUsed)),
      heapTotalMb: toMb(Number(memory.heapTotal)),
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
