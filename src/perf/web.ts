/**
 * One round of a Lambda Web Function, for measure.ts. A Web Function has no Invoke API and no
 * REPORT line: the round makes a new revision, which retires the endpoint's environments, sends
 * signed HTTPS requests to the endpoint, and reads the numbers from the platform events of the
 * environment that served them.
 */
import {
  CloudWatchLogsClient,
  GetLogEventsCommand,
  ResourceNotFoundException,
} from '@aws-sdk/client-cloudwatch-logs'
import {
  type BuildConfig,
  CreateWebFunctionRevisionCommand,
  LambdaWebClient,
  type ServiceConfig,
  UpdateWebFunctionEndpointCommand,
  waitUntilWebFunctionEndpointUpdated,
  waitUntilWebFunctionRevisionActive,
} from '@aws-sdk/client-lambda-web'
import { SignatureV4 } from '@smithy/signature-v4'
import type { Sample } from './keys'
import { readEnvironmentLog } from './platform-events'

/** What infra/web-function.ts hands PerfRun for a Web Function. */
export type WebTarget = {
  id: string
  name: string
  kind: 'web'
  region: string
  endpoint: string
  domain: string
  /** The `.local` log group, where the region's environments log before Lambda copies it on. */
  logGroup: string
  codeBytes: number
  buildConfig: BuildConfig
  serviceConfig: ServiceConfig
}

/** Every Web Function environment has 2 GB, and runs on arm64. */
const MEMORY_MB = 2048

/** The hash of an empty body, which IamAuth endpoints want in X-Amz-Content-SHA256. */
const EMPTY_SHA256 = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'

/** How long the platform events may take to reach the log group. */
const LOG_WAIT_MS = 60_000

/** How long the endpoint may keep routing to the old revision's environments after an update. */
const SWITCH_WAIT_MS = 30_000

const clients = new Map<string, { web: LambdaWebClient; logs: CloudWatchLogsClient }>()
const clientsFor = (region: string) => {
  let c = clients.get(region)
  if (!c) {
    c = { web: new LambdaWebClient({ region }), logs: new CloudWatchLogsClient({ region }) }
    clients.set(region, c)
  }
  return c
}

/** Retires the endpoint's environments: a revision that differs in an environment variable. */
const deployRevision = async (target: WebTarget) => {
  const { web } = clientsFor(target.region)
  const { revisionId } = await web.send(
    new CreateWebFunctionRevisionCommand({
      functionName: target.name,
      buildConfig: target.buildConfig,
      serviceConfig: {
        ...target.serviceConfig,
        environmentVariables: {
          ...target.serviceConfig.environmentVariables,
          BENCH_NONCE: String(Date.now()),
        },
      },
    })
  )
  const fn = { functionName: target.name }
  await waitUntilWebFunctionRevisionActive({ client: web, maxWaitTime: 120 }, { ...fn, revisionId })
  await web.send(
    new UpdateWebFunctionEndpointCommand({
      ...fn,
      endpointName: target.endpoint,
      revisionWeights: [{ revisionId, weight: 100 }],
    })
  )
  await waitUntilWebFunctionEndpointUpdated(
    { client: web, maxWaitTime: 120 },
    { ...fn, endpointName: target.endpoint }
  )
  return revisionId!
}

/** A signed GET of the endpoint, what it answered and how long that took from here. */
const request = async (target: WebTarget) => {
  const { web } = clientsFor(target.region)
  const signer = new SignatureV4({
    service: 'lambda',
    region: target.region,
    credentials: web.config.credentials,
    sha256: web.config.sha256,
  })
  const signed = await signer.sign({
    method: 'GET',
    protocol: 'https:',
    hostname: target.domain,
    path: '/perf',
    headers: { host: target.domain, 'x-amz-content-sha256': EMPTY_SHA256 },
  })
  const { host: _, ...headers } = signed.headers
  const sentAt = Date.now()
  const start = performance.now()
  const response = await fetch(`https://${target.domain}/perf`, { headers })
  const text = await response.text()
  const roundTripMs = performance.now() - start
  if (!response.ok) {
    const error = response.headers.get('lambda-web-error-type') ?? 'no error type'
    throw new Error(`${target.id} answered ${response.status} (${error}): ${text}`)
  }
  return {
    sentAt,
    roundTripMs,
    requestId: response.headers.get('lambda-web-request-id') ?? '',
    logStream: response.headers.get('lambda-web-logstream') ?? '',
    body: JSON.parse(text),
  }
}

