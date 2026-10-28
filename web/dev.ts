/**
 * `bun run dev`: serves the pages with hot reloading and, like PerfRouter in infra/perf.ts,
 * forwards /api/* to PerfApi without the /api prefix. `PERF_API_URL` is PerfApi's URL, the
 * stage's `perf.api` output.
 */
import imprint from './imprint.html'
import index from './index.html'
import privacy from './privacy.html'

const target = process.env.PERF_API_URL?.replace(/\/$/, '')
if (!target) throw new Error('Set PERF_API_URL, e.g. to the perf.api output in .sst/outputs.json')

const server = Bun.serve({
  development: true,
  routes: {
    '/': index,
    '/imprint': imprint,
    '/privacy': privacy,
    // build.ts copies these into dist/fonts; here they come straight from @fontsource.
    '/fonts/:file': (request) => {
      const { file } = request.params
      const match = /^([a-z-]+)-latin-\d+-normal\.woff2$/.exec(file)
      return match
        ? new Response(Bun.file(`node_modules/@fontsource/${match[1]}/files/${file}`))
        : new Response('Not found', { status: 404 })
    },
    '/api/*': (request) => {
      const url = new URL(request.url)
      return fetch(`${target}${url.pathname.slice('/api'.length)}${url.search}`)
    },
  },
})
console.log(`${server.url}, /api/* → ${target}`)
