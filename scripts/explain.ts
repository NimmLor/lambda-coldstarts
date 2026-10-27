/**
 * Prints what `bun build --aot --explain` says about the handler: the code that compiled to a slow
 * path and how to fix it, worst first. Runs the AOT Bun in the same container as
 * scripts/build-docker.ts, for the host's architecture unless --arch says otherwise. A report name
 * picks another of its reports (json, guards, guards-json, trim, missed-optimizations,
 * allocations). Bun prints its build log to stdout ahead of every report, the JSON ones included.
 *
 *   bun scripts/explain.ts [--arch x86_64|arm64] [report]
 */
import { parseArgs } from 'node:util'
import { aotBuildArgs, ENTRY, parseLambdaArchs } from '../infra/build'
import { emulationHint, hostArch, runInImage } from './docker'

const { values: args, positionals } = parseArgs({
  options: { arch: { type: 'string', default: hostArch } },
  allowPositionals: true,
})
const [report] = positionals
const archs = parseLambdaArchs(args.arch!)
if (archs.length > 1 || positionals.length > 1) {
  console.error('Usage: bun scripts/explain.ts [--arch x86_64|arm64] [report]')
  process.exit(1)
}
const arch = archs[0]!

try {
  runInImage(arch, [
    'bun-aot',
    // BunCompileAot's build; --trim leaves the report as it is. ENTRY stays relative, so it
    // resolves against the container's /work rather than this host's checkout.
    ...aotBuildArgs('aot', ENTRY),
    report ? `--explain=${report}` : '--explain',
    // The executable is only built to be explained, so it stays in the container.
    '--outfile',
    '/tmp/app',
  ])
} catch {
  console.error(`\nExplaining the ${arch} build failed.${emulationHint(arch)}`)
  process.exit(1)
}
