/**
 * Builds the deployment bundle of each Bun variant: a directory whose `bootstrap` Lambda runs on
 * `provided.al2023`. Plain Node APIs only, so `sst.config.ts` and `scripts/build-local.ts` can
 * both call it.
 */
import { execFileSync } from 'node:child_process'
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import path from 'node:path'
import { stripVTControlCharacters } from 'node:util'

export type BunVariant = 'bun' | 'compile' | 'aot' | 'aot-trim'
export type LambdaArch = 'x86_64' | 'arm64'

/** Relative to the repository root: SST bundles the config, so paths relative to this file don't survive. */
const ENTRY = 'src/bun.ts'
const MINCORE_SHIM_SOURCE = 'infra/mincore-shim.c'

/** The Bun used for the `bun` and `compile` variants. */
export const bunBin = () => process.env.BUN_BIN || 'bun'
/** The Bun used for the `--aot` variants: one built from oven-sh/bun#45631 until that ships. */
export const bunAotBin = () => process.env.BUN_AOT_BIN || bunBin()

const run = (file: string, args: string[]) =>
  execFileSync(file, args, { stdio: 'inherit' })
const read = (file: string, args: string[]) =>
  execFileSync(file, args, { encoding: 'utf8' }).trim()

export const bunVersion = (bin: string) => read(bin, ['--version'])

export const toLambdaArch = (arch: string): LambdaArch => {
  if (arch === 'x64') return 'x86_64'
  if (arch === 'arm64') return 'arm64'
  throw new Error(`No Lambda architecture for ${arch}`)
}

/** `LAMBDA_ARCH`, or the build host's architecture, which the `--aot` variants can't escape. */
export const lambdaArch = (): LambdaArch => {
  const fromEnv = process.env.LAMBDA_ARCH
  if (fromEnv === 'x86_64' || fromEnv === 'arm64') return fromEnv
  if (fromEnv) throw new Error(`LAMBDA_ARCH must be x86_64 or arm64, not ${fromEnv}`)
  return toLambdaArch(process.arch)
}

const aotSupport = new Map<string, boolean>()

/**
 * `bun build` accepts flags it doesn't know without a word, so `--aot` on a Bun that lacks it
 * quietly builds a plain executable. Its help lists `--aot` once the compiler is in.
 */
const supportsAot = (bin: string) => {
  let supported = aotSupport.get(bin)
  if (supported === undefined) {
    // The AOT branch colors its help even when piped, so drop the ANSI codes before matching.
    supported = /^\s+--aot\s/m.test(
      stripVTControlCharacters(read(bin, ['build', '--help']))
    )
    aotSupport.set(bin, supported)
  }
  return supported
}

/** Why the `--aot` variants can't be built on this host for `arch`, or `undefined` when they can. */
export const aotUnavailableReason = (arch: LambdaArch) => {
  if (process.platform !== 'linux') {
    return `--aot compiles for the build host only, and this host runs ${process.platform}`
  }
  if (toLambdaArch(process.arch) !== arch) {
    return `--aot can't cross-compile from ${toLambdaArch(process.arch)} to ${arch}`
  }
  const bin = bunAotBin()
  if (!supportsAot(bin)) {
    return `${bin} (bun ${bunVersion(bin)}) has no --aot; point BUN_AOT_BIN at a build of oven-sh/bun#45631`
  }
  return undefined
}

const writeBootstrap = (bundle: string, script: string) =>
  writeFileSync(path.join(bundle, 'bootstrap'), `#!/bin/sh\n${script}\n`, {
    mode: 0o755,
  })

/**
 * The Linux Bun executable the `bun` variant ships next to its bundle: the build host's own when it
 * is Linux on the same architecture, otherwise the same version from npm.
 */
