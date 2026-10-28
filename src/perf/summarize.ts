/**
 * The last step of a run of the PerfRun state machine (infra/perf.ts): summarizes the run's
 * samples once and stores the run with its per-function statistics under `summaries`, so PerfApi
 * reads a run as one item instead of every cold start. scripts/perf-summarize.ts calls it for
 * runs recorded before this step existed.
 */
import { DynamoDBClient } from '@aws-sdk/client-dynamodb'
import { DynamoDBDocumentClient, GetCommand, PutCommand, QueryCommand } from '@aws-sdk/lib-dynamodb'
import { RUNS_PK, type Sample, SUMMARIES_PK, samplesPk } from './keys'
import { summarize } from './summary'

export type SummarizeEvent = { runId: string }

// `warmInvocations` is missing from runs before warm invocations were measured.
const db = DynamoDBDocumentClient.from(new DynamoDBClient(), {
  marshallOptions: { removeUndefinedValues: true },
})
const TABLE = process.env.PERF_TABLE

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

export const handler = async ({ runId }: SummarizeEvent) => {
  const { Item: run } = await db.send(
    new GetCommand({ TableName: TABLE, Key: { pk: RUNS_PK, sk: runId } })
  )
  if (!run) throw new Error(`No run ${runId}`)
  const functions = summarize(await listSamples(runId))
  const { finishedAt, rounds, warmInvocations, functionCount } = run
  await db.send(
    new PutCommand({
      TableName: TABLE,
      Item: {
        pk: SUMMARIES_PK,
        sk: runId,
        runId,
        finishedAt,
        rounds,
        warmInvocations,
        functionCount,
        functions,
      },
    })
  )
  return { runId, functions: functions.length }
}
