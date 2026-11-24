/**
 * The customer-managed runtime variants: each one's runtime image, built from the context
 * infra/cmr-build.ts made and pushed to ECR, published as a Lambda runtime with one version and
 * an alias, and its functions, which deploy only their code as a .zip and run on that alias:
 * https://docs.aws.amazon.com/lambda/latest/dg/runtimes-customer-managed.html
 *
 * The aws provider has neither runtimes nor a function's `runtimeConfig` yet, so the runtimes and
 * the functions come from aws-native. PerfMeasure measures the functions like any other.
 */
import { createCipheriv, createHash } from 'node:crypto'
import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  statSync,
  utimesSync,
  writeSync,
} from 'node:fs'
import path from 'node:path'
import type { LambdaArch } from './build'
import { PADDING_CONTEXT } from './cmr-build'
import type { BuiltVariant } from './functions'

type CmrVariant = Extract<BuiltVariant, { kind: 'cmr' }>

/** What every function's own settings are, as infra/functions.ts gives its others. */
export type CmrFunctionSettings = {
  id: string
  memoryMb: number
  handler: string
  environment: Record<string, string>
  tags: Record<string, string>
}

/** The alias every function runs on: one per runtime, pointing at the runtime's one version. */
const ALIAS = 'bench'

/** Lambda function names are 64 characters at most. */
const MAX_FUNCTION_NAME = 64

/** In runtime names, which take lowercase letters, digits and hyphens. */
const ARCH_NAME: Record<LambdaArch, string> = { x86_64: 'x64', arm64: 'arm64' }

/** What every customer-managed runtime variant shares, made with the first of them. */
let shared: ReturnType<typeof createShared> | undefined
const runtimeAliases: awsnative.lambda.RuntimeAlias[] = []

/** The aliases the functions run on, which PerfMeasure may need to update them. */
export const runtimeAliasArns = () => runtimeAliases.map((alias) => alias.arn)

const createShared = () => {
  const prefix = `${$app.name}-${$app.stage}`
  const region = aws.getRegionOutput().region
  const account = aws.getCallerIdentityOutput().accountId

  // Lambda keeps a deleted runtime's name for 30 days, so a stage that's removed and deployed again
  // in that time needs another one. This changes only with the stage's state.
  const suffix = new random.RandomString('CmrRuntimeSuffix', {
    length: 6,
    special: false,
    upper: false,
  })

  // Every runtime version's image, tagged `<Variant>-<arch>`. A version refers to its image by
  // digest and needs it as long as it exists, scheduled for deletion included, so an image that a
  // newer one untags stays.
  const repository = new aws.ecr.Repository('CmrImages', {
    name: `${prefix}-runtimes`.toLowerCase(),
    forceDelete: true,
  })
  // Lambda reads the images as itself, for this account's runtimes only.
  const repositoryPolicy = new aws.ecr.RepositoryPolicy('CmrImagesPolicy', {
    repository: repository.name,
    policy: $jsonStringify({
      Version: '2012-10-17',
      Statement: [
        {
          Sid: 'LambdaReadAccess',
          Effect: 'Allow',
          Principal: { Service: 'lambda.amazonaws.com' },
          Action: ['ecr:BatchGetImage', 'ecr:GetDownloadUrlForLayer'],
          Condition: {
            StringEquals: { 'aws:SourceAccount': account },
            ArnLike: {
              'aws:SourceArn': $interpolate`arn:aws:lambda:${region}:${account}:runtime/*`,
            },
          },
        },
      ],
    }),
  })
  const token = aws.ecr.getAuthorizationTokenOutput({ registryId: repository.registryId })

  const bucket = new aws.s3.Bucket('CmrCode', { forceDestroy: true })

  // One log group for every function here, rather than one each that Lambda keeps forever.
  const logGroup = new aws.cloudwatch.LogGroup('CmrLogs', {
    name: `/aws/lambda/${prefix}-cmr`,
    retentionInDays: 30,
  })
  const role = new aws.iam.Role('CmrRole', {
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
              Resource: $interpolate`${logGroup.arn}:*`,
            },
          ],
        }),
      },
    ],
  })

  return { prefix, suffix, repository, repositoryPolicy, token, bucket, logGroup, role }
}

