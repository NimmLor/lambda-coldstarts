/**
 * The Lambda Web Function variant: src/web.ts as an HTTP server on the `nodejs24.x` Web Function
 * runtime, in the stack's region like everything else. Its code is a zip in a versioned bucket,
 * which every revision points at; PerfMeasure forces each cold start by creating a revision of its
 * own (src/perf/web.ts).
 */
import { execFileSync } from 'node:child_process'
import { statSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { bunBin } from './build'

/** The endpoint PerfMeasure sends its requests to. */
const ENDPOINT = 'bench'

/** Bundles src/web.ts into `dir` as the `index.js` the runtime loads, and returns its size in bytes. */
const bundle = (dir: string) => {
  const outfile = path.join(dir, 'index.js')
  execFileSync(
    bunBin(),
    ['build', 'src/web.ts', '--target=node', '--format=esm', '--minify', `--outfile=${outfile}`],
    { stdio: 'inherit' }
  )
  writeFileSync(path.join(dir, 'package.json'), '{"type":"module"}\n')
  return statSync(outfile).size
}

export type WebFunction = ReturnType<typeof createWebFunction>

export const createWebFunction = (id: string) => {
  const name = `${$app.name}-${$app.stage}-${id}`
  const region = aws.getRegionOutput().region
  const account = aws.getCallerIdentityOutput().accountId
  const dir = path.join($cli.paths.work, 'web-function', id)
  const codeBytes = bundle(dir)

  // Lambda pins each revision to an object version, so the bucket has to keep them.
  const bucket = new aws.s3.Bucket(`${id}Code`, { forceDestroy: true })
  const versioning = new aws.s3.BucketVersioning(`${id}CodeVersioning`, {
    bucket: bucket.id,
    versioningConfiguration: { status: 'Enabled' },
  })
  // Lambda reads the code as itself, on behalf of this function's revisions only.
  const policy = new aws.s3.BucketPolicy(`${id}CodePolicy`, {
    bucket: bucket.id,
    policy: $jsonStringify({
      Version: '2012-10-17',
      Statement: [
        {
          Effect: 'Allow',
          Principal: { Service: 'lambda.amazonaws.com' },
          Action: ['s3:GetObject', 's3:GetObjectVersion'],
          Resource: $interpolate`${bucket.arn}/*`,
          Condition: {
            ArnLike: {
              'aws:SourceArn': $interpolate`arn:aws:lambda:${region}:${account}:web-function/${name}/revision/*`,
            },
          },
        },
      ],
    }),
  })
  const code = new aws.s3.BucketObjectv2(
    `${id}CodeZip`,
    {
      bucket: bucket.id,
      key: `${id}.zip`,
      source: new $util.asset.FileArchive(dir),
    },
    { dependsOn: [versioning] }
  )

  // Lambda would create both on the first request, keeping their events forever.
  const logGroups = [name, `${name}.local`].map(
    (group, i) =>
      new aws.cloudwatch.LogGroup(`${id}Logs${i ? 'Local' : ''}`, {
        name: `/aws/lambda/web/${group}`,
        retentionInDays: 30,
      })
  )

  const role = new aws.iam.Role(`${id}Role`, {
    assumeRolePolicy: aws.iam.assumeRolePolicyForPrincipal({ Service: 'lambda.amazonaws.com' }),
    inlinePolicies: [
      {
        name: 'logs',
        policy: $jsonStringify({
          Version: '2012-10-17',
          Statement: [
            {
              Effect: 'Allow',
              Action: ['logs:CreateLogStream', 'logs:PutLogEvents'],
              Resource: logGroups.map((group) => $interpolate`${group.arn}:*`),
            },
          ],
        }),
      },
    ],
  })

  const fn = new awsnative.lambda.WebFunction(id, { functionName: name })

  // What every revision is made of, PerfMeasure's included.
  const buildConfig = {
    codeConfig: { s3Object: { bucket: bucket.id, key: code.key, versionId: code.versionId } },
    runtimeConfig: { runtime: 'nodejs24.x' },
  }
  const serviceConfig = {
    executionRoleArn: role.arn,
    timeoutSeconds: 10,
    environmentVariables: { VARIANT: id },
    // DEBUG adds a platform.requestComplete event with each request's duration.
    telemetryConfig: { loggingConfig: { systemLogLevel: 'DEBUG' as const } },
  }

  // Cleanup deletes it once PerfMeasure's revisions have pushed it out of the latest 50.
  const revision = new awsnative.lambda.WebFunctionRevision(
    `${id}Revision`,
    { functionName: fn.functionName.apply((n) => n!), buildConfig, serviceConfig },
    { retainOnDelete: true, dependsOn: [policy] }
  )

  const endpoint = new awsnative.lambda.WebFunctionEndpoint(
    `${id}Endpoint`,
    {
      functionName: fn.functionName.apply((n) => n!),
      endpointName: ENDPOINT,
      endpointType: 'HomeRegion',
      // Only PerfMeasure, which signs its requests, can reach it.
      authType: 'IamAuth',
      revisionWeights: [{ revisionId: revision.revisionId, weight: 100 }],
      // Its lowest: the benchmark needs one at a time.
      scalingConfig: { maxEnvironments: 2 },
    },
    // PerfMeasure moves it to a new revision every round.
    { ignoreChanges: ['revisionWeights'] }
  )

  return {
    name,
    functionArn: fn.functionArn,
    endpointArn: $interpolate`${fn.functionArn}/endpoint/${ENDPOINT}`,
    roleArn: role.arn,
    bucketArn: bucket.arn,
    logGroupArn: logGroups[1]!.arn,
    /** What PerfMeasure needs to make a revision, reach the endpoint and read its logs. */
    target: {
      id,
      name,
      kind: 'web' as const,
      region,
      endpoint: ENDPOINT,
      domain: endpoint.domainName,
      logGroup: logGroups[1]!.name,
      codeBytes,
      buildConfig,
      serviceConfig,
    },
  }
}
