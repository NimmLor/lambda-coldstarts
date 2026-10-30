/**
 * A scheduled cold-start benchmark in the style of maxday/lambda-perf. The PerfRun state machine
 * goes through every function, `CONCURRENCY` at a time, each in an Express child workflow that
 * forces `PERF_ROUNDS` cold starts one after another, each followed by `PERF_WARM` warm
 * invocations (src/perf/measure.ts stores their REPORTs in PerfResults), then records the run and
 * stores its summary (src/perf/summarize.ts). PerfResults keeps a run for `RETENTION_DAYS`; on the
 * 1st, PerfExport (src/perf/export.ts) copies the month before to the PerfArchive bucket. PerfApi
 * serves the summaries to the React site in web/ and, with PERF_ADMIN_SECRET set, starts runs,
 * pauses and resumes the schedule, and purges the table.
 */
import { RETENTION_DAYS, RUNS_PK } from '../src/perf/keys'
import { BENCH_TAG } from './functions'

const ROUNDS = Number(process.env.PERF_ROUNDS ?? 10)
/** Invocations after each round's cold start, which find its environment warm. */
const WARM = Number(process.env.PERF_WARM ?? 5)

/** How often EventBridge Scheduler starts PerfRun. Other stages than production run when asked. */
const SCHEDULE = 'rate(4 hours)'
/** When PerfExport exports the month before: on the 1st, well after that month's last run. */
const EXPORT_SCHEDULE = 'cron(17 5 1 * ? *)'

/**
 * Functions measured at once: what an inline Map ran at most, so runs stay comparable with the
 * ones before. More wouldn't finish a run sooner: every round updates its function's
 * configuration, which counts against Lambda's 15 requests/s control-plane quota, so each child
 * would only take longer, closer to the 5 minutes an Express workflow gets.
 */
const CONCURRENCY = 40

/** The site's domain: coldstarts.github.nimmervoll.work in production, `<stage>.` in front of it elsewhere. */
const siteDomain = () => {
  const zone = 'github.nimmervoll.work'
  const name = `coldstarts.${zone}`
  return {
    name: $app.stage === 'production' ? name : `${$app.stage}.${name}`,
    dns: sst.aws.dns({ zone: aws.route53.getZoneOutput({ name: zone }).zoneId }),
  }
}

/**
 * Keeps a stage other than production out of search engines: its robots.txt disallows everything,
 * in place of web/robots.txt, and every other response says noindex. The distribution's own
 * cloudfront.net host needs nothing, since the Router answers it with a 403 once it has a domain.
 */
const NO_INDEX = {
  viewerRequest: {
    injection: `if (event.request.uri === '/robots.txt') return { statusCode: 200, headers: { 'content-type': { value: 'text/plain' } }, body: { encoding: 'text', data: 'User-agent: *\\nDisallow: /\\n' } };`,
  },
  viewerResponse: {
    injection: `event.response.headers['x-robots-tag'] = { value: 'noindex, nofollow' };`,
  },
}

