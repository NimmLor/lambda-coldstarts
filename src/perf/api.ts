/**
 * The read side of PerfResults for the site in web/, behind PerfRouter:
 *
 *   GET /runs/history      the summaries of the latest `HISTORY_RUNS` runs, newest first
 *
 * That is all the site asks for, and all anyone gets: no parameters, so every request is the same
 * one CloudFront answers from its cache, which leaves query strings out of the key (infra/perf.ts).
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
import { SUMMARIES_PK } from './keys'

const db = DynamoDBDocumentClient.from(new DynamoDBClient())
const sfn = new SFNClient()
const scheduler = new SchedulerClient()
const TABLE = process.env.PERF_TABLE
const STATE_MACHINE = process.env.PERF_STATE_MACHINE
const SCHEDULE = process.env.PERF_SCHEDULE
const ADMIN_SECRET = process.env.PERF_ADMIN_SECRET
/** What /runs/history returns: the site's longest range. */
const HISTORY_RUNS = 90
/**
 * A new run arrives every 4 hours, and summarize.ts invalidates /runs/history when it does, so
 * CloudFront keeps it that long and, past that, answers from its copy while it fetches a new one.
 * Browsers still ask again after a minute, which CloudFront answers.
 */
const HISTORY_CACHE = 'max-age=60, s-maxage=14400, stale-while-revalidate=86400'
/** Leaves room under PerfRouter's 20 s origin timeout, which is also the function's. */
const PURGE_BUDGET_MS = 15_000

const json = (statusCode: number, body: unknown, cacheControl = 'max-age=60') => ({
  statusCode,
  headers: { 'content-type': 'application/json', 'cache-control': cacheControl },
  body: JSON.stringify(body),
})

const toSummary = ({ pk, sk, expiresAt, ...summary }: Record<string, unknown>) => summary

/** Newest first. Pages, since a Query stops at 1 MB and each summary is tens of KB. */
const listSummaries = async (limit: number) => {
  const summaries: Record<string, unknown>[] = []
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
    summaries.push(...(page.Items ?? []).map(toSummary))
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
  if (path !== '/runs/history') return json(404, { error: `No route for ${path}` })

  return json(200, { runs: await listSummaries(HISTORY_RUNS) }, HISTORY_CACHE)
}
