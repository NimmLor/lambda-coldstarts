/**
 * Benchmarks the deployed variants through the Lambda Invoke API.
 *
 * Each round forces fresh execution environments by changing an environment variable, then sends
 * `--cold` concurrent invocations, which all start cold. Afterwards `--warm` sequential invocations
 * hit a warm one. Timings come from the REPORT line Lambda returns with `LogType: Tail`, so they
 * are Lambda's own: `Init Duration` is the time from starting the runtime until it asks for the
 * first event, which for the Bun variants is exactly the executable's startup.
 *
 *   bun scripts/bench.ts [--rounds 3] [--cold 10] [--warm 20] [--only BunCompile,Node24]
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { parseArgs } from 'node:util'
import {
  GetFunctionConfigurationCommand,
  InvokeCommand,
  LambdaClient,
  UpdateFunctionConfigurationCommand,
  waitUntilFunctionUpdatedV2,
} from '@aws-sdk/client-lambda'

const { values: args } = parseArgs({
  options: {
    rounds: { type: 'string', default: '3' },
    cold: { type: 'string', default: '10' },
    warm: { type: 'string', default: '20' },
    only: { type: 'string' },
    outputs: { type: 'string', default: '.sst/outputs.json' },
  },
})
const ROUNDS = Number(args.rounds)
const COLD = Number(args.cold)
const WARM = Number(args.warm)

type Outputs = { functions: Record<string, { name: string; url: string }> }
const outputs = JSON.parse(await readFile(args.outputs, 'utf8')) as Outputs
const only = args.only?.split(',')
const targets = Object.entries(outputs.functions)
  .filter(([id]) => !only || only.includes(id))
  .map(([id, { name, url }]) => ({
    id,
    name,
    // https://<id>.lambda-url.<region>.on.aws/
    region: new URL(url).hostname.split('.')[2],
  }))
if (!targets.length) throw new Error(`No functions in ${args.outputs}`)

const clients = new Map<string, LambdaClient>()
const client = (region: string) => {
  let c = clients.get(region)
  if (!c) clients.set(region, (c = new LambdaClient({ region })))
  return c
}

type Sample = {
  cold: boolean
  initMs?: number
  durationMs: number
  billedMs: number
  maxMemoryMb: number
  clientMs: number
  startupMs?: number
}

const EVENT = JSON.stringify({
  rawPath: '/bench',
  requestContext: { http: { method: 'GET' } },
})

const parseReport = (logResult: string | undefined) => {
  const log = Buffer.from(logResult ?? '', 'base64').toString('utf8')
  const report = log.split('\n').find((line) => line.startsWith('REPORT'))
  if (!report) throw new Error(`No REPORT line in:\n${log}`)
  const ms = (label: string) => {
    const match = report.match(new RegExp(`${label}: ([\\d.]+) ms`))
    return match ? Number(match[1]) : undefined
  }
  return {
    initMs: ms('Init Duration'),
    durationMs: ms('Duration') ?? Number.NaN,
    billedMs: ms('Billed Duration') ?? Number.NaN,
    maxMemoryMb: Number(report.match(/Max Memory Used: (\d+) MB/)?.[1]),
  }
}

const invoke = async (target: (typeof targets)[number]): Promise<Sample> => {
  const started = performance.now()
  const result = await client(target.region).send(
    new InvokeCommand({
      FunctionName: target.name,
      LogType: 'Tail',
      Payload: new TextEncoder().encode(EVENT),
    })
  )
  const clientMs = performance.now() - started
  const payload = new TextDecoder().decode(result.Payload)
  if (result.FunctionError) {
    throw new Error(`${target.id} failed (${result.FunctionError}): ${payload}`)
  }
  const report = parseReport(result.LogResult)
  const body = JSON.parse(JSON.parse(payload).body)
  return {
    ...report,
    cold: report.initMs !== undefined,
    clientMs,
    startupMs: body.container?.startupMs,
  }
}

/** Changing the configuration retires every warm execution environment of the function. */
const forceColdStarts = async (target: (typeof targets)[number]) => {
  const lambda = client(target.region)
  const config = await lambda.send(
    new GetFunctionConfigurationCommand({ FunctionName: target.name })
  )
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
  return config
}

