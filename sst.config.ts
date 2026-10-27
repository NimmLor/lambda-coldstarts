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
        aws: { version: '7.52.0' },
      },
    }
  },
  async run() {
    const { createFunctions } = await import('./infra/functions')
    const functions = createFunctions()

    return {
      functions: Object.fromEntries(
        Object.entries(functions).map(([id, fn]) => [
          id,
          { name: fn.name, url: fn.url },
        ])
      ),
    }
  },
})
