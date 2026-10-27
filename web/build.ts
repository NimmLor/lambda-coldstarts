/** `bun run build`: bundles index.html, its React app and Tailwind CSS into dist/ for PerfSite. */
import tailwind from 'bun-plugin-tailwind'

await Bun.$`rm -rf dist`
await Bun.build({
  entrypoints: ['index.html'],
  outdir: 'dist',
  plugins: [tailwind],
  minify: true,
  define: { 'process.env.NODE_ENV': JSON.stringify('production') },
  // Inlines BUN_PUBLIC_API_URL, which infra/perf.ts sets.
  env: 'BUN_PUBLIC_*',
})