/** `<app>-<stage>-<id>`, with a hash in place of what doesn't fit. */
const functionName = (prefix: string, id: string) => {
  const name = `${prefix}-${id}`
  if (name.length <= MAX_FUNCTION_NAME) return name
  const hash = createHash('sha256').update(name).digest('hex').slice(0, 8)
  return `${name.slice(0, MAX_FUNCTION_NAME - hash.length - 1)}-${hash}`
}

/** The first 16 hex digits of a hash of every file in `dir`, which names what's built from it. */
const dirHash = (dir: string) => {
  const hash = createHash('sha256')
  for (const file of readdirSync(dir, { recursive: true, encoding: 'utf8' }).sort()) {
    const full = path.join(dir, file)
    if (statSync(full).isFile()) hash.update(file).update(readFileSync(full))
  }
  return hash.digest('hex').slice(0, 16)
}

/**
 * A directory with `padding`: `mb` MB that don't compress or repeat, the same on every host, made
 * once. AES-CTR of zeros under a fixed key is a keystream that never repeats a block, so neither
 * ECR's compression nor Lambda's deduplication of an image's chunks can shrink it. A fixed mtime
 * keeps its image layer the same too.
 */
const paddingContext = (mb: number) => {
  const dir = path.join($cli.paths.work, 'cmr-padding', `${mb}mb`)
  const file = path.join(dir, 'padding')
  const bytes = mb * 1024 * 1024
  if (existsSync(file) && statSync(file).size === bytes) return dir
  mkdirSync(dir, { recursive: true })
  const cipher = createCipheriv('aes-256-ctr', Buffer.alloc(32), Buffer.alloc(16))
  const zeros = Buffer.alloc(1024 * 1024)
  const fd = openSync(file, 'w')
  try {
    for (let i = 0; i < mb; i++) writeSync(fd, cipher.update(zeros))
  } finally {
    closeSync(fd)
  }
  utimesSync(file, 0, 0)
  return dir
}

/**
 * `v`'s runtime on `architecture`, built from `bundle`, and a function on it for each of
 * `functions`. Returns them by id, with what PerfMeasure needs: their names, and their URLs.
 */
