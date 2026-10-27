/**
 * Starts a run of the PerfRun state machine (infra/perf.ts) by hand and waits for it, printing
 * progress. Reads the state machine from `sst shell`, under which it restarts itself.
 *
 *   bun scripts/perf-run.ts [--stage dev] [--detach]
 */
import { spawnSync } from 'node:child_process'
import { parseArgs } from 'node:util'
import { DescribeExecutionCommand, SFNClient, StartExecutionCommand } from '@aws-sdk/client-sfn'
import { Resource } from 'sst'

const { values: args } = parseArgs({
  options: {
    stage: { type: 'string' },
    detach: { type: 'boolean', default: false },
  },
})

// `sst shell` sets SST_RESOURCE_* for every resource of the stage, PerfRun among them.
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
const { arn } = (Resource as unknown as { PerfRun: { arn: string } }).PerfRun
const sfn = new SFNClient()
const region = await sfn.config.region()

const { executionArn, startDate } = await sfn.send(
  new StartExecutionCommand({ stateMachineArn: arn, input: '{}' })
)
console.log(`Started run ${startDate?.toISOString()}`)
console.log(
  `https://${region}.console.aws.amazon.com/states/home?region=${region}#/v2/executions/details/${executionArn}`
)
if (args.detach) process.exit(0)

const started = Date.now()
while (true) {
  await Bun.sleep(10_000)
  const { status, error, cause } = await sfn.send(new DescribeExecutionCommand({ executionArn }))
  const elapsed = `${Math.round((Date.now() - started) / 1000)} s`
  if (status === 'RUNNING') {
    console.log(`running, ${elapsed}`)
    continue
  }
  console.log(`${status} after ${elapsed}${error ? `: ${error} ${cause ?? ''}` : ''}`)
  process.exit(status === 'SUCCEEDED' ? 0 : 1)
}