const samples = new Map<string, Sample[]>(targets.map((t) => [t.id, []]))
const configs = new Map<string, { codeSizeMb: number; runtime: string; arch: string; memory: number }>()

// Rounds interleave the variants, so a slow minute in the region doesn't land on one of them.
for (let round = 1; round <= ROUNDS; round++) {
  for (const target of targets) {
    const config = await forceColdStarts(target)
    configs.set(target.id, {
      codeSizeMb: Math.round(((config.CodeSize ?? 0) / 1024 / 1024) * 10) / 10,
      runtime: config.Runtime ?? '?',
      arch: config.Architectures?.[0] ?? '?',
      memory: config.MemorySize ?? 0,
    })
    const batch = await Promise.all(Array.from({ length: COLD }, () => invoke(target)))
    samples.get(target.id)!.push(...batch)
    console.log(`round ${round}/${ROUNDS} ${target.id}: ${batch.filter((s) => s.cold).length}/${COLD} cold`)
  }
}
for (const target of targets) {
  for (let i = 0; i < WARM; i++) samples.get(target.id)!.push(await invoke(target))
}

const percentile = (values: number[], p: number) => {
  const sorted = values.filter((v) => Number.isFinite(v)).sort((a, b) => a - b)
  if (!sorted.length) return Number.NaN
  return sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))]!
}
const fmt = (value: number, unit = ' ms') =>
  Number.isFinite(value) ? `${Math.round(value * 10) / 10}${unit}` : '–'

const rows = targets.map(({ id }) => {
  const all = samples.get(id)!
  const cold = all.filter((s) => s.cold)
  const warm = all.filter((s) => !s.cold)
  const config = configs.get(id)!
  return {
    id,
    ...config,
    coldSamples: cold.length,
    initP50: percentile(cold.map((s) => s.initMs!), 50),
    initP90: percentile(cold.map((s) => s.initMs!), 90),
    startupP50: percentile(cold.map((s) => s.startupMs ?? Number.NaN), 50),
    coldDurationP50: percentile(cold.map((s) => s.durationMs), 50),
    coldClientP50: percentile(cold.map((s) => s.clientMs), 50),
    warmDurationP50: percentile(warm.map((s) => s.durationMs), 50),
    warmClientP50: percentile(warm.map((s) => s.clientMs), 50),
    maxMemoryP50: percentile(all.map((s) => s.maxMemoryMb), 50),
  }
})

const first = rows[0]!
const archs = [...new Set(rows.map((r) => r.arch))].join(' and ')
const markdown = [
  `${archs}, ${first.memory} MB, ${ROUNDS}×${COLD} cold + ${WARM} warm invocations per variant`,
  '',
  '| Variant | Runtime | Code size | Init p50 | Init p90 | In-process startup p50 | Cold invoke p50 | Cold round trip p50 | Warm invoke p50 | Warm round trip p50 | Max memory p50 |',
  '|---|---|---|---|---|---|---|---|---|---|---|',
  ...rows.map((r) =>
    [
      r.id,
      r.runtime,
      fmt(r.codeSizeMb, ' MB'),
      fmt(r.initP50),
      fmt(r.initP90),
      fmt(r.startupP50),
      fmt(r.coldDurationP50),
      fmt(r.coldClientP50),
      fmt(r.warmDurationP50),
      fmt(r.warmClientP50),
      fmt(r.maxMemoryP50, ' MB'),
    ].join(' | ')
  ).map((line) => `| ${line} |`),
].join('\n')
console.log(`\n${markdown}`)

await mkdir('bench-results', { recursive: true })
const stamp = new Date().toISOString().replaceAll(':', '-')
await writeFile(
  `bench-results/${stamp}.json`,
  JSON.stringify({ args: { ROUNDS, COLD, WARM }, rows, samples: Object.fromEntries(samples) }, null, 2)
)
await writeFile(`bench-results/${stamp}.md`, `${markdown}\n`)
console.log(`\nResults: bench-results/${stamp}.{md,json}`)
