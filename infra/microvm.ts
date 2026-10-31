/**
 * The Lambda MicroVM variants: src/microvm.ts as an HTTP server in a MicroVM image for each size,
 * in the stack's region like everything else. Lambda builds each image from a zip of the server
 * and a Dockerfile, starts the server and snapshots it; PerfMeasure runs a MicroVM from that
 * snapshot every round and terminates it again (src/perf/microvm.ts).
 */
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import path from 'node:path'
import { bunBin, buildMicrovmServer, MICROVM_ENTRY, unavailableReason, versionFile } from './build'
import type { Variant } from './functions'

/**
 * Lambda's base image for MicroVMs, at the version the snapshots are built on. Lambda deprecates a
 * version 60 days after the next one comes out and stops running it 30 days after that, so this
 * has to move on before then; `ListManagedMicrovmImageVersions` lists them.
 */
const BASE_IMAGE = { name: 'al2023-1', version: '2' }

/**
 * The container the Node.js server runs in: Lambda's own Node.js 24 image, the Node that
 * `nodejs24.x` runs, with its entry point (the Runtime API client) replaced by the server.
 */
const NODE_IMAGE = 'public.ecr.aws/lambda/nodejs:24'

/** The one a Bun executable runs in: Lambda's minimal Amazon Linux 2023, built to be snapshotted. */
const MINIMAL_IMAGE = 'public.ecr.aws/lambda/microvms:al2023-minimal'

/**
 * The baselines Lambda offers, an image each: a vCPU per 2 GB, and up to four times both while
 * busy. The memory is the image's, so every size needs its own.
 */
const MEMORY_SIZES = [512, 1024, 2048, 4096, 8192]

/** The port src/microvm.ts listens on, where Lambda sends requests and its build hooks. */
const PORT = 8080

/**
 * How many images may build at once. The account may build 5, and a deploy that changes the
 * server rebuilds every image, so each waits for the one made `BUILD_LANES` before it, leaving room
 * for another stage's.
 */
const BUILD_LANES = 4
const images: awsnative.lambda.MicrovmImage[] = []

type MicrovmVariant = Extract<Variant, { kind: 'microvm' }>

/**
 * `entrypoint` from `file`, copied into /app of `from`. The code's zip keeps no file modes, so an
 * `executable` gets its own.
 */
const dockerfile = (from: string, file: string, entrypoint: string[], executable = false) =>
  [
    `FROM ${from}`,
    'WORKDIR /app',
    `COPY ${executable ? '--chmod=755 ' : ''}${file} .`,
    `EXPOSE ${PORT}`,
    `ENTRYPOINT ${JSON.stringify(entrypoint)}`,
    '',
  ].join('\n')

/**
 * The Bun executable of a `bun` variant: the one scripts/build-docker.ts left in
 * `$BUN_BUNDLES/arm64/<id>`, or built here. A string says why there is none.
 */
const bunServer = (
  v: MicrovmVariant & { bun: 'aot-trim' }
): { bundle: string } | { reason: string } => {
  const prebuilt = process.env.BUN_BUNDLES
  if (prebuilt) {
    const bundle = path.resolve(prebuilt, 'arm64', v.id)
    if (existsSync(path.join(bundle, 'app'))) return { bundle }
    return { reason: `no ${path.join(bundle, 'app')}; bun run build builds it` }
  }
  const reason = unavailableReason(v.bun, 'arm64')
  if (reason) return { reason }
  const bundle = path.join($cli.paths.work, 'microvm-bun', v.id)
  return { bundle: buildMicrovmServer({ variant: v.bun, bundle, arch: 'arm64' }) }
}

/**
 * Fills `dir` with the server and a Dockerfile that runs it: src/microvm.ts bundled for Lambda's
 * Node.js 24 image, or a `bun` variant's executable. A string says why there is none.
 */
const prepare = (v: MicrovmVariant, dir: string) => {
  rmSync(dir, { recursive: true, force: true })
  mkdirSync(dir, { recursive: true })
  if (!v.bun) {
    const outfile = path.join(dir, 'index.mjs')
    execFileSync(
      bunBin(),
      ['build', MICROVM_ENTRY, '--target=node', '--format=esm', '--minify', `--outfile=${outfile}`],
      { stdio: 'inherit' }
    )
    writeFileSync(
      path.join(dir, 'Dockerfile'),
      dockerfile(NODE_IMAGE, 'index.mjs', ['node', 'index.mjs'])
    )
    return { containerImage: NODE_IMAGE, codeBytes: statSync(outfile).size, version: undefined }
  }
  const found = bunServer({ ...v, bun: v.bun })
  if ('reason' in found) return found.reason
  const { bundle } = found
  const app = path.join(dir, 'app')
  copyFileSync(path.join(bundle, 'app'), app)
  writeFileSync(path.join(dir, 'Dockerfile'), dockerfile(MINIMAL_IMAGE, 'app', ['/app/app'], true))
  return {
    containerImage: MINIMAL_IMAGE,
    codeBytes: statSync(app).size,
    // What PerfMeasure records as the version: a canary Bun reports the release it precedes.
    version: readFileSync(versionFile(bundle), 'utf8'),
  }
}

export type Microvm = NonNullable<ReturnType<typeof createMicrovm>>

/** `v`'s images, one per size, or undefined when its server can't be had on this host. */
export const createMicrovm = (v: MicrovmVariant) => {
  const { id } = v
  const prefix = `${$app.name}-${$app.stage}`
  const region = aws.getRegionOutput().region
  const dir = path.join($cli.paths.work, 'microvm', id)
  const server = prepare(v, dir)
  if (typeof server === 'string') {
    console.warn(`Skipping ${id}: ${server}`)
    return undefined
  }
  // The image builds a new version when its code's URI changes, so the zip is named by its content.
  const hash = createHash('sha256')
  for (const file of readdirSync(dir).sort()) hash.update(readFileSync(path.join(dir, file)))
  const digest = hash.digest('hex').slice(0, 16)

  // Lambda reads the code with the build role, so the bucket needs no policy of its own.
  const bucket = new aws.s3.Bucket(`${id}Code`, { forceDestroy: true })
  const code = new aws.s3.BucketObjectv2(`${id}CodeZip`, {
    bucket: bucket.id,
    key: `${id}-${digest}.zip`,
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

  const targets = (v.sizes ?? MEMORY_SIZES).map((memoryMb) => {
    // Named like a function at more than one memory size: `Node24MicroVmM2048`.
    const sizeId = `${id}M${memoryMb}`
    const ahead = images.at(-BUILD_LANES)
    const image = new awsnative.lambda.MicrovmImage(
      sizeId,
      {
        name: `${prefix}-${sizeId}`,
        description: `src/microvm.ts on ${server.containerImage}, benchmarked by PerfMeasure`,
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
      },
      ahead && { dependsOn: [ahead] }
    )
    images.push(image)
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
      containerImage: server.containerImage,
      codeBytes: server.codeBytes,
      version: server.version,
    }
  })

  return { targets, ingressConnector, egressConnector }
}
