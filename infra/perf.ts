/**
 * A scheduled cold-start benchmark in the style of maxday/lambda-perf. The PerfRun state machine
 * goes through `PERF_CONCURRENCY` functions at a time, forcing `PERF_ROUNDS` cold starts one after
 * another (src/perf/measure.ts stores each REPORT in PerfResults), then records the run. PerfApi
 * serves the results to the React site in web/.
 */
import { RUNS_PK } from '../src/perf/keys'

const ROUNDS = Number(process.env.PERF_ROUNDS ?? 10)
/**
 * Functions measured at once. Each holds two concurrent executions, PerfMeasure waiting on its
 * synchronous invoke of the target, so 4 stays within a new account's limit of 10 and leaves
 * room for PerfApi.
 */
const CONCURRENCY = Number(process.env.PERF_CONCURRENCY ?? 4)

/** Every day at 11:00 UTC in production, as lambda-perf does; `PERF_SCHEDULE` overrides it on any stage. */
const schedule = () =>
  process.env.PERF_SCHEDULE ?? ($app.stage === 'production' ? 'cron(0 11 * * ? *)' : undefined)

/** The site's domain: coldstarts.github.nimmervoll.work in production, `<stage>.` in front of it elsewhere. */
const siteDomain = () => {
  const zone = 'github.nimmervoll.work'
  const name = `coldstarts.${zone}`
  return {
    name: $app.stage === 'production' ? name : `${$app.stage}.${name}`,
    dns: sst.aws.dns({ zone: aws.route53.getZoneOutput({ name: zone }).zoneId }),
  }
}

export const createPerf = (functions: Record<string, sst.aws.Function>) => {
  const table = new sst.aws.Dynamo('PerfResults', {
    fields: { pk: 'string', sk: 'string' },
    primaryIndex: { hashKey: 'pk', rangeKey: 'sk' },
  })

  const measure = new sst.aws.Function('PerfMeasure', {
    handler: 'src/perf/measure.handler',
    runtime: 'nodejs24.x',
    timeout: '3 minutes',
    // `link` grants access; the name comes through the environment, so the handlers don't depend on
    // sst-env.d.ts, which tsconfig.json doesn't include.
    link: [table],
    environment: { PERF_TABLE: table.name },
    permissions: [
      {
        actions: [
          'lambda:GetFunctionConfiguration',
          // What waitUntilFunctionUpdatedV2 polls.
          'lambda:GetFunction',
          'lambda:UpdateFunctionConfiguration',
          'lambda:InvokeFunction',
        ],
        resources: Object.values(functions).map((fn) => fn.arn),
      },
    ],
  })

  const runId = '{% $states.context.Execution.StartTime %}'

  const measureRound = sst.aws.StepFunctions.lambdaInvoke({
    name: 'Measure',
    function: measure,
    payload: {
      runId,
      target: '{% $states.input.target %}',
      round: '{% $states.input.round %}',
    },
    output: {},
  }).retry({ interval: '10 seconds', maxAttempts: 3, backoffRate: 2 })

  // One round after another: each one changes the function's configuration, which can't overlap.
  const rounds = sst.aws.StepFunctions.map({
    name: 'Rounds',
    items: Array.from({ length: ROUNDS }, (_, i) => i + 1),
    itemSelector: {
      target: '{% $states.input %}',
      round: '{% $states.context.Map.Item.Value %}',
    },
    maxConcurrency: 1,
    processor: measureRound,
    output: {},
  })

  // A function that keeps failing loses its remaining rounds, not the whole run.
  const skipped = sst.aws.StepFunctions.pass({
    name: 'Skipped',
    output: { error: '{% $states.input.Error %}' },
  })

  const run = sst.aws.StepFunctions.map({
    name: 'Functions',
    items: Object.entries(functions).map(([id, fn]) => ({ id, name: fn.name })),
    maxConcurrency: CONCURRENCY,
    processor: rounds.catch(skipped),
    output: {},
  })

  const recordRun = sst.aws.StepFunctions.task({
    name: 'RecordRun',
    resource: 'arn:aws:states:::dynamodb:putItem',
    arguments: {
      TableName: table.name,
      Item: {
        pk: { S: RUNS_PK },
        sk: { S: runId },
        finishedAt: { S: '{% $now() %}' },
        rounds: { N: String(ROUNDS) },
        functionCount: { N: String(Object.keys(functions).length) },
      },
    },
    permissions: [{ actions: ['dynamodb:PutItem'], resources: [table.arn] }],
  })

  const stateMachine = new sst.aws.StepFunctions('PerfRun', {
    definition: run.next(recordRun),
  })

  const cron = schedule()
  if (cron) {
    const role = new aws.iam.Role('PerfScheduleRole', {
      assumeRolePolicy: aws.iam.assumeRolePolicyForPrincipal({
        Service: 'scheduler.amazonaws.com',
      }),
      inlinePolicies: [
        {
          name: 'start-perf-run',
          policy: $jsonStringify({
            Version: '2012-10-17',
            Statement: [
              { Effect: 'Allow', Action: 'states:StartExecution', Resource: stateMachine.arn },
            ],
          }),
        },
      ],
    })
    new aws.scheduler.Schedule('PerfSchedule', {
      scheduleExpression: cron,
      flexibleTimeWindow: { mode: 'OFF' },
      target: { arn: stateMachine.arn, roleArn: role.arn },
    })
  }

  const api = new sst.aws.Function('PerfApi', {
    handler: 'src/perf/api.handler',
    runtime: 'nodejs24.x',
    url: true,
    link: [table],
    environment: { PERF_TABLE: table.name },
  })

  const site = new sst.aws.StaticSite('PerfSite', {
    path: 'web',
    build: { command: 'bun run build', output: 'dist' },
    environment: { BUN_PUBLIC_API_URL: api.url },
    domain: siteDomain(),
  })

  return { api: api.url, site: site.url, stateMachine: stateMachine.arn }
}
