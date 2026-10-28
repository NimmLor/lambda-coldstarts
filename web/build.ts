/**
 * `bun run build`: bundles the pages, the dashboard's React app and Tailwind CSS into dist/ for
 * PerfSite, whose router serves /imprint from imprint.html.
 */
import tailwind from 'bun-plugin-tailwind'

await Bun.$`rm -rf dist`
await Bun.build({
  entrypoints: ['index.html', 'imprint.html', 'privacy.html', 'admin.html'],
  outdir: 'dist',
  plugins: [tailwind],
  minify: true,
  define: { 'process.env.NODE_ENV': JSON.stringify('production') },
})
// The fonts each page's inline @font-face rules load from /fonts, with their OFL licenses.
await Bun.$`cp -R fonts dist/fonts`
