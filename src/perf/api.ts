/**
 * The read side of PerfResults for the site in web/, behind a Function URL:
 *
 *   GET /runs              the latest finished runs, newest first
 *   GET /runs/latest       the summary of the newest one
 *   GET /runs/<runId>      the summary of that one
 */
import { DynamoDBClient } from '@aws-sdk/client-dynamodb'
import { DynamoDBDocumentClient, GetCommand, QueryCommand } from '@aws-sdk/lib-dynamodb'
import type { LambdaFunctionURLEvent } from 'aws-lambda'
import { RUNS_PK, type Sample, samplesPk } from './keys'
import { summarize } from './summary'

const db = DynamoDBDocumentClient.from(new DynamoDBClient())
const TABLE = process.env.PERF_TABLE

const json = (statusCode: number, body: unknown) => ({
  statusCode,
  headers: { 'content-type': 'application/json', 'cache-control': 'max-age=60' },
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

const toRun = ({ sk, finishedAt, rounds, warmInvocations, functionCount }: Record<string, unknown>) =>
  ({ runId: sk, finishedAt, rounds, warmInvocations, functionCount }) as Run

const getRun = async (runId: string) => {
  const { Item } = await db.send(
    new GetCommand({ TableName: TABLE, Key: { pk: RUNS_PK, sk: runId } })
  )
  return Item && toRun(Item)
}

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

const listSamples = async (runId: string) => {
  const samples: Sample[] = []
  let ExclusiveStartKey: Record<string, unknown> | undefined
  do {
    const page = await db.send(
      new QueryCommand({
        TableName: TABLE,
        KeyConditionExpression: 'pk = :pk',
        ExpressionAttributeValues: { ':pk': samplesPk(runId) },
        ExclusiveStartKey,
      })
    )
    samples.push(...((page.Items ?? []) as Sample[]))
    ExclusiveStartKey = page.LastEvaluatedKey
  } while (ExclusiveStartKey)
  return samples
}

export const handler = async (event: LambdaFunctionURLEvent) => {
  if (event.requestContext.http.method !== 'GET') return json(405, { error: 'GET only' })
  const path = event.rawPath.replace(/\/+$/, '')

  if (path === '/runs') return json(200, { runs: await listRuns() })

  const id = path.match(/^\/runs\/([^/]+)$/)?.[1]
  if (!id) return json(404, { error: `No route for ${path}` })
  const run = id === 'latest' ? (await listRuns(1))[0] : await getRun(decodeURIComponent(id))
  if (!run) return json(404, { error: 'No such run' })

  return json(200, { ...run, functions: summarize(await listSamples(run.runId)) })
}
