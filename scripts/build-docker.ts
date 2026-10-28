/**
 * Builds the Bun and LLRT variants for each Lambda architecture into ./dist/<arch>/<Variant>, so one deploy
 * can ship both (`bun run deploy`). Every architecture builds in an Amazon Linux 2023
 * container of that architecture (scripts/docker.ts), which runs scripts/build-local.ts, smoke
 * test included.
 *
 *   bun scripts/build-docker.ts [--arch x86_64,arm64] [BunCompile ...]
 */
import { parseArgs } from 'node:util'
import { parseLambdaArchs } from '../infra/build'
import { emulationHint, runInImage } from './docker'

const { values: args, positionals: variants } = parseArgs({
  options: { arch: { type: 'string', default: 'x86_64,arm64' } },
  allowPositionals: true,
})

for (const arch of parseLambdaArchs(args.arch!)) {
  console.log(`\n== ${arch} ==`)
  try {
    runInImage(arch, [
      'bun',
      // The mounted repository's .env holds AWS credentials, which a build doesn't need.
      '--no-env-file',
      'scripts/build-local.ts',
      ...variants,
    ])
  } catch {
    // Docker has printed what went wrong.
    console.error(`\nThe ${arch} build failed.${emulationHint(arch)}`)
    process.exit(1)
  }
}
