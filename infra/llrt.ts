/**
 * Builds the deployment bundle of each LLRT variant: an LLRT executable as `bootstrap`, next to the
 * handler bundled by Bun, as JavaScript or as LLRT bytecode. Plain Node APIs only, like build.ts.
 */
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import path from 'node:path'
import { bunBin, type LambdaArch, toLambdaArch, versionFile } from './build'

export type LlrtVariant = 'llrt' | 'llrt-std-sdk' | 'llrt-full-sdk' | 'llrt-bytecode'

/** Relative to the repository root, like build.ts's ENTRY. */
export const LLRT_ENTRY = 'src/llrt.ts'
/** The bundle's handler module: `_HANDLER=index.handler` finds `index.mjs` or `index.lrt`. */
export const LLRT_HANDLER = 'index.handler'

/**
 * Which AWS SDK an LLRT release build embeds: none, the common clients (the release's default,
 * whose assets have no suffix) or every client. The handler imports none of them, so the SDK
 * builds measure what a bigger executable costs a function that doesn't use it. Their TLS
 * warm-up (`LLRT_SDK_CONNECTION_WARMUP`) only connects for clients that are imported, so it
 * stays out of the numbers.
 */
type LlrtSdk = 'no-sdk' | 'std-sdk' | 'full-sdk'
const SDK_OF: Record<Exclude<LlrtVariant, 'llrt-bytecode'>, LlrtSdk> = {
  llrt: 'no-sdk',
  'llrt-std-sdk': 'std-sdk',
  'llrt-full-sdk': 'full-sdk',
}

/**
 * `lambda` is the Lambda build; `linux` is the CLI, which also has `llrt compile` and serves
 * invocations as well.
 */
export const LLRT_VERSION = 'v0.9.0-beta'
const LLRT_SHA256: Record<string, string> = {
  'llrt-lambda-x64-no-sdk.zip': 'd29be1a75a0dc20480fe4381b759f7d0fec2998c4fc043ee3545ee75d0ae3d05',
  'llrt-lambda-arm64-no-sdk.zip':
    '2546ed0360c1ebfdafb19ba2c86277759c7c74ec6e5c08e50e9bd69319d0ac41',
  'llrt-lambda-x64.zip': 'bdc7f41e9469e73f6c21636707f5a300bbd640fdb3b6228412bdc4026e29617f',
  'llrt-lambda-arm64.zip': '2abf1f9898fa7ca114b92322b6600a4012f399a185e05ef860f784e4f2bf3979',
  'llrt-lambda-x64-full-sdk.zip':
    '7ff615509503d9aa5e9337c12a5cfb9250894cbdcaa14345477df86921d86984',
  'llrt-lambda-arm64-full-sdk.zip':
    'f205341ca5e93789249ad77ffb6dee492c89b8bdffcba8c1b458bd103d4fbd41',
  'llrt-linux-x64-no-sdk.zip': '08f247140363119f5dd54a9ed3d51b35d83ffe6fc4c487ed90f6f7645c5dd840',
  'llrt-linux-arm64-no-sdk.zip': 'ab582e0d60e570781c72f4615ba12271b14344278646edbaa2ed7c0214933a04',
}

const run = (file: string, args: string[]) => execFileSync(file, args, { stdio: 'inherit' })

/**
 * The release asset of `build` for `arch` with `sdk`, without its `.zip`: `llrt-lambda-arm64-no-sdk`,
 * or `llrt-lambda-arm64` for the standard SDK.
 */
const llrtAsset = (build: 'lambda' | 'linux', arch: LambdaArch, sdk: LlrtSdk = 'no-sdk') =>
  `llrt-${build}-${arch === 'arm64' ? 'arm64' : 'x64'}${sdk === 'std-sdk' ? '' : `-${sdk}`}`

/**
 * The file `name` from the release's `<build>-<arch>[-<sdk>].zip`, downloaded once into `cacheDir`
 * and checked against its pinned hash.
 */
