/**
 * The Lambda MicroVM variant: src/microvm.ts as an HTTP server in a MicroVM image for each size
 * Lambda offers, in the stack's region like everything else. Lambda builds each image from a zip
 * of the bundle and a Dockerfile, starts the server and snapshots it; PerfMeasure runs a MicroVM
 * from that snapshot every round and terminates it again (src/perf/microvm.ts).
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

/**
 * The baselines Lambda offers, an image each: a vCPU per 2 GB, and up to four times both while
 * busy. The memory is the image's, so every size needs its own.
 */
const MEMORY_SIZES = [512, 1024, 2048, 4096, 8192]

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
  const prefix = `${$app.name}-${$app.stage}`
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

  // Where every size's builds log; Lambda would otherwise create a group for each and keep the logs
  // forever. The MicroVMs have no execution role, so they log nothing.
  const logGroup = new aws.cloudwatch.LogGroup(`${id}Logs`, {
    name: `/aws/lambda-microvms/${prefix}-${id}`,
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

  const ingressConnector = connector('ALL_INGRESS')
  const egressConnector = connector('INTERNET_EGRESS')

  const targets = MEMORY_SIZES.map((memoryMb) => {
    // Named like a function at more than one memory size: `Node24MicroVmM2048`.
    const sizeId = `${id}M${memoryMb}`
    const image = new awsnative.lambda.MicrovmImage(sizeId, {
      name: `${prefix}-${sizeId}`,
      description: `src/microvm.ts on ${CONTAINER_IMAGE}, benchmarked by PerfMeasure`,
      baseImageArn: $interpolate`arn:aws:lambda:${region}:aws:microvm-image:${BASE_IMAGE.name}`,
      baseImageVersion: BASE_IMAGE.version,
      buildRoleArn: buildRole.arn,
      codeArtifact: { uri: $interpolate`s3://${bucket.id}/${code.key}` },
      logging: { cloudWatch: { logGroup: logGroup.name } },
      // For the build, which pulls the container image from ECR Public.
      egressNetworkConnectors: [egressConnector],
      cpuConfigurations: [{ architecture: 'ARM_64' }],
      resources: [{ minimumMemoryInMiB: memoryMb }],
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
      environmentVariables: [{ key: 'VARIANT', value: sizeId }],
    })
    // What PerfMeasure needs to run a MicroVM of the image and reach it.
    return {
      id: sizeId,
      kind: 'microvm' as const,
      region,
      imageArn: image.imageArn,
      // Lambda's own: HTTPS in, and the internet out, which a MicroVM gets whatever it's given.
      ingressConnector,
      egressConnector,
      memoryMb,
      containerImage: CONTAINER_IMAGE,
      codeBytes,
    }
  })

  return { targets, ingressConnector, egressConnector }
}
