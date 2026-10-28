export const REPO = 'https://github.com/NimmLor/bun-aot-lambda'

/** The page's one column: capped and centred, its gutters growing past 1440. */
export const WRAP = 'mx-auto w-full max-w-(--container) px-(--gutter)'

/** The links every page ends on; imprint.html and privacy.html repeat them by hand. */
export const SiteLinks = () => (
  <nav aria-label="Site" className="flex flex-wrap gap-x-6 gap-y-2">
    <a href={REPO}>NimmLor/bun-aot-lambda</a>
    <a href="/imprint">Imprint</a>
    <a href="/privacy">Privacy policy</a>
  </nav>
)
