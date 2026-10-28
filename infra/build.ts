/**
 * Builds the deployment bundle of each Bun variant: a directory whose `bootstrap` Lambda runs on
 * `provided.al2023`. Plain Node APIs only, so `sst.config.ts` and `scripts/build-local.ts` can
 * both call it.
 */
import { execFileSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { stripVTControlCharacters } from 'node:util'

export type BunVariant = 'bun' | 'compile' | 'compile-canary' | 'compile-trim' | 'aot' | 'aot-trim'
export type LambdaArch = 'x86_64' | 'arm64'

/** Relative to the repository root: SST bundles the config, so paths relative to this file don't survive. */
export const ENTRY = 'src/bun.ts'
const AOT_SHIM_SOURCE = 'infra/aot-shim.c'

/** The Bun used for the `bun` and `compile` variants. */
export const bunBin = () => process.env.BUN_BIN || 'bun'
/** The Bun used for the `canary`, `--trim` and `--aot` variants: a build of oven-sh/bun#45631 until that ships. */
export const bunAotBin = () => process.env.BUN_AOT_BIN || bunBin()

const run = (file: string, args: string[]) => execFileSync(file, args, { stdio: 'inherit' })
const read = (file: string, args: string[]) => execFileSync(file, args, { encoding: 'utf8' }).trim()

export const bunVersion = (bin: string) => read(bin, ['--version'])

export const toLambdaArch = (arch: string): LambdaArch => {
  if (arch === 'x64') return 'x86_64'
  if (arch === 'arm64') return 'arm64'
  throw new Error(`No Lambda architecture for ${arch}`)
}

/** `x86_64`, `arm64` or `x86_64,arm64`. */
export const parseLambdaArchs = (value: string): LambdaArch[] => {
  const archs = value.split(',').map((arch) => arch.trim())
  for (const arch of archs) {
    if (arch !== 'x86_64' && arch !== 'arm64') {
      throw new Error(`LAMBDA_ARCH must list x86_64 or arm64, not ${arch}`)
    }
  }
  return [...new Set(archs as LambdaArch[])]
}

/** `LAMBDA_ARCH`, or the build host's architecture, which the `--aot` variants can't escape. */
export const lambdaArchs = (): LambdaArch[] => {
  const fromEnv = process.env.LAMBDA_ARCH
  return fromEnv ? parseLambdaArchs(fromEnv) : [toLambdaArch(process.arch)]
}

/** The one architecture a build on this host is for. */
export const lambdaArch = (): LambdaArch => {
  const archs = lambdaArchs()
  if (archs.length > 1) {
    throw new Error(
      `Builds on this host take one LAMBDA_ARCH, not ${archs.join(',')}; bun run build builds both`
    )
  }
  return archs[0]!
}

const helpTexts = new Map<string, string>()

/**
 * `bun build` accepts flags it doesn't know without a word, so `--aot` or `--trim` on a Bun that
 * lacks them quietly builds a plain executable. Its help lists them once they're in.
 */
const supportsFlag = (bin: string, flag: string) => {
  let help = helpTexts.get(bin)
  if (help === undefined) {
    // The AOT branch colors its help even when piped, so drop the ANSI codes before matching.
    help = stripVTControlCharacters(read(bin, ['build', '--help']))
    helpTexts.set(bin, help)
  }
  return new RegExp(`^\\s+${flag}\\s`, 'm').test(help)
}

/**
 * The flags beyond `--compile` each variant needs from `bun build`. `compile-canary` passes none,
 * but needs `--trim` all the same: it's how a build of oven-sh/bun#45631 tells itself apart from a
 * release, without which that variant would be BunCompile under another name.
 */
const NEEDED_FLAGS: Record<BunVariant, string[]> = {
  bun: [],
  compile: [],
  'compile-canary': ['--trim'],
  'compile-trim': ['--trim'],
  aot: ['--aot'],
  'aot-trim': ['--aot', '--trim'],
}

/** Why `variant` can't be built on this host for `arch`, or `undefined` when it can. */
export const unavailableReason = (variant: BunVariant, arch: LambdaArch) => {
  const needed = NEEDED_FLAGS[variant]
  if (!needed.length) return undefined
  if (needed.includes('--aot')) {
    if (process.platform !== 'linux') {
      return `--aot compiles for the build host only, and this host runs ${process.platform}`
    }
    if (toLambdaArch(process.arch) !== arch) {
      return `--aot can't cross-compile from ${toLambdaArch(process.arch)} to ${arch}`
    }
  }
  const bin = bunAotBin()
  const missing = needed.filter((flag) => !supportsFlag(bin, flag))
  if (missing.length) {
    return `${bin} (bun ${bunVersion(bin)}) has no ${missing.join(' or ')}; point BUN_AOT_BIN at a build of oven-sh/bun#45631`
  }
  return undefined
}

const assertAvailable = (variant: BunVariant, arch: LambdaArch) => {
  const reason = unavailableReason(variant, arch)
  if (reason) throw new Error(`Can't build the ${variant} variant: ${reason}`)
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
 * code, and a 128 MB Lambda refuses the 256 MB table the AOT runtime maps at startup, so the AOT
 * variants start through a `bootstrap` that preloads aot-shim.c.
 */
const addAotShim = (bundle: string) => {
  try {
    run(process.env.CC || 'cc', [
      '-shared',
      '-fPIC',
      '-O2',
      '-o',
      path.join(bundle, 'aot-shim.so'),
      path.resolve(AOT_SHIM_SOURCE),
    ])
  } catch (error) {
    throw new Error('An --aot build needs a C compiler ($CC or cc) for the Lambda AOT shim', {
      cause: error,
    })
  }
  writeBootstrap(bundle, 'LD_PRELOAD="${0%/*}/aot-shim.so" exec "${0%/*}/app"')
}

// Lambda's /var/task has neither, so a compiled executable shouldn't look for them on every cold start.
const NO_AUTOLOAD = ['--no-compile-autoload-dotenv', '--no-compile-autoload-bunfig']

/** The `bun build` arguments of an `--aot` variant, short of `--outfile`; scripts/explain.ts adds `--explain`. */
export const aotBuildArgs = (variant: 'aot' | 'aot-trim', entry = path.resolve(ENTRY)) => [
  'build',
  entry,
  '--compile',
  '--aot',
  ...(variant === 'aot-trim' ? ['--trim'] : []),
  ...NO_AUTOLOAD,
]

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
    case 'compile':
    case 'compile-canary':
    case 'compile-trim': {
      const trim = variant === 'compile-trim'
      if (variant !== 'compile') assertAvailable(variant, arch)
      run(variant === 'compile' ? bunBin() : bunAotBin(), [
        'build',
        entry,
        '--compile',
        ...(trim ? ['--trim'] : []),
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
      assertAvailable(variant, arch)
      run(bunAotBin(), [...aotBuildArgs(variant, entry), '--outfile', path.join(bundle, 'app')])
      addAotShim(bundle)
      break
    }
  }
  return bundle
}
