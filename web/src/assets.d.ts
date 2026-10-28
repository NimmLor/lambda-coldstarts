/** Bun's bundler copies an imported SVG into dist/ and gives back its URL. */
declare module '*.svg' {
  const url: string
  export default url
}

/** Bun's bundler pulls an imported stylesheet into the page's CSS bundle. */
declare module '*.css'
