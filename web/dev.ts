/**
 * `bun run dev`: serves index.html with hot reloading and, like PerfRouter in infra/perf.ts,
 * forwards /api/* to PerfApi without the /api prefix. `PERF_API_URL` is PerfApi's URL, the
 * stage's `perf.api` output.
 */
import index from './index.html'

const target = process.env.PERF_API_URL?.replace(/\/$/, '')
if (!target) throw new Error('Set PERF_API_URL, e.g. to the perf.api output in .sst/outputs.json')

const server = Bun.serve({
  development: true,
  routes: {
    '/': index,
    '/api/*': (request) => {
      const url = new URL(request.url)
      return fetch(`${target}${url.pathname.slice('/api'.length)}${url.search}`)
    },
  },
})
console.log(`${server.url}, /api/* → ${target}`)