/** The stream's events, read again until they cover the init and `requestIds`, or time runs out. */
const readLog = async (target: WebTarget, stream: string, requestIds: string[]) => {
  const { logs } = clientsFor(target.region)
  const deadline = Date.now() + LOG_WAIT_MS
  for (;;) {
    const messages: string[] = []
    let nextToken: string | undefined
    for (;;) {
      const page = await logs
        .send(
          new GetLogEventsCommand({
            logGroupName: target.logGroup,
            logStreamName: stream,
            startFromHead: true,
            nextToken,
          })
        )
        // The stream appears with its first events, a few seconds after the environment starts.
        .catch((e: unknown) => {
          if (e instanceof ResourceNotFoundException) return undefined
          throw e
        })
      messages.push(...(page?.events ?? []).map((e) => e.message ?? ''))
      // The forward token comes back unchanged at the end of the stream.
      if (!page?.events?.length || page.nextForwardToken === nextToken) break
      nextToken = page.nextForwardToken
    }
    const log = readEnvironmentLog(messages)
    if (log.initMs !== undefined && requestIds.every((id) => log.requestMs.has(id))) return log
    if (Date.now() > deadline) {
      throw new Error(`${target.id}: ${stream} has no init or request events after a minute`)
    }
    await new Promise((resolve) => setTimeout(resolve, 2_000))
  }
}

export const measureWeb = async (
  target: WebTarget,
  round: number,
  warm: number
): Promise<Omit<Sample, 'measuredAt'>> => {
  const revisionId = await deployRevision(target)

  // The endpoint keeps routing to the old revision's environments for a second or two after it
  // says it's updated. Their answers come from a server that has answered before, and the first
  // from one that hasn't is the cold start; its log says whether it runs the new revision.
  const deadline = Date.now() + SWITCH_WAIT_MS
  let cold = await request(target)
  while (!cold.body.container?.coldStart) {
    if (Date.now() > deadline) throw new Error(`${target.id} started warm in round ${round}`)
    await new Promise((resolve) => setTimeout(resolve, 250))
    cold = await request(target)
  }

  // One after another, like measure.ts's, and only those the cold start's environment served.
  const warmRequests: Awaited<ReturnType<typeof request>>[] = []
  for (let i = 0; i < warm; i++) {
    const next = await request(target)
    if (next.logStream === cold.logStream && !next.body.container?.coldStart)
      warmRequests.push(next)
  }

  const log = await readLog(target, cold.logStream, [
    cold.requestId,
    ...warmRequests.map((r) => r.requestId),
  ])
  if (log.revisionId !== revisionId) {
    throw new Error(`${target.id} ran revision ${log.revisionId}, not ${revisionId}`)
  }

  return {
    functionId: target.id,
    round,
    runtime: target.buildConfig.runtimeConfig?.runtime ?? '?',
    arch: 'arm64',
    memoryMb: MEMORY_MB,
    codeSizeMb: Math.round((target.codeBytes / 1024 / 1024) * 10) / 10,
    initMs: log.initMs!,
    durationMs: log.requestMs.get(cold.requestId)!,
    // Reported with the init duration, which readLog waited for.
    maxMemoryMb: log.initMemoryMb!,
    warmMs: warmRequests.map((r) => log.requestMs.get(r.requestId)!),
    startupMs: cold.body.container?.startupMs,
    version: cold.body.runtime,
    roundTripMs: Math.round(cold.roundTripMs * 100) / 100,
    // Lambda had the environment starting before the request went out: it waited for less of
    // the init than `initMs`, or none of it.
    prewarmed: log.initStartedAt !== undefined && log.initStartedAt < cold.sentAt,
    requestId: cold.requestId,
  }
}
