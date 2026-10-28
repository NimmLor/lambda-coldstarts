/**
 * The read side of PerfResults for the site in web/, behind a Function URL:
 *
 *   GET /runs              the latest finished runs, newest first
 *   GET /runs/history      the summaries of the latest `?limit=` runs (30, at most 90), newest first
 *   GET /runs/latest       the summary of the newest one
 *   GET /runs/<runId>      the summary of that one
 *
 * And, only when PERF_ADMIN_SECRET is set, routes under it that 404 like any other otherwise:
 *
 *   POST /admin/<secret>/run     starts a run of the PerfRun state machine
 *   POST /admin/<secret>/pause   disables the hourly schedule that starts it
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
  GetCommand,
  QueryCommand,
  ScanCommand,
} from '@aws-sdk/lib-dynamodb'
import type { LambdaFunctionURLEvent } from 'aws-lambda'
import { RUNS_PK, SUMMARIES_PK } from './keys'

const db = DynamoDBDocumentClient.from(new DynamoDBClient())
const sfn = new SFNClient()
const scheduler = new SchedulerClient()
const TABLE = process.env.PERF_TABLE
const STATE_MACHINE = process.env.PERF_STATE_MACHINE
const SCHEDULE = process.env.PERF_SCHEDULE
const ADMIN_SECRET = process.env.PERF_ADMIN_SECRET
/** Leaves room under PerfRouter's 20 s origin timeout, which is also the function's. */
const PURGE_BUDGET_MS = 15_000

const json = (statusCode: number, body: unknown, cacheControl = 'max-age=60') => ({
  statusCode,
  headers: { 'content-type': 'application/json', 'cache-control': cacheControl },
  body: JSON.stringify(body),
})

type Run = {
  runId: string
  finishedAt: string
  rounds: number
  /** Per round; missing from runs before warm invocations were measured. */
  warmInvocations?: number
  functionCount: number
}

const toRun = ({
  sk,
  finishedAt,
  rounds,
  warmInvocations,
  functionCount,
}: Record<string, unknown>) =>
  ({ runId: sk, finishedAt, rounds, warmInvocations, functionCount }) as Run

const listRuns = async (limit = 30) => {
  const { Items = [] } = await db.send(
    new QueryCommand({
      TableName: TABLE,
      KeyConditionExpression: 'pk = :pk',
      ExpressionAttributeValues: { ':pk': RUNS_PK },
      ScanIndexForward: false,
      Limit: limit,
    })
  )
  return Items.map(toRun)
}

const toSummary = ({ pk, sk, ...summary }: Record<string, unknown>) => summary

const getSummary = async (runId: string) => {
  const { Item } = await db.send(
    new GetCommand({ TableName: TABLE, Key: { pk: SUMMARIES_PK, sk: runId } })
  )
  return Item && toSummary(Item)
}

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
  const path = event.rawPath.replace(/\/+$/, '')

  const [, secret, action] = path.match(/^\/admin\/([^/]+)\/([^/]+)$/) ?? []
  if (secret && isSecret(secret)) return admin(method, action)

  if (method !== 'GET') return json(405, { error: 'GET only' })

  if (path === '/runs') return json(200, { runs: await listRuns() })

  if (path === '/runs/history') {
    const limit = Math.min(Math.max(Number(event.queryStringParameters?.limit) || 30, 1), 90)
    return json(200, { runs: await listSummaries(limit) })
  }

  const id = path.match(/^\/runs\/([^/]+)$/)?.[1]
  if (!id) return json(404, { error: `No route for ${path}` })
  const summary =
    id === 'latest' ? (await listSummaries(1))[0] : await getSummary(decodeURIComponent(id))
  if (!summary) return json(404, { error: 'No such run' })

  return json(200, summary)
}