const llrtFile = (
  build: 'lambda' | 'linux',
  arch: LambdaArch,
  name: string,
  cacheDir: string,
  sdk?: LlrtSdk
) => {
  const zip = `${llrtAsset(build, arch, sdk)}.zip`
  const dir = path.join(cacheDir, `llrt-${LLRT_VERSION}`, zip.replace(/\.zip$/, ''))
  const file = path.join(dir, name)
  if (existsSync(file)) return file

  rmSync(dir, { recursive: true, force: true })
  mkdirSync(dir, { recursive: true })
  const zipPath = path.join(dir, zip)
  run('curl', [
    '-fsSL',
    '-o',
    zipPath,
    `https://github.com/awslabs/llrt/releases/download/${LLRT_VERSION}/${zip}`,
  ])
  // Read as latin1, which hashes the same bytes and spares the clash of Bun's and Node's Buffer types.
  const sha256 = createHash('sha256')
    .update(readFileSync(zipPath, 'latin1'), 'latin1')
    .digest('hex')
  if (sha256 !== LLRT_SHA256[zip]) {
    throw new Error(`${zip} has sha256 ${sha256}, not the pinned ${LLRT_SHA256[zip]}`)
  }
  run('unzip', ['-q', '-o', zipPath, '-d', dir])
  rmSync(zipPath)
  // Both are executables, whatever modes the zip kept.
  chmodSync(file, 0o755)
  return file
}

/** Why `variant` can't be built on this host for `arch`, or `undefined` when it can. */
export const llrtUnavailableReason = (variant: LlrtVariant, arch: LambdaArch) => {
  if (variant !== 'llrt-bytecode') return undefined
  // The CLI that compiles the bytecode is the one for the Lambda architecture, so it has to run here.
  if (process.platform !== 'linux') {
    return `llrt compile runs on Linux, and this host runs ${process.platform}`
  }
  if (toLambdaArch(process.arch) !== arch) {
    return `llrt compile for ${arch} needs a ${arch} host, not ${toLambdaArch(process.arch)}`
  }
  return undefined
}

/** Builds `variant` into `bundle` (emptied first) and returns it. */
export const buildLlrtBundle = ({
  variant,
  bundle,
  arch,
  cacheDir,
}: {
  variant: LlrtVariant
  bundle: string
  arch: LambdaArch
  /** Where the downloaded LLRT releases are kept between builds. */
  cacheDir: string
}) => {
  const reason = llrtUnavailableReason(variant, arch)
  if (reason) throw new Error(`Can't build the ${variant} variant: ${reason}`)
  rmSync(bundle, { recursive: true, force: true })
  mkdirSync(bundle, { recursive: true })

  const script = path.join(bundle, 'index.mjs')
  // `node:*` stays as imports, which LLRT has, and so does its own `llrt:qjs`.
  run(bunBin(), [
    'build',
    path.resolve(LLRT_ENTRY),
    '--target=node',
    '--format=esm',
    '--minify',
    '--external',
    'llrt:*',
    '--outfile',
    script,
  ])
  if (variant !== 'llrt-bytecode') {
    const sdk = SDK_OF[variant]
    copyFileSync(
      llrtFile('lambda', arch, 'bootstrap', cacheDir, sdk),
      path.join(bundle, 'bootstrap')
    )
    writeFileSync(versionFile(bundle), `${llrtAsset('lambda', arch, sdk)}@${LLRT_VERSION}`)
    return bundle
  }

  // Bytecode is compressed with a zstd dictionary built into the executable, and the release's
  // Lambda build has another than its CLI, which fails it with "Dictionary mismatch". The Lambda
  // build can't compile, so the CLI that compiled the bytecode is also what runs it: 14 MB rather
  // than 5.5 MB.
  const cli = llrtFile('linux', arch, 'llrt', cacheDir)
  run(cli, ['compile', script, path.join(bundle, 'index.lrt')])
  rmSync(script)
  copyFileSync(cli, path.join(bundle, 'bootstrap'))
  writeFileSync(versionFile(bundle), `${llrtAsset('linux', arch)}@${LLRT_VERSION}`)
  return bundle
}
