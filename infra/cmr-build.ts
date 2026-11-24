/**
 * Builds the customer-managed runtime variants: for each, a `runtime` directory that is the Docker
 * build context of its runtime image, and a `code` directory that is what the function deploys as
 * its .zip. Lambda runs the image's ENTRYPOINT with the function's handler as its last argument and
 * the code in /var/task: https://docs.aws.amazon.com/lambda/latest/dg/cmr-building-images.html
 * Plain Node APIs only, like build.ts, so `sst.config.ts` and `scripts/build-local.ts` can both
 * call it. infra/cmr.ts builds the images and deploys them.
 */
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
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
 * What a runtime image holds: Lambda's Node.js 24 image as it is, or with the Node.js 27 alpha in
 * place of its Node.js, the `bun` executable or LLRT's no-SDK Lambda build on Lambda's OS-only
 * image, or Bun's own Alpine image, whose Bun is built against musl.
 */
export type CmrRuntime = 'node24' | 'node27' | 'bun' | 'bun-alpine' | 'llrt'

export type CmrSpec = {
  runtime: CmrRuntime
  /** MB of incompressible bytes the image carries and nothing reads; see infra/cmr.ts. */
  padMb?: number
}

/** The OS-only base image: Amazon Linux 2023, as `provided.al2023` runs it. */
const PROVIDED_IMAGE = 'public.ecr.aws/lambda/provided:al2023'
/** What `nodejs24.x` runs, Runtime API client and all. */
const NODE24_IMAGE = 'public.ecr.aws/lambda/nodejs:24'
/**
 * The Node.js 27 alpha the node27 image runs: nodejs.org's Linux build, whose tarballs'
 * sha256s are in the release's SHASUMS256.txt. Alphas may break things between any two, so it
 * moves only when it's changed here.
 */
const NODE27_VERSION = 'v27.0.0-alpha.0.1.1'
const NODE27_SHA256: Record<LambdaArch, string> = {
  x86_64: '61d470cadc25737792030cc0465e061cfa91fa5deea482c21134966334c6357d',
  arm64: 'fd467a44118d947a5816028b9cf50885584abd8eb9922f1b401bc58b7b267f42',
}
/** nodejs.org's names for the architectures. */
const NODE_ARCH: Record<LambdaArch, string> = { x86_64: 'x64', arm64: 'arm64' }
/**
 * libatomic, which nodejs.org's Node.js 27 builds link and Lambda's images lack, as Amazon Linux
 * 2023 packages it: from its blobstore, which names each package by its sha256.
 */
const LIBATOMIC: Record<LambdaArch, { sha256: string; rpm: string }> = {
  x86_64: {
    sha256: 'a6400c04b34ba93aa56a0bc31575953216c839920f966bef38f5a296edc4bc52',
    rpm: 'libatomic-14.2.1-7.amzn2023.0.2.x86_64.rpm',
  },
  arm64: {
    sha256: '66ae84c98709ff401d7d3366ecbbf16f6e3cabc84c54ed2ce4f61f4c0e0c75e0',
    rpm: 'libatomic-14.2.1-7.amzn2023.0.2.aarch64.rpm',
  },
}
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

/** Downloads `url` to `file`, unless it's there, and fails unless its sha256 is `sha256`. */
const download = (url: string, sha256: string, file: string) => {
  if (!existsSync(file)) {
    mkdirSync(path.dirname(file), { recursive: true })
    run('curl', ['-fsSL', '-o', `${file}.part`, url])
    // Read as latin1, which hashes the same bytes and spares the clash of Bun's and Node's Buffer types.
    const actual = createHash('sha256')
      .update(readFileSync(`${file}.part`, 'latin1'), 'latin1')
      .digest('hex')
    if (actual !== sha256) {
      rmSync(`${file}.part`)
      throw new Error(`${url} has sha256 ${actual}, not the pinned ${sha256}`)
    }
    renameSync(`${file}.part`, file)
  }
  return file
}

/** The Node.js 27 alpha's `node` for `arch`, from nodejs.org, kept in `cacheDir`. */
const node27Executable = (arch: LambdaArch, cacheDir: string) => {
  const name = `node-${NODE27_VERSION}-linux-${NODE_ARCH[arch]}`
  const dir = path.join(cacheDir, name)
  const file = path.join(dir, 'node')
  if (existsSync(file)) return file
  mkdirSync(dir, { recursive: true })
  const tarball = download(
    `https://nodejs.org/download/release/${NODE27_VERSION}/${name}.tar.xz`,
    NODE27_SHA256[arch],
    path.join(cacheDir, `${name}.tar.xz`)
  )
  run('tar', ['-xJf', tarball, '-C', dir, '--strip-components=2', `${name}/bin/node`])
  rmSync(tarball)
  return file
}

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
    case 'node27': {
      bundleEntry('src/node.ts', path.join(code, 'index.mjs'), 'node')
      copyFileSync(node27Executable(arch, cacheDir), path.join(runtime, 'node'))
      const libatomic = LIBATOMIC[arch]
      copyFileSync(
        download(
          `https://cdn.amazonlinux.com/al2023/blobstore/${libatomic.sha256}/${libatomic.rpm}`,
          libatomic.sha256,
          path.join(cacheDir, libatomic.rpm)
        ),
        path.join(runtime, 'libatomic.rpm')
      )
      write(
        'Dockerfile',
        dockerfile([
          // rpm unpacks the package on the build host, whatever its architecture: it runs none of
          // the package's code, and the image has no cpio to do it with.
          `FROM --platform=$BUILDPLATFORM ${NODE24_IMAGE} AS libatomic`,
          'COPY libatomic.rpm /tmp/',
          'RUN rpm --root=/out --initdb && ' +
            'rpm -i --root=/out --ignorearch --nodeps --noscripts --nosignature /tmp/libatomic.rpm && ' +
            'cp -L /out/usr/lib64/libatomic.so.1 /libatomic.so.1',
          // Lambda's image again, its Node.js 24 swapped for the alpha: its entrypoint script and
          // Runtime API client, whose native part is Node-API, so it loads on any Node.js.
          `FROM ${NODE24_IMAGE}`,
          'COPY --from=libatomic /libatomic.so.1 /usr/lib64/',
          'COPY --chmod=755 node /var/lang/bin/',
          padding,
        ])
      )
      // No version file: the function reports the Node.js it runs on, here v27.0.0-alpha.*.
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
          // No ENTRYPOINT: the image's own /lambda-entrypoint.sh starts LLRT. LLRT serves
          // invocations only with _HANDLER set, and with no arguments: given the handler as one,
          // it takes it for a CLI command and exits. A customer-managed runtime gets neither the
          // variable nor the image's ENV; that script sets it from its argument, then execs
          // /var/runtime/bootstrap without it. So LlrtCmr starts through a shell, which Llrt doesn't.
        ])
      )
      writeFileSync(versionFile(bundle), `${llrtAsset('lambda', arch)}@${LLRT_VERSION}`)
      return bundle
    }
  }
}
