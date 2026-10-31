/**
 * Exports months of PerfResults to the PerfArchive bucket from here, with what PerfExport runs on
 * the 1st (src/perf/export.ts). `--all` exports every month before the current one that has runs,
 * such as those from before the export existed; scripts/perf-expire.ts then lets them expire.
 * Reads the stage's resources from `sst shell`, under which it restarts itself.
 *
 *   bun scripts/perf-export.ts [--stage production] (--month 2026-10 | --all)
 */
import { spawnSync } from 'node:child_process'
import { parseArgs } from 'node:util'
import { DynamoDBClient } from '@aws-sdk/client-dynamodb'
import { DynamoDBDocumentClient, QueryCommand } from '@aws-sdk/lib-dynamodb'
import { Resource } from 'sst'
import { exportMonth } from '../src/perf/export'
import { RUNS_PK } from '../src/perf/keys'

const { values: args } = parseArgs({
  options: {
    stage: { type: 'string' },
    month: { type: 'string' },
    all: { type: 'boolean', default: false },
  },
})

if (!args.month === !args.all) {
  console.error('Pass --month yyyy-mm or --all')
  process.exit(1)
}

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
  PerfArchive: { name: string }
}
const target = { table: resources.PerfResults.name, bucket: resources.PerfArchive.name }

/** Every month before the current one with a run in it, oldest first. */
const pastMonths = async () => {
  const db = DynamoDBDocumentClient.from(new DynamoDBClient())
  const current = new Date().toISOString().slice(0, 7)
  const months = new Set<string>()
  let ExclusiveStartKey: Record<string, unknown> | undefined
  do {
    const page = await db.send(
      new QueryCommand({
        TableName: target.table,
        KeyConditionExpression: 'pk = :pk',
        ExpressionAttributeValues: { ':pk': RUNS_PK },
        ProjectionExpression: 'sk',
        ExclusiveStartKey,
      })
    )
    for (const { sk } of page.Items ?? []) months.add((sk as string).slice(0, 7))
    ExclusiveStartKey = page.LastEvaluatedKey
  } while (ExclusiveStartKey)
  return [...months].filter((month) => month < current)
}

for (const month of args.month ? [args.month] : await pastMonths()) {
  const { runs, samples } = await exportMonth(month, target)
  console.log(`${month}: ${runs} runs, ${samples} samples`)
}
