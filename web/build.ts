/**
 * `bun run build`: bundles the pages, the dashboard's React app and Tailwind CSS into dist/ for
 * PerfSite, whose router serves /imprint from imprint.html, and prerenders the dashboard.
 */
import tailwind from 'bun-plugin-tailwind'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

await Bun.$`rm -rf dist`
await Bun.build({
  entrypoints: ['index.html', 'imprint.html', 'privacy.html', 'admin.html'],
  outdir: 'dist',
  plugins: [tailwind],
  minify: true,
  define: {
    'process.env.NODE_ENV': JSON.stringify('production'),
    // Turns on src/analytics.ts; a build without it tracks nothing.
    'process.env.POSTHOG_PROJECT_TOKEN': JSON.stringify(process.env.POSTHOG_PROJECT_TOKEN ?? ''),
  },
})
// index.html's dashboard, prerendered as it first lays out, so the page has it before its script
// runs: src/prerender.tsx bundled for Bun, which names the icons as the page's bundle does.
const prerenderDir = await mkdtemp(join(tmpdir(), 'prerender-'))
try {
  const bundle = await Bun.build({
    entrypoints: ['src/prerender.tsx'],
    outdir: prerenderDir,
    target: 'bun',
    define: { 'process.env.NODE_ENV': JSON.stringify('production') },
  })
  const { prerender } = (await import(bundle.outputs[0]!.path)) as typeof import('./src/prerender')
  const now = Date.now()
  const index = await Bun.file('dist/index.html').text()
  const empty = '<div id="app"></div>'
  if (!index.includes(empty)) throw new Error(`dist/index.html has no ${empty}`)
  await Bun.write(
    'dist/index.html',
    index.replace(empty, () => `<div id="app" data-now="${now}">${prerender(now)}</div>`)
  )
} finally {
  await rm(prerenderDir, { recursive: true, force: true })
}
// The fonts each page's inline @font-face rules load from /fonts, with their OFL licenses.
await Bun.$`cp -R fonts dist/fonts`
// The social preview index.html's og:image names; `bun run og` renders it from og.html.
await Bun.$`cp og.png dist/og.png`
// For production's crawlers; PerfRouter answers robots.txt itself on every other stage.
await Bun.$`cp robots.txt sitemap.xml dist/`