export const createPerf = (functions: Record<string, sst.aws.Function>) => {
  const production = $app.stage === 'production'

  const table = new sst.aws.Dynamo('PerfResults', {
    fields: { pk: 'string', sk: 'string' },
    primaryIndex: { hashKey: 'pk', rangeKey: 'sk' },
    // See expiresAt in src/perf/keys.ts.
    ttl: 'expiresAt',
  })

  const archive = new sst.aws.Bucket('PerfArchive')

  const measure = new sst.aws.Function('PerfMeasure', {
    handler: 'src/perf/measure.handler',
    runtime: 'nodejs24.x',
    // The stack's own functions run on arm64, which costs a fifth less. What PerfMeasure records
    // doesn't depend on it: every number comes from the measured function's REPORT.
    architecture: 'arm64',
    timeout: '3 minutes',
    memory: '128 MB',
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
          {
            test: 'StringEquals',
            variable: `aws:ResourceTag/${BENCH_TAG.key}`,
            values: [BENCH_TAG.value],
          },
        ],
      },
    ],
  })

  const summarizer = new sst.aws.Function('PerfSummarize', {
    handler: 'src/perf/summarize.handler',
    runtime: 'nodejs24.x',
    architecture: 'arm64',
    timeout: '1 minute',
    // A run's samples are about 1,100 small items.
    memory: '128 MB',
    link: [table],
    environment: { PERF_TABLE: table.name },
  })

  const exporter = new sst.aws.Function('PerfExport', {
    handler: 'src/perf/export.handler',
    runtime: 'nodejs24.x',
    architecture: 'arm64',
    timeout: '15 minutes',
    // It streams a month through gzip into a multipart upload, a run at a time.
    memory: '128 MB',
    link: [table, archive],
    environment: { PERF_TABLE: table.name, PERF_ARCHIVE: archive.name },
  })

  // The parent execution's start. Inside a child workflow, $states.context.Execution is the
  // child's, so the children get the run's id with their input.
  const runId = '{% $states.context.Execution.StartTime %}'

  const measureRound = sst.aws.StepFunctions.lambdaInvoke({
    name: 'Measure',
    function: measure,
    payload: {
      runId: '{% $states.input.runId %}',
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
      runId: '{% $states.input.runId %}',
      target: '{% $states.input.target %}',
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

  // Each function's rounds run as an Express child workflow, billed by duration instead of by state
  // transition. A child that runs out of its 5 minutes loses its remaining rounds, like a Skipped
  // one, through ToleratedFailurePercentage on PerfRun below.
  const run = sst.aws.StepFunctions.map({
    name: 'Functions',
    mode: 'express',
    items: Object.entries(functions).map(([id, fn]) => ({ id, name: fn.name })),
    itemSelector: { runId, target: '{% $states.context.Map.Item.Value %}' },
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
        // expiresAt(runId) in src/perf/keys.ts.
        expiresAt: {
          N: `{% $string($floor($toMillis($states.context.Execution.StartTime) / 1000) + ${RETENTION_DAYS * 86_400}) %}`,
        },
      },
    },
    permissions: [{ actions: ['dynamodb:PutItem'], resources: [table.arn] }],
  })

  const summarizeRun = sst.aws.StepFunctions.lambdaInvoke({
    name: 'Summarize',
    function: summarizer,
    payload: { runId },
  }).retry({ interval: '10 seconds', maxAttempts: 3, backoffRate: 2 })

  const stateMachine = new sst.aws.StepFunctions('PerfRun', {
    definition: run.next(recordRun).next(summarizeRun),
    transform: {
      // SST's Map has no ToleratedFailurePercentage. Without it, one failed child fails the Map
      // Run, and RecordRun and Summarize never run for the functions that finished.
      stateMachine: (args) => {
        args.definition = $output(args.definition).apply((definition) => {
          const parsed = JSON.parse(definition)
          parsed.States[run.name].ToleratedFailurePercentage = 100
          return JSON.stringify(parsed)
        })
      },
    },
  })

  // The Map Run stops its children through PerfRun's role, which SST lets start and describe
  // executions but not stop them.
  new aws.iam.RolePolicy('PerfRunStopChildren', {
    role: stateMachine.nodes.stateMachine.roleArn.apply((arn) => arn.split('/').at(-1)!),
    policy: $jsonStringify({
      Version: '2012-10-17',
      Statement: [
        {
          Effect: 'Allow',
          Action: 'states:StopExecution',
          Resource: ['execution', 'express'].map((kind) =>
            stateMachine.arn.apply((arn) => `${arn.replace(':stateMachine:', `:${kind}:`)}/*`)
          ),
        },
      ],
    }),
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
      {
        name: 'export-perf-month',
        policy: $jsonStringify({
          Version: '2012-10-17',
          Statement: [{ Effect: 'Allow', Action: 'lambda:InvokeFunction', Resource: exporter.arn }],
        }),
      },
    ],
  })
  const schedule = new aws.scheduler.Schedule(
    'PerfSchedule',
    {
      scheduleExpression: SCHEDULE,
      flexibleTimeWindow: { mode: 'OFF' },
      // Other stages run with `bun run perf` or the admin page's button; a deploy pauses them again.
      ...(!production && { state: 'DISABLED' }),
      target: { arn: stateMachine.arn, roleArn: role.arn },
    },
    // In production, PerfApi's pause and resume set it. Pulumi doesn't read it back, so a deploy
    // that updates the schedule for another reason still sends the state it last knew, ENABLED.
    { ignoreChanges: production ? ['state'] : [] }
  )
  new aws.scheduler.Schedule('PerfExportSchedule', {
    scheduleExpression: EXPORT_SCHEDULE,
    flexibleTimeWindow: { mode: 'OFF' },
    state: production ? 'ENABLED' : 'DISABLED',
    target: { arn: exporter.arn, roleArn: role.arn, input: '{}' },
  })

  // One CloudFront distribution for the site and, under /api, PerfApi, so the page fetches its
  // own origin. Deploys don't wait for CloudFront to roll out the distribution or finish the
  // site's invalidation; both settle a few minutes after `sst deploy` returns.
  const router = new sst.aws.Router('PerfRouter', {
    domain: siteDomain(),
    ...($app.stage !== 'production' && { edge: NO_INDEX }),
    // PerfApi's Function URL takes requests from the distribution only, so none skip its cache.
    protection: 'oac',
    transform: {
      cdn: (args) => {
        args.wait = false
      },
      // Neither the site nor PerfApi reads a query string, so one can't make a request miss the cache.
      cachePolicy: (args) => {
        args.parametersInCacheKeyAndForwardedToOrigin = $output(
          args.parametersInCacheKeyAndForwardedToOrigin
        ).apply((parameters) => ({
          ...parameters,
          queryStringsConfig: { queryStringBehavior: 'none' },
        }))
      },
    },
  })

  const api = new sst.aws.Function('PerfApi', {
    handler: 'src/perf/api.handler',
    runtime: 'nodejs24.x',
    architecture: 'arm64',
    // /runs/history is a few MB of JSON. 128 MB would hold it, but with a sliver of a vCPU, every
    // response CloudFront hasn't cached would take noticeably longer.
    memory: '256 MB',
    url: {
      // The handler's routes start at /runs.
      router: { instance: router, path: '/api', rewrite: { regex: '^/api/(.*)$', to: '/$1' } },
    },
    link: [table],
    environment: {
      PERF_TABLE: table.name,
      PERF_STATE_MACHINE: stateMachine.arn,
      PERF_SCHEDULE: schedule.name,
      // Turns on the /admin/<secret>/… routes; they don't exist without it.
      ...(process.env.PERF_ADMIN_SECRET && { PERF_ADMIN_SECRET: process.env.PERF_ADMIN_SECRET }),
    },
    permissions: [
      { actions: ['states:StartExecution'], resources: [stateMachine.arn] },
      { actions: ['scheduler:GetSchedule', 'scheduler:UpdateSchedule'], resources: [schedule.arn] },
      // UpdateSchedule passes the target's role again.
      { actions: ['iam:PassRole'], resources: [role.arn] },
    ],
  })

  // web/src/analytics.ts sends its events here, so the page talks to its own origin only.
  router.route('/ingest', 'https://eu.i.posthog.com', {
    rewrite: { regex: '^/ingest/(.*)$', to: '/$1' },
  })

  const site = new sst.aws.StaticSite('PerfSite', {
    path: 'web',
    build: { command: 'bun run build', output: 'dist' },
    // Analytics on production only: any other stage builds with the token empty, which
    // web/src/analytics.ts takes as off, even when the shell or .env sets it.
    environment: {
      POSTHOG_PROJECT_TOKEN:
        $app.stage === 'production' ? (process.env.POSTHOG_PROJECT_TOKEN ?? '') : '',
    },
    router: { instance: router },
    invalidation: { wait: false },
  })

  return { api: api.url, site: site.url, stateMachine: stateMachine.arn, archive: archive.name }
}
