import path from 'node:path'
import {
  type BunVariant,
  buildBunBundle,
  type LambdaArch,
  lambdaArch,
  unavailableReason,
} from './build'

type NodeRuntime = 'nodejs22.x' | 'nodejs24.x' | 'nodejs26.x'

type Variant =
  | { id: string; kind: 'bun'; variant: BunVariant }
  | { id: string; kind: 'node'; runtime: NodeRuntime }

export const VARIANTS: Variant[] = [
  { id: 'BunRuntime', kind: 'bun', variant: 'bun' },
  { id: 'BunCompile', kind: 'bun', variant: 'compile' },
  { id: 'BunCompileTrim', kind: 'bun', variant: 'compile-trim' },
  { id: 'BunCompileAot', kind: 'bun', variant: 'aot' },
  { id: 'BunCompileAotTrim', kind: 'bun', variant: 'aot-trim' },
  { id: 'Node22', kind: 'node', runtime: 'nodejs22.x' },
  { id: 'Node24', kind: 'node', runtime: 'nodejs24.x' },
  // A public preview since August 2026. The aws provider pinned in sst.config.ts is the first
  // SST can use that accepts it.
  { id: 'Node26', kind: 'node', runtime: 'nodejs26.x' },
]

/** Settings every variant shares, so only the runtime differs between them. */
const shared = (id: string, architecture: LambdaArch) => ({
  architecture,
  memory: `${Number(process.env.LAMBDA_MEMORY ?? 1769)} MB` as const,
  timeout: '10 seconds' as const,
  url: true,
  environment: { VARIANT: id },
  // Live mode would route invocations to this machine, which measures nothing.
  dev: false as const,
})

/** `VARIANTS=BunCompile,Node24` deploys just those; unset deploys all of them. */
const selected = () => {
  const only = process.env.VARIANTS?.split(',').map((id) => id.trim())
  if (!only) return VARIANTS
  const unknown = only.filter((id) => !VARIANTS.some((v) => v.id === id))
  if (unknown.length) throw new Error(`Unknown VARIANTS: ${unknown.join(', ')}`)
  return VARIANTS.filter((v) => only.includes(v.id))
}

export const createFunctions = () => {
  const architecture = lambdaArch()
  const functions: Record<string, sst.aws.Function> = {}

  for (const v of selected()) {
    if (v.kind === 'node') {
      functions[v.id] = new sst.aws.Function(v.id, {
        ...shared(v.id, architecture),
        handler: 'src/node.handler',
        // SST's types stop at nodejs24.x; its builder passes any runtime through.
        runtime: v.runtime as 'nodejs24.x',
      })
      continue
    }

    const reason = unavailableReason(v.variant, architecture)
    if (reason) {
      console.warn(`Skipping ${v.id}: ${reason}`)
      continue
    }
    const bundle = buildBunBundle({
      variant: v.variant,
      bundle: path.join($cli.paths.work, 'bun-lambda', v.id),
      arch: architecture,
      cacheDir: path.join($cli.paths.work, 'bun-cache'),
    })
    functions[v.id] = new sst.aws.Function(v.id, {
      ...shared(v.id, architecture),
      bundle,
      handler: 'bootstrap',
      runtime: 'provided.al2023',
    })
  }

  return functions
}
