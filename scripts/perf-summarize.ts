/**
 * Stores the summary of every recorded run that has none yet, by invoking PerfSummarize
 * (src/perf/summarize.ts) for it: the runs from before the state machine summarized them itself.
 * `--all` summarizes every run again. Reads the stage's resources from `sst shell`, under which
 * it restarts itself.
 *
 *   bun scripts/perf-summarize.ts [--stage dev] [--all]
 */
import { spawnSync } from 'node:child_process'
import { parseArgs } from 'node:util'
import { DynamoDBClient } from '@aws-sdk/client-dynamodb'
import { InvokeCommand, LambdaClient } from '@aws-sdk/client-lambda'
import { DynamoDBDocumentClient, QueryCommand } from '@aws-sdk/lib-dynamodb'
import { Resource } from 'sst'
import { RUNS_PK, SUMMARIES_PK } from '../src/perf/keys'
import type { SummarizeEvent } from '../src/perf/summarize'

const { values: args } = parseArgs({
  options: {
    stage: { type: 'string' },
    all: { type: 'boolean', default: false },
  },
})

if (!process.env.SST_RESOURCE_App) {
  const stage = args.stage ? ['--stage', args.stage] : []
  const shell = spawnSync(
    'bunx',
    ['sst', 'shell', ...stage, '--', 'bun', import.meta.path, ...process.argv.slice(2)],
    { stdio: 'inherit' }
  )
  process.exit(shell.status ?? 1)
}

// tsconfig.json doesn't include sst-env.d.ts, which types Resource from whatever stage deployed last.
const resources = Resource as unknown as {
  PerfResults: { name: string }
  PerfSummarize: { name: string }
}
const db = DynamoDBDocumentClient.from(new DynamoDBClient())
const lambda = new LambdaClient()

const runIds = async (pk: string) => {
  const ids: string[] = []
  let ExclusiveStartKey: Record<string, unknown> | undefined
  do {
    const page = await db.send(
      new QueryCommand({
        TableName: resources.PerfResults.name,
        KeyConditionExpression: 'pk = :pk',
        ExpressionAttributeValues: { ':pk': pk },
        ProjectionExpression: 'sk',
        ExclusiveStartKey,
      })
    )
    ids.push(...(page.Items ?? []).map((item) => item.sk as string))
    ExclusiveStartKey = page.LastEvaluatedKey
  } while (ExclusiveStartKey)
  return ids
}

const summarized = new Set(args.all ? [] : await runIds(SUMMARIES_PK))
const pending = (await runIds(RUNS_PK)).filter((id) => !summarized.has(id))
console.log(`${pending.length} runs to summarize`)

let failed = 0
for (const runId of pending) {
  const event: SummarizeEvent = { runId }
  const result = await lambda.send(
    new InvokeCommand({
      FunctionName: resources.PerfSummarize.name,
      Payload: new TextEncoder().encode(JSON.stringify(event)),
    })
  )
  const payload = new TextDecoder().decode(result.Payload)
  if (result.FunctionError) {
    failed++
    console.error(`${runId} failed: ${payload}`)
  } else {
    console.log(`${runId}: ${JSON.parse(payload).functions} functions`)
  }
}
process.exit(failed ? 1 : 0)
