// eslint-disable-next-line @typescript-eslint/triple-slash-reference -- SST's config globals aren't a module
/// <reference path="./.sst/platform/config.d.ts" />

export default $config({
  app(input) {
    return {
      name: 'bun-aot-lambda',
      home: 'aws',
      removal: input?.stage === 'production' ? 'retain' : 'remove',
      providers: {
        // 7.52.0 is the first aws provider whose runtime list includes nodejs26.x. SST 4.17.2
        // defaults to 7.20.0, which rejects it.
        // AWS_PROFILE comes from .env locally; CI leaves it unset and passes credentials instead.
        aws: { version: '7.52.0', profile: process.env.AWS_PROFILE || undefined },
      },
    }
  },
  async run() {
    // Caps what a burst of requests can cost. PerfApi serves the site's /api/runs, so it gets room
    // for more than one visitor at a time, and PerfRun measures every function at once, each round
    // through PerfMeasure. $transform only reaches functions created after it.
    const RESERVED: Record<string, number> = { PerfApi: 10, PerfMeasure: 100 }
    $transform(sst.aws.Function, (args, _opts, name) => {
      args.concurrency = { reserved: RESERVED[name] ?? 1 }
    })

    const { createFunctions } = await import('./infra/functions')
    const { createPerf } = await import('./infra/perf')
    const functions = createFunctions()

    return {
      functions: Object.fromEntries(
        Object.entries(functions).map(([id, fn]) => [id, { name: fn.name, url: fn.url }])
      ),
      perf: createPerf(functions),
    }
  },
})
