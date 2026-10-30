/**
 * Copies a month of PerfResults to the PerfArchive bucket, long before DynamoDB's TTL deletes it
 * (keys.ts). PerfExportSchedule (infra/perf.ts) invokes it on the 1st for the month before, and
 * scripts/perf-export.ts exports any month by hand. A run belongs to the month it started in, and
 * exporting a month again replaces its files:
 *
 *   <yyyy>/<mm>/runs.ndjson.gz      a line per recorded run, oldest first, with its per-function
 *                                   statistics as `functions` once it has a summary
 *   <yyyy>/<mm>/samples.ndjson.gz   a line per cold start, with its `runId`; written last
 *
 * Both stream from DynamoDB through gzip into a multipart upload, so a month never sits in memory.
 */
import { Readable } from 'node:stream'
import { createGzip } from 'node:zlib'
import { DynamoDBClient } from '@aws-sdk/client-dynamodb'
import { S3Client } from '@aws-sdk/client-s3'
import { DynamoDBDocumentClient, GetCommand, QueryCommand } from '@aws-sdk/lib-dynamodb'
import { Upload } from '@aws-sdk/lib-storage'
import { RUNS_PK, SUMMARIES_PK, samplesPk } from './keys'

/** `yyyy-mm`, the month before the current one by default. */
export type ExportEvent = { month?: string }

type Item = Record<string, unknown>

const db = DynamoDBDocumentClient.from(new DynamoDBClient())
const s3 = new S3Client()

/** The month before the one `now` falls in, in UTC like run ids. */
export const previousMonth = (now: Date) =>
  new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1)).toISOString().slice(0, 7)

export const archiveKey = (month: string, file: 'runs' | 'samples') =>
  `${month.replace('-', '/')}/${file}.ndjson.gz`

/** The items under `pk`, in sort key order; with `prefix`, those whose sort key starts with it. */
async function* query(table: string, pk: string, prefix?: string) {
  let ExclusiveStartKey: Item | undefined
  do {
    const page = await db.send(
      new QueryCommand({
        TableName: table,
        KeyConditionExpression: prefix ? 'pk = :pk AND begins_with(sk, :prefix)' : 'pk = :pk',
        ExpressionAttributeValues: { ':pk': pk, ...(prefix && { ':prefix': prefix }) },
        ExclusiveStartKey,
      })
    )
    yield* page.Items ?? []
    ExclusiveStartKey = page.LastEvaluatedKey
  } while (ExclusiveStartKey)
}

/** An item without what only the table needs. */
const data = ({ pk, sk, expiresAt, ...rest }: Item) => rest

const upload = async (bucket: string, key: string, lines: AsyncIterable<string>) => {
  const body = createGzip()
  // An error in `lines` destroys the body, which fails the upload with it.
  Readable.from(lines)
    .on('error', (error) => body.destroy(error))
    .pipe(body)
  await new Upload({
    client: s3,
    params: { Bucket: bucket, Key: key, Body: body, ContentType: 'application/gzip' },
  }).done()
}

export const exportMonth = async (
  month: string,
  { table, bucket }: { table: string; bucket: string }
) => {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw new Error(`Not a month: ${month}`)

  const runIds: string[] = []
  async function* runs() {
    for await (const run of query(table, RUNS_PK, month)) {
      const runId = run.sk as string
      runIds.push(runId)
      const { Item: summary } = await db.send(
        new GetCommand({ TableName: table, Key: { pk: SUMMARIES_PK, sk: runId } })
      )
      yield `${JSON.stringify({ runId, ...data(run), functions: summary?.functions })}\n`
    }
  }
  await upload(bucket, archiveKey(month, 'runs'), runs())

  let samples = 0
  async function* sampleLines() {
    for (const runId of runIds) {
      for await (const sample of query(table, samplesPk(runId))) {
        samples++
        yield `${JSON.stringify({ runId, ...data(sample) })}\n`
      }
    }
  }
  await upload(bucket, archiveKey(month, 'samples'), sampleLines())

  return { month, runs: runIds.length, samples }
}

export const handler = ({ month = previousMonth(new Date()) }: ExportEvent) =>
  exportMonth(month, { table: process.env.PERF_TABLE!, bucket: process.env.PERF_ARCHIVE! })
