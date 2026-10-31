import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import {
  type BunVariant,
  buildBunBundle,
  type LambdaArch,
  lambdaArchs,
  unavailableReason,
  versionFile,
} from './build'
import { buildLlrtBundle, LLRT_HANDLER, type LlrtVariant, llrtUnavailableReason } from './llrt'

type NodeRuntime = 'nodejs22.x' | 'nodejs24.x' | 'nodejs26.x'

/** A variant whose bundle this repo builds, and which runs on `provided.al2023`. */
type BuiltVariant =
  | { id: string; kind: 'bun'; variant: BunVariant }
  | { id: string; kind: 'llrt'; variant: LlrtVariant }

type Variant =
  | BuiltVariant
  | { id: string; kind: 'node'; runtime: NodeRuntime }
  // A Lambda Web Function rather than a function, deployed by infra/web-function.ts.
  | { id: string; kind: 'web' }
  // A Lambda MicroVM image, deployed by infra/microvm.ts.
  | { id: string; kind: 'microvm' }

export const VARIANTS: Variant[] = [
  { id: 'BunRuntime', kind: 'bun', variant: 'bun' },
  { id: 'BunCompile', kind: 'bun', variant: 'compile' },
  // BunCompile built by the Bun that builds the --trim and --aot variants, so comparing those with
  // this one leaves out what that Bun itself changes.
  { id: 'BunCompileCanary', kind: 'bun', variant: 'compile-canary' },
  { id: 'BunCompileTrim', kind: 'bun', variant: 'compile-trim' },
  { id: 'BunCompileAot', kind: 'bun', variant: 'aot' },
  { id: 'BunCompileAotTrim', kind: 'bun', variant: 'aot-trim' },
  // The handler bundle as JavaScript, and as the bytecode `llrt compile` makes of it; see infra/llrt.ts.
  { id: 'Llrt', kind: 'llrt', variant: 'llrt' },
  { id: 'LlrtBytecode', kind: 'llrt', variant: 'llrt-bytecode' },
  // LLRT's Lambda builds that embed the common AWS SDK clients, and all of them.
  { id: 'LlrtStdSdk', kind: 'llrt', variant: 'llrt-std-sdk' },
  { id: 'LlrtFullSdk', kind: 'llrt', variant: 'llrt-full-sdk' },
  { id: 'Node22', kind: 'node', runtime: 'nodejs22.x' },
  { id: 'Node24', kind: 'node', runtime: 'nodejs24.x' },
  // A public preview since August 2026. The aws provider pinned in sst.config.ts is the first
  // SST can use that accepts it.
  { id: 'Node26', kind: 'node', runtime: 'nodejs26.x' },
  // Only on arm64, with the 2 GB every Web Function gets.
  { id: 'Node24Web', kind: 'web' },
  // Only on arm64, at every size Lambda offers; see infra/microvm.ts.
  { id: 'Node24MicroVm', kind: 'microvm' },
]

/** Tags every benchmarked function, which is how PerfMeasure's permissions pick them; see infra/perf.ts. */
export const BENCH_TAG = { key: 'bench', value: 'target' }

/** Settings every variant shares, so only the runtime and memory differ between them. */
const shared = (id: string, architecture: LambdaArch, memoryMb: number) => ({
  architecture,
  memory: `${memoryMb} MB` as const,
  timeout: '10 seconds' as const,
  url: true,
  environment: { VARIANT: id },
  tags: { [BENCH_TAG.key]: BENCH_TAG.value },
  // Live mode would route invocations to this machine, which measures nothing.
  dev: false as const,
})

/**
 * `LAMBDA_MEMORY=512,1769` deploys every variant with each of those MB; unset, with all of these.
 * 1769 MB is one full vCPU.
 */
const memorySizes = () => {
  const sizes = (process.env.LAMBDA_MEMORY ?? '128,256,512,1024,1769')
    .split(',')
    .map((mb) => Number(mb.trim()))
  const invalid = sizes.filter((mb) => !Number.isInteger(mb) || mb < 128 || mb > 10240)
  if (invalid.length)
    throw new Error(`LAMBDA_MEMORY must list MB from 128 to 10240, not ${invalid.join(', ')}`)
  return [...new Set(sizes)]
}

