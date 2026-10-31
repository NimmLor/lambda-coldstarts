/**
 * One round of a run of the PerfRun state machine (infra/perf.ts), like lambda-perf's invoker:
 * forces a cold start of the target, invokes it once, then `warm` more times in the environment
 * that started, and stores Lambda's REPORT numbers in PerfResults. A Web Function's round goes
 * through web.ts instead. The state machine calls it once per round and retries it when it throws.
 */
import { DynamoDBClient } from '@aws-sdk/client-dynamodb'
import {
  GetFunctionConfigurationCommand,
  InvokeCommand,
  LambdaClient,
  UpdateFunctionConfigurationCommand,
  waitUntilFunctionUpdatedV2,
} from '@aws-sdk/client-lambda'
import { DynamoDBDocumentClient, PutCommand } from '@aws-sdk/lib-dynamodb'
import { expiresAt, type Sample, sampleSk, samplesPk } from './keys'
import { parseReport } from './report-line'
import { measureWeb, type WebTarget } from './web'

type FunctionTarget = { id: string; name: string; kind?: undefined }

export type MeasureEvent = {
  runId: string
  round: number
  target: FunctionTarget | WebTarget
  /** Invocations after the cold one, which find its environment warm. */
  warm: number
}

const lambda = new LambdaClient()
// `startupMs` is missing when a handler doesn't report it.
const db = DynamoDBDocumentClient.from(new DynamoDBClient(), {
  marshallOptions: { removeUndefinedValues: true },
})
const TABLE = process.env.PERF_TABLE

// What a Function URL would send, which src/report.ts reads back.
const EVENT = new TextEncoder().encode(
  JSON.stringify({ rawPath: '/perf', requestContext: { http: { method: 'GET' } } })
)

const invoke = async (target: FunctionTarget) => {
  const result = await lambda.send(
    new InvokeCommand({ FunctionName: target.name, LogType: 'Tail', Payload: EVENT })
  )
  const payload = new TextDecoder().decode(result.Payload)
  if (result.FunctionError) {
    throw new Error(`${target.id} failed (${result.FunctionError}): ${payload}`)
  }
  const report = parseReport(Buffer.from(result.LogResult ?? '', 'base64').toString('utf8'))
  return { report, payload }
}

const measureFunction = async (
  target: FunctionTarget,
  round: number,
  warm: number
): Promise<Omit<Sample, 'measuredAt'>> => {
  const config = await lambda.send(
    new GetFunctionConfigurationCommand({ FunctionName: target.name })
  )
  // Changing the configuration retires every warm execution environment of the function.
  await lambda.send(
    new UpdateFunctionConfigurationCommand({
      FunctionName: target.name,
      Environment: {
        Variables: {
          ...config.Environment?.Variables,
          BENCH_NONCE: String(Date.now()),
        },
      },
    })
  )
  await waitUntilFunctionUpdatedV2(
    { client: lambda, maxWaitTime: 120 },
    { FunctionName: target.name }
  )

  const { report, payload } = await invoke(target)
  // Without an Init Duration the invocation found a warm environment after all; the retry gets a cold one.
  if (report.initMs === undefined) {
    throw new Error(`${target.id} started warm in round ${round}`)
  }

  // One after another, so each finds the environment the cold start left. Should Lambda start
  // another one anyway, that invocation is a cold start, not a warm one, and is left out.
  const warmMs: number[] = []
  for (let i = 0; i < warm; i++) {
    const { report: warmReport } = await invoke(target)
    if (warmReport.initMs === undefined) warmMs.push(warmReport.durationMs)
  }

  const body = JSON.parse(JSON.parse(payload).body)
  return {
    functionId: target.id,
    round,
    runtime: config.Runtime ?? '?',
    arch: config.Architectures?.[0] ?? '?',
    memoryMb: config.MemorySize ?? 0,
    codeSizeMb: Math.round(((config.CodeSize ?? 0) / 1024 / 1024) * 10) / 10,
    initMs: report.initMs,
    durationMs: report.durationMs,
    billedMs: report.billedMs,
    maxMemoryMb: report.maxMemoryMb,
    warmMs,
    startupMs: body.container?.startupMs,
    // What the function was built with, see infra/functions.ts; the Node ones say which Node they are.
    version: config.Description || body.runtime,
    requestId: report.requestId,
  }
}

export const handler = async ({ runId, round, target, warm }: MeasureEvent) => {
  const sample: Sample = {
    ...(target.kind === 'web'
      ? await measureWeb(target, round, warm)
      : await measureFunction(target, round, warm)),
    measuredAt: new Date().toISOString(),
  }
  await db.send(
    new PutCommand({
      TableName: TABLE,
      Item: {
        pk: samplesPk(runId),
        sk: sampleSk(target.id, round),
        ...sample,
        expiresAt: expiresAt(runId),
      },
    })
  )
  return { functionId: target.id, round, initMs: sample.initMs }
}
