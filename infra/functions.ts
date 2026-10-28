import { existsSync } from 'node:fs'
import path from 'node:path'
import {
  type BunVariant,
  buildBunBundle,
  type LambdaArch,
  lambdaArchs,
  unavailableReason,
} from './build'

type NodeRuntime = 'nodejs22.x' | 'nodejs24.x' | 'nodejs26.x'

type Variant =
  | { id: string; kind: 'bun'; variant: BunVariant }
  | { id: string; kind: 'node'; runtime: NodeRuntime }

export const VARIANTS: Variant[] = [
  { id: 'BunRuntime', kind: 'bun', variant: 'bun' },
  { id: 'BunCompile', kind: 'bun', variant: 'compile' },
  // BunCompile built by the Bun that builds the --trim and --aot variants, so comparing those with
  // this one leaves out what that Bun itself changes.
  { id: 'BunCompileCanary', kind: 'bun', variant: 'compile-canary' },
  { id: 'BunCompileTrim', kind: 'bun', variant: 'compile-trim' },
  { id: 'BunCompileAot', kind: 'bun', variant: 'aot' },
  { id: 'BunCompileAotTrim', kind: 'bun', variant: 'aot-trim' },
  { id: 'Node22', kind: 'node', runtime: 'nodejs22.x' },
  { id: 'Node24', kind: 'node', runtime: 'nodejs24.x' },
  // A public preview since August 2026. The aws provider pinned in sst.config.ts is the first
  // SST can use that accepts it.
  { id: 'Node26', kind: 'node', runtime: 'nodejs26.x' },
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
const selected = () => {
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

/**
 * The bundle of a Bun variant: built on this host, or, with `BUN_BUNDLES`, the one
 * scripts/build-docker.ts left in `$BUN_BUNDLES/<arch>/<Variant>`. A string says why there is none.
 */
const bunBundle = (id: string, variant: BunVariant, arch: LambdaArch) => {
  const prebuilt = process.env.BUN_BUNDLES
  if (prebuilt) {
    const bundle = path.resolve(prebuilt, arch, id)
    if (existsSync(path.join(bundle, 'bootstrap'))) return { bundle }
    return { reason: `no ${path.join(bundle, 'bootstrap')}; bun run build builds it` }
  }
  const reason = unavailableReason(variant, arch)
  if (reason) return { reason }
  return {
    bundle: buildBunBundle({
      variant,
      bundle: path.join($cli.paths.work, 'bun-lambda', arch, id),
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
      // Built once, deployed at every memory size.
      const { bundle, reason } =
        v.kind === 'bun'
          ? bunBundle(v.id, v.variant, architecture)
          : { bundle: undefined, reason: undefined }

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
          handler: 'bootstrap',
          runtime: 'provided.al2023',
        })
      }
    }
  }

  return functions
}