/** `VARIANTS=BunCompile,Node24` deploys just those; unset deploys all of them. */
export const selected = () => {
  const only = process.env.VARIANTS?.split(',').map((id) => id.trim())
  if (!only) return VARIANTS
  const unknown = only.filter((id) => !VARIANTS.some((v) => v.id === id))
  if (unknown.length) throw new Error(`Unknown VARIANTS: ${unknown.join(', ')}`)
  return VARIANTS.filter((v) => only.includes(v.id))
}

/**
 * With more than one architecture, each function's id says which it runs on: `BunCompileArm64`. With
 * more than one memory size, it then says how much it has: `BunCompileArm64M128`.
 */
const ARCH_SUFFIX: Record<LambdaArch, string> = { x86_64: 'X64', arm64: 'Arm64' }

/** What Lambda's `_HANDLER` is: Bun's executables poll the Runtime API themselves, LLRT imports a module. */
export const handlerOf = (v: BuiltVariant) => (v.kind === 'llrt' ? LLRT_HANDLER : 'bootstrap')

/** Why `v` can't be built on this host for `arch`, or `undefined` when it can. */
export const unavailable = (v: BuiltVariant, arch: LambdaArch) =>
  v.kind === 'bun' ? unavailableReason(v.variant, arch) : llrtUnavailableReason(v.variant, arch)

/** Builds `v` for `arch` into `bundle` and returns it; `cacheDir` keeps downloads between builds. */
export const buildBundle = (
  v: BuiltVariant,
  options: { bundle: string; arch: LambdaArch; cacheDir: string }
) =>
  v.kind === 'bun'
    ? buildBunBundle({ variant: v.variant, ...options })
    : buildLlrtBundle({ variant: v.variant, ...options })

/**
 * The bundle of a Bun or LLRT variant: built on this host, or, with `BUN_BUNDLES`, the one
 * scripts/build-docker.ts left in `$BUN_BUNDLES/<arch>/<Variant>`. A string says why there is none.
 */
const bundleOf = (v: BuiltVariant, arch: LambdaArch) => {
  const prebuilt = process.env.BUN_BUNDLES
  if (prebuilt) {
    const bundle = path.resolve(prebuilt, arch, v.id)
    if (existsSync(path.join(bundle, 'bootstrap'))) return { bundle }
    return { reason: `no ${path.join(bundle, 'bootstrap')}; bun run build builds it` }
  }
  const reason = unavailable(v, arch)
  if (reason) return { reason }
  return {
    bundle: buildBundle(v, {
      bundle: path.join($cli.paths.work, 'bun-lambda', arch, v.id),
      arch,
      cacheDir: path.join($cli.paths.work, 'bun-cache'),
    }),
  }
}

export const createFunctions = () => {
  const architectures = lambdaArchs()
  const memories = memorySizes()
  const functions: Record<string, sst.aws.Function> = {}

  for (const architecture of architectures) {
    for (const v of selected()) {
      if (v.kind === 'web' || v.kind === 'microvm') continue
      // Built once, deployed at every memory size.
      const { bundle, reason } =
        v.kind === 'node' ? { bundle: undefined, reason: undefined } : bundleOf(v, architecture)
      const version =
        bundle && existsSync(versionFile(bundle))
          ? readFileSync(versionFile(bundle), 'utf8')
          : undefined

      for (const memoryMb of memories) {
        const id =
          (architectures.length > 1 ? `${v.id}${ARCH_SUFFIX[architecture]}` : v.id) +
          (memories.length > 1 ? `M${memoryMb}` : '')

        if (v.kind === 'node') {
          functions[id] = new sst.aws.Function(id, {
            ...shared(id, architecture, memoryMb),
            handler: 'src/node.handler',
            // SST's types stop at nodejs24.x; its builder passes any runtime through.
            runtime: v.runtime as 'nodejs24.x',
          })
          continue
        }

        if (!bundle) {
          console.warn(`Skipping ${id}: ${reason}`)
          continue
        }
        functions[id] = new sst.aws.Function(id, {
          ...shared(id, architecture, memoryMb),
          bundle,
          handler: handlerOf(v),
          runtime: 'provided.al2023',
          // What PerfMeasure records as the version, since the process can't tell: a canary Bun
          // reports the release it precedes, and LLRT not which of its builds it is.
          description: version,
        })
      }
    }
  }

  return functions
}
