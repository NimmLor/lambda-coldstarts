/**
 * `bun run dev`: serves the pages with hot reloading and, like PerfRouter in infra/perf.ts,
 * forwards /api/* to PerfApi without the /api prefix. `PERF_API_URL` is PerfApi's URL, the
 * stage's `perf.api` output.
 */
import admin from './admin.html'
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
    '/admin': admin,
    // build.ts copies fonts/ into dist/fonts.
    '/fonts/:file': (request) => {
      const { file } = request.params
      return /^[a-z-]+-latin-\d+-normal\.woff2$/.test(file)
        ? new Response(Bun.file(`fonts/${file}`))
        : new Response('Not found', { status: 404 })
    },
    '/api/*': async (request) => {
      const url = new URL(request.url)
      const response = await fetch(`${target}${url.pathname.slice('/api'.length)}${url.search}`, {
        method: request.method,
      })
      // fetch already decompressed the body; passing the encoding on breaks it for the browser.
      const headers = new Headers(response.headers)
      headers.delete('content-encoding')
      headers.delete('content-length')
      return new Response(response.body, { status: response.status, headers })
    },
  },
})
console.log(`${server.url}, /api/* → ${target}`)
