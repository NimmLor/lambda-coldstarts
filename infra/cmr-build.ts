/**
 * Builds the customer-managed runtime variants: for each, a `runtime` directory that is the Docker
 * build context of its runtime image, and a `code` directory that is what the function deploys as
 * its .zip. Lambda runs the image's ENTRYPOINT with the function's handler as its last argument and
 * the code in /var/task: https://docs.aws.amazon.com/lambda/latest/dg/cmr-building-images.html
 * Plain Node APIs only, like build.ts, so `sst.config.ts` and `scripts/build-local.ts` can both
 * call it. infra/cmr.ts builds the images and deploys them.
 */
import { execFileSync } from 'node:child_process'
import { copyFileSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import {
  bunBin,
  bunVersion,
  ENTRY,
  type LambdaArch,
  linuxBunExecutable,
  versionFile,
} from './build'
import { LLRT_ENTRY, LLRT_HANDLER, LLRT_VERSION, llrtAsset, llrtFile } from './llrt'

/**
 * What a runtime image holds: Lambda's Node.js 24 image as it is, the `bun` executable or LLRT's
 * no-SDK Lambda build on Lambda's OS-only image, or Bun's own Alpine image, whose Bun is built
 * against musl.
 */
export type CmrRuntime = 'node24' | 'bun' | 'bun-alpine' | 'llrt'

export type CmrSpec = {
  runtime: CmrRuntime
  /** MB of incompressible bytes the image carries and nothing reads; see infra/cmr.ts. */
  padMb?: number
}

/** The OS-only base image: Amazon Linux 2023, as `provided.al2023` runs it. */
const PROVIDED_IMAGE = 'public.ecr.aws/lambda/provided:al2023'
/** What `nodejs24.x` runs, Runtime API client and all. */
const NODE24_IMAGE = 'public.ecr.aws/lambda/nodejs:24'
/** Bun's Alpine image, at the version the glibc variants ship. */
const bunAlpineImage = (version: string) => `docker.io/oven/bun:${version}-alpine`

/** The function's handler, which Lambda passes the image's ENTRYPOINT: a module export, or Bun's script. */
export const cmrHandler = (runtime: CmrRuntime) =>
  runtime === 'bun' || runtime === 'bun-alpine' ? 'index.js' : LLRT_HANDLER

/** Whether `runtime/bootstrap` runs on the build host, against the fake Runtime API of build-local. */
export const runsLocally = (runtime: CmrRuntime) => runtime === 'bun' || runtime === 'llrt'

/** The named build context infra/cmr.ts fills with the padding, which the Dockerfile copies from. */
export const PADDING_CONTEXT = 'padding'

const run = (file: string, args: string[]) => execFileSync(file, args, { stdio: 'inherit' })

/**
 * Lambda's base images label themselves fit for Lambda Managed Instances, which needs a runtime that
 * serves several events at once. Bun's runtime loop and LLRT serve one at a time.
 */
const ONE_AT_A_TIME = 'LABEL com.amazonaws.lambda.feature.managedinstances="NotSupported"'

/** Lambda appends the handler to the ENTRYPOINT, which has to be the exec form to get it. */
const ENTRYPOINT = 'ENTRYPOINT ["/var/runtime/bootstrap"]'

/**
 * Starts the bundle the way BunRuntime's bootstrap does, through the same shell, so the two differ
 * only in where Bun comes from. /var/task is read-only, so it skips the transpiler cache, and
 * --no-install keeps Bun off the network.
 */
const bunBootstrap = (bun: string) =>
  `#!/bin/sh\nBUN_RUNTIME_TRANSPILER_CACHE_PATH=0 exec ${bun} --no-install "$LAMBDA_TASK_ROOT/$1"\n`

const dockerfile = (lines: (string | undefined)[]) =>
  `${lines.filter((line) => line !== undefined).join('\n')}\n`

/**
 * Bundles `entry` into `outfile` with Bun, as the BYOL variants do: for Bun itself, or as an ES
 * module for Node.js and LLRT, leaving LLRT's own `llrt:*` modules as imports.
 */
const bundleEntry = (entry: string, outfile: string, target: 'bun' | 'node' | 'llrt') =>
  run(bunBin(), [
    'build',
    path.resolve(entry),
    `--target=${target === 'bun' ? 'bun' : 'node'}`,
    '--format=esm',
    '--minify',
    ...(target === 'llrt' ? ['--external', 'llrt:*'] : []),
    '--outfile',
    outfile,
  ])

/**
 * Builds `spec` for `arch` into `bundle` (emptied first): `runtime/`, with its Dockerfile, and
 * `code/`. Returns `bundle`. `cacheDir` keeps downloads between builds.
 */
export const buildCmrBundle = ({
  spec,
  bundle,
  arch,
  cacheDir,
}: {
  spec: CmrSpec
  bundle: string
  arch: LambdaArch
  cacheDir: string
}) => {
  rmSync(bundle, { recursive: true, force: true })
  const runtime = path.join(bundle, 'runtime')
  const code = path.join(bundle, 'code')
  mkdirSync(runtime, { recursive: true })
  mkdirSync(code, { recursive: true })
  const write = (file: string, text: string, mode = 0o644) =>
    writeFileSync(path.join(runtime, file), text, { mode })
  // The padding comes from a context of its own, so it's made on the deploying host, not shipped.
  const padding = spec.padMb
    ? `COPY --from=${PADDING_CONTEXT} padding /var/runtime/padding/${spec.padMb}mb`
    : undefined

  switch (spec.runtime) {
    case 'node24': {
      bundleEntry('src/node.ts', path.join(code, 'index.mjs'), 'node')
      // Lambda's image as it is: its entrypoint script, Runtime API client and Node.js.
      write('Dockerfile', dockerfile([`FROM ${NODE24_IMAGE}`, padding]))
      // No version file: the function reports the Node.js it runs on, as the Node variants do.
      return bundle
    }
    case 'bun': {
      bundleEntry(ENTRY, path.join(code, 'index.js'), 'bun')
      copyFileSync(linuxBunExecutable(arch, cacheDir), path.join(runtime, 'bun'))
      // From its own directory rather than /var/runtime, so build-local can run it where it is.
      write('bootstrap', bunBootstrap('"${0%/*}/bun"'), 0o755)
      write(
        'Dockerfile',
        dockerfile([
          `FROM ${PROVIDED_IMAGE}`,
          ONE_AT_A_TIME,
          'COPY --chmod=755 bun bootstrap /var/runtime/',
          padding,
          ENTRYPOINT,
        ])
      )
      writeFileSync(versionFile(bundle), `bun ${bunVersion(bunBin())}`)
      return bundle
    }
    case 'bun-alpine': {
      const version = bunVersion(bunBin())
      bundleEntry(ENTRY, path.join(code, 'index.js'), 'bun')
      write('bootstrap', bunBootstrap('/usr/local/bin/bun'), 0o755)
      // Docker adds both files when a container runs, not to the image, and Lambda needs them there
      // to mount its own over. Its /var/task is the WORKDIR.
      write('hosts', '127.0.0.1\tlocalhost\n::1\tlocalhost\n')
      write('resolv.conf', '')
      write(
        'Dockerfile',
        dockerfile([
          `FROM ${bunAlpineImage(version)}`,
          ONE_AT_A_TIME,
          'COPY hosts resolv.conf /etc/',
          'COPY --chmod=755 bootstrap /var/runtime/',
          padding,
          'WORKDIR /var/task',
          ENTRYPOINT,
        ])
      )
      writeFileSync(versionFile(bundle), `bun ${version}`)
      return bundle
    }
    case 'llrt': {
      bundleEntry(LLRT_ENTRY, path.join(code, 'index.mjs'), 'llrt')
      copyFileSync(llrtFile('lambda', arch, 'bootstrap', cacheDir), path.join(runtime, 'bootstrap'))
      write(
        'Dockerfile',
        dockerfile([
          `FROM ${PROVIDED_IMAGE}`,
          ONE_AT_A_TIME,
          'COPY --chmod=755 bootstrap /var/runtime/',
          padding,
          // LLRT reads its handler from _HANDLER, which Lambda only sets through the entrypoint
          // script of its base images. That script would start LLRT through a shell Llrt doesn't
          // have, so the image names the handler instead.
          `ENV _HANDLER=${LLRT_HANDLER}`,
          ENTRYPOINT,
        ])
      )
      writeFileSync(versionFile(bundle), `${llrtAsset('lambda', arch)}@${LLRT_VERSION}`)
      return bundle
    }
  }
}
