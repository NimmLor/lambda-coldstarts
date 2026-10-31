/**
 * The Lambda MicroVM variant: src/microvm.ts as an HTTP server in a MicroVM image, in the stack's
 * region like everything else. Lambda builds the image from a zip of the bundle and a Dockerfile,
 * starts the server and snapshots it; PerfMeasure runs a MicroVM from that snapshot every round
 * and terminates it again (src/perf/microvm.ts).
 */
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFileSync, statSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { bunBin } from './build'

/**
 * Lambda's base image for MicroVMs, at the version the snapshots are built on. Lambda deprecates a
 * version 60 days after the next one comes out and stops running it 30 days after that, so this
 * has to move on before then; `ListManagedMicrovmImageVersions` lists them.
 */
const BASE_IMAGE = { name: 'al2023-1', version: '2' }

/**
 * The container the server runs in: Lambda's own Node.js 24 image, the Node that `nodejs24.x`
 * runs, with its entry point (the Runtime API client) replaced by the server.
 */
const CONTAINER_IMAGE = 'public.ecr.aws/lambda/nodejs:24'

/** The baseline every MicroVM of the image gets: 2 GB and 1 vCPU, bursting to 8 GB and 4 vCPUs. */
const MEMORY_MB = 2048

/** The port src/microvm.ts listens on, where Lambda sends requests and its build hooks. */
const PORT = 8080

/** Bundles src/microvm.ts into `dir` with its Dockerfile, and returns the bundle's size in bytes. */
const bundle = (dir: string) => {
  const outfile = path.join(dir, 'index.mjs')
  execFileSync(
    bunBin(),
    [
      'build',
      'src/microvm.ts',
      '--target=node',
      '--format=esm',
      '--minify',
      `--outfile=${outfile}`,
    ],
    { stdio: 'inherit' }
  )
  writeFileSync(
    path.join(dir, 'Dockerfile'),
    [
      `FROM ${CONTAINER_IMAGE}`,
      'WORKDIR /app',
      'COPY index.mjs .',
      `EXPOSE ${PORT}`,
      'ENTRYPOINT ["node", "index.mjs"]',
      '',
    ].join('\n')
  )
  return statSync(outfile).size
}

export type Microvm = ReturnType<typeof createMicrovm>

export const createMicrovm = (id: string) => {
  const name = `${$app.name}-${$app.stage}-${id}`
  const region = aws.getRegionOutput().region
  const dir = path.join($cli.paths.work, 'microvm', id)
  const codeBytes = bundle(dir)
  // The image builds a new version when its code's URI changes, so the zip is named by its content.
  const hash = createHash('sha256')
    .update(readFileSync(path.join(dir, 'index.mjs')))
    .update(readFileSync(path.join(dir, 'Dockerfile')))
    .digest('hex')
    .slice(0, 16)

  // Lambda reads the code with the build role, so the bucket needs no policy of its own.
  const bucket = new aws.s3.Bucket(`${id}Code`, { forceDestroy: true })
  const code = new aws.s3.BucketObjectv2(`${id}CodeZip`, {
    bucket: bucket.id,
    key: `${id}-${hash}.zip`,
    source: new $util.asset.FileArchive(dir),
  })

  // Where the builds log; Lambda would otherwise create it and keep the logs forever. The MicroVMs
  // have no execution role, so they log nothing.
  const logGroup = new aws.cloudwatch.LogGroup(`${id}Logs`, {
    name: `/aws/lambda-microvms/${name}`,
    retentionInDays: 30,
  })

  const buildRole = new aws.iam.Role(`${id}BuildRole`, {
    assumeRolePolicy: $jsonStringify({
      Version: '2012-10-17',
      Statement: [
        {
          Effect: 'Allow',
          Principal: { Service: 'lambda.amazonaws.com' },
          Action: ['sts:AssumeRole', 'sts:TagSession'],
        },
      ],
    }),
    inlinePolicies: [
      {
        name: 'build',
        policy: $jsonStringify({
          Version: '2012-10-17',
          Statement: [
            { Effect: 'Allow', Action: 's3:GetObject', Resource: $interpolate`${bucket.arn}/*` },
            {
              Effect: 'Allow',
              Action: ['logs:CreateLogGroup', 'logs:CreateLogStream', 'logs:PutLogEvents'],
              Resource: [logGroup.arn, $interpolate`${logGroup.arn}:*`],
            },
          ],
        }),
      },
    ],
  })

  const connector = (connectorName: string) =>
    $interpolate`arn:aws:lambda:${region}:aws:network-connector:aws-network-connector:${connectorName}`

  const image = new awsnative.lambda.MicrovmImage(id, {
    name,
    description: `src/microvm.ts on ${CONTAINER_IMAGE}, benchmarked by PerfMeasure`,
    baseImageArn: $interpolate`arn:aws:lambda:${region}:aws:microvm-image:${BASE_IMAGE.name}`,
    baseImageVersion: BASE_IMAGE.version,
    buildRoleArn: buildRole.arn,
    codeArtifact: { uri: $interpolate`s3://${bucket.id}/${code.key}` },
    logging: { cloudWatch: { logGroup: logGroup.name } },
    // For the build, which pulls the container image from ECR Public.
    egressNetworkConnectors: [connector('INTERNET_EGRESS')],
    cpuConfigurations: [{ architecture: 'ARM_64' }],
    resources: [{ minimumMemoryInMiB: MEMORY_MB }],
    additionalOsCapabilities: [],
    hooks: {
      port: PORT,
      microvmImageHooks: {
        ready: 'ENABLED',
        readyTimeoutInSeconds: 60,
        validate: 'ENABLED',
        validateTimeoutInSeconds: 60,
      },
    },
    environmentVariables: [{ key: 'VARIANT', value: id }],
  })

  return {
    imageArn: image.imageArn,
    /** What PerfMeasure needs to run a MicroVM of the image and reach it. */
    target: {
      id,
      kind: 'microvm' as const,
      region,
      imageArn: image.imageArn,
      // Lambda's own: HTTPS in, and the internet out, which a MicroVM gets whatever it's given.
      ingressConnector: connector('ALL_INGRESS'),
      egressConnector: connector('INTERNET_EGRESS'),
      memoryMb: MEMORY_MB,
      containerImage: CONTAINER_IMAGE,
      codeBytes,
    },
  }
}