export const createCmrFunctions = ({
  v,
  architecture,
  bundle,
  version,
  functions,
}: {
  v: CmrVariant
  architecture: LambdaArch
  bundle: string
  /** What the runtime runs, for the function's description; see infra/functions.ts. */
  version: string | undefined
  functions: CmrFunctionSettings[]
}) => {
  shared ??= createShared()
  const { prefix, suffix, repository, repositoryPolicy, token, bucket, logGroup, role } = shared
  const name = `${v.id}${architecture === 'arm64' ? 'Arm64' : 'X64'}`
  const runtimeDir = path.join(bundle, 'runtime')
  const codeDir = path.join(bundle, 'code')

  // Only what the Dockerfile copies, which is built for one architecture each: a runtime per
  // architecture, rather than one runtime version for an image of both.
  const image = new dockerbuild.Image(`${name}Image`, {
    context: {
      location: runtimeDir,
      ...(v.padMb && { named: { [PADDING_CONTEXT]: { location: paddingContext(v.padMb) } } }),
    },
    platforms: [architecture === 'arm64' ? 'linux/arm64' : 'linux/amd64'],
    push: true,
    tags: [$interpolate`${repository.repositoryUrl}:${v.id}-${architecture}`],
    registries: [
      {
        address: token.proxyEndpoint,
        username: token.userName,
        password: $util.secret(token.password),
      },
    ],
  })

  const runtime = new awsnative.lambda.Runtime(`${name}Runtime`, {
    name: $interpolate`${prefix}-${v.id}-${ARCH_NAME[architecture]}-${suffix.result}`.apply((n) =>
      n.toLowerCase().replace(/[^a-z0-9-]/g, '-')
    ),
    description: `The runtime of ${v.id} on ${architecture}, benchmarked by PerfMeasure`,
  })
  // A version can't change its image, so a new image makes a new version, which the alias moves
  // to before the old one is deleted. It's named by its digest and a suffix drawn anew with each
  // one: a name stays taken for 30 days after its version is deleted, and Lambda can keep a
  // version that a failed deploy created without telling it, so a digest seen before would clash.
  const versionSuffix = new random.RandomString(`${name}RuntimeVersionSuffix`, {
    length: 6,
    special: false,
    upper: false,
    keepers: { digest: image.digest },
  })
  const runtimeVersion = new awsnative.lambda.RuntimeVersion(
    `${name}RuntimeVersion`,
    {
      runtimeName: runtime.name,
      name: $interpolate`sha256-${image.digest.apply((d) => d.replace(/^sha256:/, '').slice(0, 16))}-${versionSuffix.result}`,
      // By digest alone: Lambda rejects the `<repo>:<tag>@<digest>` that `image.ref` is, as SST's
      // own container functions work around too.
      imageUri: $interpolate`${repository.repositoryUrl}@${image.digest}`,
      releaseNotes: version,
    },
    {
      dependsOn: [repositoryPolicy],
      // aws-native asks to delete before replacing whatever it replaces, and Lambda doesn't delete
      // the version the alias points to: Cloud Control waits for it until it gives up.
      deleteBeforeReplace: false,
    }
  )
  const alias = new awsnative.lambda.RuntimeAlias(`${name}RuntimeAlias`, {
    runtimeName: runtime.name,
    name: ALIAS,
    runtimeVersion: runtimeVersion.name,
  })
  runtimeAliases.push(alias)

  // Named by its content, so new code updates the functions.
  const code = new aws.s3.BucketObjectv2(`${name}Code`, {
    bucket: bucket.id,
    key: `${name}-${dirHash(codeDir)}.zip`,
    source: new $util.asset.FileArchive(codeDir),
  })

  return Object.fromEntries(
    functions.map((settings) => {
      const fn = new awsnative.lambda.Function(settings.id, {
        functionName: functionName(prefix, settings.id),
        role: role.arn,
        runtime: 'custom',
        runtimeConfig: { runtimeArn: runtime.arn, runtimeAlias: alias.name },
        handler: settings.handler,
        code: { s3Bucket: bucket.id, s3Key: code.key },
        architectures: [architecture],
        memorySize: settings.memoryMb,
        timeout: 10,
        // Like every other function's; see sst.config.ts.
        reservedConcurrentExecutions: 1,
        environment: { variables: settings.environment },
        tags: Object.entries(settings.tags).map(([key, value]) => ({ key, value })),
        loggingConfig: { logGroup: logGroup.name },
        // What PerfMeasure records as the version, as for the provided.al2023 variants.
        description: version,
      })
      const fnName = fn.functionName.apply((n) => n!)

      // A public Function URL, as SST gives every other function.
      const url = new aws.lambda.FunctionUrl(`${settings.id}Url`, {
        functionName: fnName,
        authorizationType: 'NONE',
      })
      new aws.lambda.Permission(`${settings.id}PublicFunctionUrlAccess`, {
        action: 'lambda:InvokeFunctionUrl',
        function: fnName,
        principal: '*',
        functionUrlAuthType: 'NONE',
      })
      new aws.lambda.Permission(`${settings.id}InvokeFunction`, {
        action: 'lambda:InvokeFunction',
        function: fnName,
        principal: '*',
        invokedViaFunctionUrl: true,
      })

      return [settings.id, { name: fnName, url: url.functionUrl }]
    })
  )
}
