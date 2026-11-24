/**
 * The read side of PerfResults for the site in web/, behind PerfRouter:
 *
 *   GET /runs/latest       the newest run's summary alone, which the site paints its first view
 *                          from: a few dozen KB where the history is a few MB
 *   GET /runs/history      the summaries of the latest `HISTORY_RUNS` runs, newest first, which
 *                          the site asks for once the latest run is on screen
 *
 * Both send as much of a summary as the site reads (history.ts). That is all the site asks for,
 * and all anyone gets: no parameters, so every request is the same one CloudFront answers from its
 * cache, which leaves query strings out of the key (infra/perf.ts).
 *
 * And, only when PERF_ADMIN_SECRET is set, routes under it that 404 like any other otherwise:
 *
 *   POST /admin/<secret>/run     starts a run of the PerfRun state machine
 *   POST /admin/<secret>/pause   disables the schedule that starts it every 4 hours
 *   POST /admin/<secret>/resume  enables it again; both answer `{ state, was }`
 *   POST /admin/<secret>/purge   deletes items from PerfResults until about 15 s have passed;
 *                                `done: false` means there are more, call it again
 */
import { timingSafeEqual } from 'node:crypto'
import { gzipSync } from 'node:zlib'
import { DynamoDBClient } from '@aws-sdk/client-dynamodb'
import {
  GetScheduleCommand,
  SchedulerClient,
  type ScheduleState,
  UpdateScheduleCommand,
} from '@aws-sdk/client-scheduler'
import { SFNClient, StartExecutionCommand } from '@aws-sdk/client-sfn'
import {
  BatchWriteCommand,
  DynamoDBDocumentClient,
  QueryCommand,
  ScanCommand,
} from '@aws-sdk/lib-dynamodb'
import type { LambdaFunctionURLEvent } from 'aws-lambda'
import { toHistoryRun } from './history'
import { SUMMARIES_PK } from './keys'

const db = DynamoDBDocumentClient.from(new DynamoDBClient())
const sfn = new SFNClient()
const scheduler = new SchedulerClient()
const TABLE = process.env.PERF_TABLE
const STATE_MACHINE = process.env.PERF_STATE_MACHINE
const SCHEDULE = process.env.PERF_SCHEDULE
const ADMIN_SECRET = process.env.PERF_ADMIN_SECRET
/** What /runs/history returns: 15 days of runs every 4 hours, the site's longest range. */
export const HISTORY_RUNS = 90
/**
 * A new run arrives every 4 hours, and PerfRun invalidates both routes when it does, so CloudFront
 * keeps them that long and, past that, answers from its copy while it fetches a new one. Browsers
 * still ask again after a minute, which CloudFront answers.
 */
const RUNS_CACHE = 'max-age=60, s-maxage=14400, stale-while-revalidate=86400'

type HistoryRun = ReturnType<typeof toHistoryRun>

/** Each read route: how many of the newest summaries it reads, and what it sends of them. */
export const RUNS_ROUTES = new Map<
  string,
  { limit: number; body: (runs: HistoryRun[]) => unknown }
>([
  ['/runs/latest', { limit: 1, body: ([run]) => ({ run: run ?? null }) }],
  ['/runs/history', { limit: HISTORY_RUNS, body: (runs) => ({ runs }) }],
])
/** Leaves room under PerfRouter's 20 s origin timeout, which is also the function's. */
const PURGE_BUDGET_MS = 15_000

const json = (statusCode: number, body: unknown, cacheControl = 'max-age=60') => ({
  statusCode,
  headers: { 'content-type': 'application/json', 'cache-control': cacheControl },
  body: JSON.stringify(body),
})

/**
 * A run route's body as gzip. A Lambda response holds 6 MB at most, which 90 runs of 130 functions
 * pass in JSON: the function then fails and its URL answers 502. Compressed, it's a fraction of
 * that. Every browser takes gzip, and CloudFront passes a body its origin compressed on as is.
 */
const gzipJson = (body: unknown, cacheControl: string) => ({
  statusCode: 200,
  headers: {
    'content-type': 'application/json',
    'content-encoding': 'gzip',
    'cache-control': cacheControl,
  },
  isBase64Encoded: true,
  body: gzipSync(JSON.stringify(body)).toString('base64'),
})

