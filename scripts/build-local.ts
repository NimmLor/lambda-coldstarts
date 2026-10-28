/**
 * Builds every Bun and LLRT variant into ./dist/<arch>/<Variant> and, on Linux, runs each `bootstrap` against a
 * fake Lambda Runtime API: a quick check that a bundle starts and answers before deploying it.
 *
 *   bun scripts/build-local.ts [BunCompile ...]
 */
import { stat } from 'node:fs/promises'
import path from 'node:path'
import { serve } from 'bun'
import { lambdaArch, toLambdaArch } from '../infra/build'
import { buildBundle, handlerOf, unavailable, VARIANTS } from '../infra/functions'

const arch = lambdaArch()
const canRun = process.platform === 'linux' && toLambdaArch(process.arch) === arch
const wanted = process.argv.slice(2)

const dirSize = async (dir: string) => {
  let total = 0
  for await (const file of new Bun.Glob('*').scan({ cwd: dir, onlyFiles: true })) {
    total += (await stat(path.join(dir, file))).size
  }
  return total
}

/** Starts the bundle's `bootstrap`, hands it two events and measures until it asks for the first one. */
const smokeTest = async (bundle: string, handler: string) => {
  const bootstrap = path.join(bundle, 'bootstrap')
  const events = [{ rawPath: '/cold' }, { rawPath: '/warm' }]
  const responses: unknown[] = []
  let firstNextMs = 0
  const started = performance.now()
  let done!: () => void
  const finished = new Promise<void>((resolve) => (done = resolve))

  const server = serve({
    port: 0,
    async fetch(request: Request) {
      const { pathname } = new URL(request.url)
      if (pathname.endsWith('/next')) {
        firstNextMs ||= performance.now() - started
        const event = events.shift()
        if (!event) {
          done()
          return new Response('done', { status: 500 })
        }
        return Response.json(event, {
          headers: {
            'lambda-runtime-aws-request-id': crypto.randomUUID(),
            'lambda-runtime-deadline-ms': String(Date.now() + 10_000),
            'lambda-runtime-invoked-function-arn': 'arn:aws:lambda:local:0:function:smoke',
          },
        })
      }
      responses.push(await request.json())
      return new Response(null, { status: 202 })
    },
  })

  const child = Bun.spawn([bootstrap], {
    env: {
      PATH: process.env.PATH,
      AWS_LAMBDA_RUNTIME_API: `127.0.0.1:${server.port}`,
      AWS_LAMBDA_FUNCTION_MEMORY_SIZE: '1769',
      // As Lambda sets them. LLRT serves invocations only with `_HANDLER`, and imports it from here.
      _HANDLER: handler,
      LAMBDA_TASK_ROOT: bundle,
      VARIANT: path.basename(bundle),
    },
    stdout: 'inherit',
    stderr: 'inherit',
  })
  await Promise.race([finished, child.exited, Bun.sleep(15_000)])
  child.kill()
  server.stop(true)

  const cold = responses[0] as { body?: string } | undefined
  if (!cold?.body) throw new Error(`${bootstrap} answered nothing`)
  const report = JSON.parse(cold.body)
  return {
    initMs: Math.round(firstNextMs * 10) / 10,
    startupMs: report.container.startupMs,
    rssMb: report.memory.rssMb,
    runtime: report.runtime,
    answered: responses.length,
  }
}

const rows: Record<string, unknown>[] = []
for (const v of VARIANTS) {
  if (v.kind === 'node' || (wanted.length && !wanted.includes(v.id))) continue
  const reason = unavailable(v, arch)
  if (reason) {
    console.warn(`Skipping ${v.id}: ${reason}`)
    continue
  }
  const bundle = buildBundle(v, {
    bundle: path.resolve('dist', arch, v.id),
    arch,
    cacheDir: path.resolve('dist', '.cache'),
  })
  const row: Record<string, unknown> = {
    variant: v.id,
    bundleMb: Math.round(((await dirSize(bundle)) / 1024 / 1024) * 10) / 10,
  }
  if (canRun) Object.assign(row, await smokeTest(bundle, handlerOf(v)))
  rows.push(row)
}

console.table(rows)
if (!canRun) console.log(`Built for ${arch}; this host can't run them.`)
