/// <reference path="./.sst/platform/config.d.ts" />

export default $config({
  app() {
    return {
      name: 'bun-aot-lambda-repro',
      home: 'aws',
      removal: 'remove',
      providers: { aws: { profile: process.env.AWS_PROFILE || undefined } },
    }
  },
  async run() {
    const { readFileSync } = await import('node:fs')
    const version = `bun ${readFileSync('out/version', 'utf8').trim()}`

    // The same `--aot` executable twice, at Lambda's smallest memory size: once as the bootstrap
    // itself, once started through aot-shim.so. Built by build.sh.
    const fn = (name: string) =>
      new sst.aws.Function(name, {
        bundle: `out/${name}`,
        handler: 'bootstrap',
        runtime: 'provided.al2023',
        architecture: 'x86_64',
        memory: '128 MB',
        url: true,
        description: version,
      })

    return { Aot: fn('Aot').url, AotWithShim: fn('AotWithShim').url }
  },
})
