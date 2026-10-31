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
        // For Lambda Web Functions, which the aws provider has no resources for yet; see
        // infra/web-function.ts. In the same region as the aws provider, from .env or CI.
        'aws-native': {
          version: '1.84.1',
          // Typed as the regions it knew of when released.
          region: process.env.AWS_REGION as awsnative.types.enums.Region,
          profile: process.env.AWS_PROFILE || undefined,
        },
      },
    }
  },
  async run() {
    // Caps what a burst of requests can cost. PerfApi serves the site's /api/runs, so it gets room
    // for more than one visitor at a time, and PerfRun measures 40 functions at once, each round
    // through PerfMeasure. $transform only reaches functions created after it.
    const RESERVED: Record<string, number> = { PerfApi: 10, PerfMeasure: 100 }
    $transform(sst.aws.Function, (args, _opts, name) => {
      args.concurrency = { reserved: RESERVED[name] ?? 1 }
    })

    const { createFunctions, selected } = await import('./infra/functions')
    const { createWebFunction } = await import('./infra/web-function')
    const { createMicrovm } = await import('./infra/microvm')
    const { createPerf } = await import('./infra/perf')
    const functions = createFunctions()
    const webFunctions = selected()
      .filter((v) => v.kind === 'web')
      .map((v) => createWebFunction(v.id))
    const microvms = selected()
      .filter((v) => v.kind === 'microvm')
      .map((v) => createMicrovm(v.id))

    return {
      functions: Object.fromEntries(
        Object.entries(functions).map(([id, fn]) => [id, { name: fn.name, url: fn.url }])
      ),
      webFunctions: Object.fromEntries(
        webFunctions.map((w) => [w.target.id, { name: w.name, domain: w.target.domain }])
      ),
      microvms: Object.fromEntries(
        microvms.flatMap((m) => m.targets.map((t) => [t.id, { image: t.imageArn }]))
      ),
      perf: createPerf(functions, webFunctions, microvms),
    }
  },
})
