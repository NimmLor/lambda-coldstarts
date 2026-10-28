/**
 * `bun run build`: bundles the pages, the dashboard's React app and Tailwind CSS into dist/ for
 * PerfSite, whose router serves /imprint from imprint.html.
 */
import tailwind from 'bun-plugin-tailwind'

/** The fonts each page's inline @font-face rules load from /fonts. */
const FONTS = [
  'host-grotesk/files/host-grotesk-latin-400-normal.woff2',
  'host-grotesk/files/host-grotesk-latin-500-normal.woff2',
  'atkinson-hyperlegible-mono/files/atkinson-hyperlegible-mono-latin-400-normal.woff2',
  'atkinson-hyperlegible-mono/files/atkinson-hyperlegible-mono-latin-500-normal.woff2',
].map((path) => `node_modules/@fontsource/${path}`)

await Bun.$`rm -rf dist`
await Bun.build({
  entrypoints: ['index.html', 'imprint.html', 'privacy.html', 'admin.html'],
  outdir: 'dist',
  plugins: [tailwind],
  minify: true,
  define: { 'process.env.NODE_ENV': JSON.stringify('production') },
})
await Bun.$`mkdir -p dist/fonts && cp ${FONTS} dist/fonts/`
