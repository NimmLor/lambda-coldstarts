/**
 * A scheduled cold-start benchmark in the style of maxday/lambda-perf. The PerfRun state machine
 * goes through `PERF_CONCURRENCY` functions at a time, forcing `PERF_ROUNDS` cold starts one after
 * another, each followed by `PERF_WARM` warm invocations (src/perf/measure.ts stores their REPORTs
 * in PerfResults), then records the run. PerfApi
 * serves the results to the React site in web/ and, with PERF_ADMIN_SECRET set, starts runs and
 * purges the table.
 */
import { RUNS_PK } from '../src/perf/keys'
import { BENCH_TAG } from './functions'

const ROUNDS = Number(process.env.PERF_ROUNDS ?? 10)
/** Invocations after each round's cold start, which find its environment warm. */
const WARM = Number(process.env.PERF_WARM ?? 5)
/**
 * Functions measured at once. Each holds two concurrent executions, PerfMeasure waiting on its
 * synchronous invoke of the target, so 4 stays within a new account's limit of 10 and leaves
 * room for PerfApi.
 */
const CONCURRENCY = Number(process.env.PERF_CONCURRENCY ?? 4)

/** How often EventBridge Scheduler starts PerfRun, on every stage. */
const SCHEDULE = 'rate(1 hour)'

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
    memory: "128 MB",
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
        // Every function's ARN outgrows an inline policy, so the functions' tag picks them instead.
        resources: ['arn:aws:lambda:*:*:function:*'],
        conditions: [
          { test: 'StringEquals', variable: `aws:ResourceTag/${BENCH_TAG.key}`, values: [BENCH_TAG.value] },
        ],
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
      warm: WARM,
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
        warmInvocations: { N: String(WARM) },
        functionCount: { N: String(Object.keys(functions).length) },
      },
    },
    permissions: [{ actions: ['dynamodb:PutItem'], resources: [table.arn] }],
  })

  const stateMachine = new sst.aws.StepFunctions('PerfRun', {
    definition: run.next(recordRun),
  })

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
    scheduleExpression: SCHEDULE,
    flexibleTimeWindow: { mode: 'OFF' },
    target: { arn: stateMachine.arn, roleArn: role.arn },
  })

  // One CloudFront distribution for the site and, under /api, PerfApi, so the page fetches its
  // own origin.
  const router = new sst.aws.Router('PerfRouter', { domain: siteDomain() })

  const api = new sst.aws.Function('PerfApi', {
    handler: 'src/perf/api.handler',
    runtime: 'nodejs24.x',
    url: {
      // The handler's routes start at /runs.
      router: { instance: router, path: '/api', rewrite: { regex: '^/api/(.*)$', to: '/$1' } },
    },
    link: [table],
    environment: {
      PERF_TABLE: table.name,
      PERF_STATE_MACHINE: stateMachine.arn,
      // Turns on the /admin/<secret>/… routes; they don't exist without it.
      ...(process.env.PERF_ADMIN_SECRET && { PERF_ADMIN_SECRET: process.env.PERF_ADMIN_SECRET }),
    },
    permissions: [{ actions: ['states:StartExecution'], resources: [stateMachine.arn] }],
  })

  const site = new sst.aws.StaticSite('PerfSite', {
    path: 'web',
    build: { command: 'bun run build', output: 'dist' },
    router: { instance: router },
  })

  return { api: api.url, site: site.url, stateMachine: stateMachine.arn }
}