/** Newest first. Pages, since a Query stops at 1 MB and each summary is tens of KB. */
const listSummaries = async (limit: number) => {
  const summaries: HistoryRun[] = []
  let ExclusiveStartKey: Record<string, unknown> | undefined
  do {
    const page = await db.send(
      new QueryCommand({
        TableName: TABLE,
        KeyConditionExpression: 'pk = :pk',
        ExpressionAttributeValues: { ':pk': SUMMARIES_PK },
        ScanIndexForward: false,
        Limit: limit - summaries.length,
        ExclusiveStartKey,
      })
    )
    summaries.push(...(page.Items ?? []).map(toHistoryRun))
    ExclusiveStartKey = page.LastEvaluatedKey
  } while (ExclusiveStartKey && summaries.length < limit)
  return summaries
}

const isSecret = (candidate: string) => {
  if (!ADMIN_SECRET) return false
  const a = new TextEncoder().encode(candidate)
  const b = new TextEncoder().encode(ADMIN_SECRET)
  return a.length === b.length && timingSafeEqual(a, b)
}

const startRun = async () => {
  const { executionArn, startDate } = await sfn.send(
    new StartExecutionCommand({ stateMachineArn: STATE_MACHINE, input: '{}' })
  )
  return { runId: startDate?.toISOString(), executionArn }
}

/** UpdateSchedule replaces the whole schedule, so it gets back everything GetSchedule returned. */
const setSchedule = async (State: ScheduleState) => {
  const { Arn, CreationDate, LastModificationDate, $metadata, ...schedule } = await scheduler.send(
    new GetScheduleCommand({ Name: SCHEDULE })
  )
  if (schedule.State !== State) {
    await scheduler.send(
      new UpdateScheduleCommand({
        ...schedule,
        Name: SCHEDULE,
        ScheduleExpression: schedule.ScheduleExpression!,
        FlexibleTimeWindow: schedule.FlexibleTimeWindow!,
        Target: schedule.Target!,
        State,
      })
    )
  }
  return { state: State, was: schedule.State }
}

const deleteKeys = async (keys: Record<string, unknown>[]) => {
  let requests = keys.map((Key) => ({ DeleteRequest: { Key } }))
  for (let attempt = 0; requests.length; attempt++) {
    if (attempt) await new Promise((resolve) => setTimeout(resolve, 100 * 2 ** attempt))
    const { UnprocessedItems } = await db.send(
      new BatchWriteCommand({ RequestItems: { [TABLE!]: requests } })
    )
    requests = (UnprocessedItems?.[TABLE!] ?? []) as typeof requests
  }
}

/** Scans from the start each call, which only finds what earlier calls didn't delete. */
const purge = async () => {
  const deadline = Date.now() + PURGE_BUDGET_MS
  let deleted = 0
  let ExclusiveStartKey: Record<string, unknown> | undefined
  do {
    const page = await db.send(
      new ScanCommand({ TableName: TABLE, ProjectionExpression: 'pk, sk', ExclusiveStartKey })
    )
    const keys = page.Items ?? []
    // BatchWriteItem takes 25 requests at most.
    const batches = Array.from({ length: Math.ceil(keys.length / 25) }, (_, i) =>
      keys.slice(i * 25, (i + 1) * 25)
    )
    await Promise.all(batches.map(deleteKeys))
    deleted += keys.length
    ExclusiveStartKey = page.LastEvaluatedKey
  } while (ExclusiveStartKey && Date.now() < deadline)
  return { deleted, done: !ExclusiveStartKey }
}

const admin = async (method: string, action: string) => {
  if (method !== 'POST') return json(405, { error: 'POST only' }, 'no-store')
  if (action === 'run') return json(200, await startRun(), 'no-store')
  if (action === 'pause') return json(200, await setSchedule('DISABLED'), 'no-store')
  if (action === 'resume') return json(200, await setSchedule('ENABLED'), 'no-store')
  if (action === 'purge') return json(200, await purge(), 'no-store')
  return json(404, { error: 'No such action' }, 'no-store')
}

export const handler = async (event: LambdaFunctionURLEvent) => {
  const { method } = event.requestContext.http
  // Matched exactly: every spelling of a path is its own CloudFront cache key.
  const path = event.rawPath

  const [, secret, action] = path.match(/^\/admin\/([^/]+)\/([^/]+)$/) ?? []
  if (secret && isSecret(secret)) return admin(method, action)

  if (method !== 'GET') return json(405, { error: 'GET only' })
  const route = RUNS_ROUTES.get(path)
  if (!route) return json(404, { error: `No route for ${path}` })

  return gzipJson(route.body(await listSummaries(route.limit)), RUNS_CACHE)
}