const linuxBunExecutable = (arch: LambdaArch, cacheDir: string) => {
  const bin = bunBin()
  if (process.platform === 'linux' && toLambdaArch(process.arch) === arch) {
    return read(bin, ['-e', 'process.stdout.write(process.execPath)'])
  }
  const version = bunVersion(bin)
  const pkg = `@oven/bun-linux-${arch === 'arm64' ? 'aarch64' : 'x64'}`
  const dir = path.join(cacheDir, `${pkg.replace('/', '-')}-${version}`)
  const executable = path.join(dir, 'package', 'bin', 'bun')
  if (!existsSync(executable)) {
    rmSync(dir, { recursive: true, force: true })
    mkdirSync(dir, { recursive: true })
    try {
      run('npm', ['pack', `${pkg}@${version}`, '--pack-destination', dir])
    } catch (error) {
      throw new Error(
        `No ${pkg}@${version} on npm. Build on Linux ${arch}, or use a released Bun.`,
        { cause: error }
      )
    }
    const tarball = readdirSync(dir).find((name) => name.endsWith('.tgz'))
    if (!tarball) throw new Error(`npm pack left no tarball in ${dir}`)
    run('tar', ['-xzf', path.join(dir, tarball), '-C', dir])
  }
  return executable
}

/**
 * Lambda's seccomp filter fails the `mincore` probe the AOT loader runs before it maps compiled
 * code, so the AOT variants start through a `bootstrap` that preloads mincore-shim.c.
 */
const addMincoreShim = (bundle: string) => {
  try {
    run(process.env.CC || 'cc', [
      '-shared',
      '-fPIC',
      '-O2',
      '-o',
      path.join(bundle, 'mincore-shim.so'),
      path.resolve(MINCORE_SHIM_SOURCE),
    ])
  } catch (error) {
    throw new Error(
      'An --aot build needs a C compiler ($CC or cc) for the Lambda mincore shim',
      { cause: error }
    )
  }
  writeBootstrap(
    bundle,
    'LD_PRELOAD="${0%/*}/mincore-shim.so" exec "${0%/*}/app"'
  )
}

// Lambda's /var/task has neither, so a compiled executable shouldn't look for them on every cold start.
const NO_AUTOLOAD = ['--no-compile-autoload-dotenv', '--no-compile-autoload-bunfig']

/**
 * Builds `variant` into `bundle` (emptied first) and returns it. Every variant's `bootstrap` takes
 * its paths from `$0` rather than `$LAMBDA_TASK_ROOT`, so it runs outside Lambda as well.
 */
export const buildBunBundle = ({
  variant,
  bundle,
  arch,
  cacheDir,
}: {
  variant: BunVariant
  bundle: string
  arch: LambdaArch
  /** Where downloaded Bun executables are kept between builds. */
  cacheDir: string
}) => {
  rmSync(bundle, { recursive: true, force: true })
  mkdirSync(bundle, { recursive: true })
  const entry = path.resolve(ENTRY)
  const target = `--target=bun-linux-${arch === 'arm64' ? 'arm64' : 'x64'}`

  switch (variant) {
    case 'bun': {
      run(bunBin(), [
        'build',
        entry,
        '--target=bun',
        '--format=esm',
        '--minify',
        '--outfile',
        path.join(bundle, 'index.js'),
      ])
      copyFileSync(linuxBunExecutable(arch, cacheDir), path.join(bundle, 'bun'))
      // /var/task is read-only, so skip the transpiler cache; --no-install keeps Bun off the network.
      writeBootstrap(
        bundle,
        'BUN_RUNTIME_TRANSPILER_CACHE_PATH=0 exec "${0%/*}/bun" --no-install "${0%/*}/index.js"'
      )
      break
    }
    case 'compile': {
      run(bunBin(), [
        'build',
        entry,
        '--compile',
        '--format=esm',
        '--minify',
        '--bytecode',
        target,
        ...NO_AUTOLOAD,
        '--outfile',
        path.join(bundle, 'bootstrap'),
      ])
      break
    }
    case 'aot':
    case 'aot-trim': {
      const reason = aotUnavailableReason(arch)
      if (reason) throw new Error(`Can't build the ${variant} variant: ${reason}`)
      run(bunAotBin(), [
        'build',
        entry,
        '--compile',
        '--aot',
        ...(variant === 'aot-trim' ? ['--trim'] : []),
        ...NO_AUTOLOAD,
        '--outfile',
        path.join(bundle, 'app'),
      ])
      addMincoreShim(bundle)
      break
    }
  }
  return bundle
}
