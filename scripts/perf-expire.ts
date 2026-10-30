/**
 * Gives the PerfResults items written before runs expired, which have no `expiresAt`, the one
 * their run would have got (src/perf/keys.ts), so DynamoDB's TTL deletes them too: within a few
 * days for any run older than RETENTION_DAYS. Only items of months PerfArchive holds, and of the
 * current one, which PerfExport exports on the 1st; it names the months it skipped, which
 * scripts/perf-export.ts exports. Reads the stage's resources from `sst shell`, under which it
 * restarts itself.
 *
 *   bun scripts/perf-expire.ts [--stage production]
 */
import { spawnSync } from 'node:child_process'
import { parseArgs } from 'node:util'
import { ConditionalCheckFailedException, DynamoDBClient } from '@aws-sdk/client-dynamodb'
import { HeadObjectCommand, NotFound, S3Client } from '@aws-sdk/client-s3'
import { DynamoDBDocumentClient, ScanCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb'
import { Resource } from 'sst'
import { archiveKey } from '../src/perf/export'
import { expiresAt, runIdOf } from '../src/perf/keys'

const { values: args } = parseArgs({ options: { stage: { type: 'string' } } })

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
const TABLE = resources.PerfResults.name
const db = DynamoDBDocumentClient.from(new DynamoDBClient())
const s3 = new S3Client()

const current = new Date().toISOString().slice(0, 7)
const archived = new Map<string, Promise<boolean>>()
/** Whether PerfArchive holds `month`, whose samples file an export writes last. */
const isArchived = (month: string) => {
  if (!archived.has(month)) {
    archived.set(
      month,
      s3
        .send(
          new HeadObjectCommand({
            Bucket: resources.PerfArchive.name,
            Key: archiveKey(month, 'samples'),
          })
        )
        .then(
          () => true,
          (error) => {
            if (error instanceof NotFound) return false
            throw error
          }
        )
    )
  }
  return archived.get(month)!
}

const expiring = new Map<string, number>()
const skipped = new Map<string, number>()
const count = (counts: Map<string, number>, month: string) =>
  counts.set(month, (counts.get(month) ?? 0) + 1)

const expire = async (key: { pk: string; sk: string }) => {
  const runId = runIdOf(key)
  const expiry = runId && expiresAt(runId)
  if (!runId || !expiry) {
    console.warn(`Skipping ${key.pk} ${key.sk}: not an item of a run`)
    return
  }
  const month = runId.slice(0, 7)
  if (month !== current && !(await isArchived(month))) {
    count(skipped, month)
    return
  }
  try {
    await db.send(
      new UpdateCommand({
        TableName: TABLE,
        Key: key,
        UpdateExpression: 'SET expiresAt = :expiresAt',
        // Not one that was deleted in the meantime, which the update would write back.
        ConditionExpression: 'attribute_exists(pk)',
        ExpressionAttributeValues: { ':expiresAt': expiry },
      })
    )
    count(expiring, month)
  } catch (error) {
    if (!(error instanceof ConditionalCheckFailedException)) throw error
  }
}

let ExclusiveStartKey: Record<string, unknown> | undefined
do {
  const page = await db.send(
    new ScanCommand({
      TableName: TABLE,
      ProjectionExpression: 'pk, sk',
      FilterExpression: 'attribute_not_exists(expiresAt)',
      ExclusiveStartKey,
    })
  )
  const keys = (page.Items ?? []) as { pk: string; sk: string }[]
  // A page can hold thousands of keys; 50 updates at a time.
  for (let i = 0; i < keys.length; i += 50) await Promise.all(keys.slice(i, i + 50).map(expire))
  ExclusiveStartKey = page.LastEvaluatedKey
} while (ExclusiveStartKey)

for (const [month, items] of [...expiring].sort()) console.log(`${month}: ${items} items expire`)
for (const [month, items] of [...skipped].sort()) {
  console.log(`${month}: ${items} items skipped, not archived yet`)
}
if (skipped.size) {
  console.log('Export those with `bun scripts/perf-export.ts --all`, then run this again.')
}
