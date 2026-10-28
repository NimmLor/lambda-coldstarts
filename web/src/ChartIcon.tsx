import type { Stat } from './data'

/** 24×24 outline paths, stroked in the current colour. */
const PATHS = {
  // Snowflake
  cold: 'M12 2v20M3.34 7l17.32 10M3.34 17 20.66 7M9.5 3.5 12 6l2.5-2.5M9.5 20.5 12 18l2.5 2.5M3.4 10.6l3.4-.9-.9-3.4M18.1 17.7l-.9-3.4 3.4-.9M5.9 17.7l.9-3.4-3.4-.9M20.6 10.6l-3.4-.9.9-3.4',
  // Flame
  warm: 'M12 22a7.5 7.5 0 0 0 7.5-7.5c0-4.2-3-6.5-4.3-10.5-2 2-3 4-3 6-1.8-1.1-2.6-3.3-2-6C6.2 6.9 4.5 10.7 4.5 14.5A7.5 7.5 0 0 0 12 22ZM12 22a3 3 0 0 0 3-3c0-1.8-1.2-3-3-4.8-1.8 1.8-3 3-3 4.8a3 3 0 0 0 3 3Z',
  // Memory chip
  mem: 'M6 6h12a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1ZM9 10h6v4H9ZM9 2v4M15 2v4M9 18v4M15 18v4M1 9h4M1 15h4M19 9h4M19 15h4',
  // Stopwatch
  dur: 'M12 22a8 8 0 1 0 0-16 8 8 0 0 0 0 16ZM12 10v4l2 2M10 2h4M12 2v4M19 6l1.5-1.5',
  // Bars rising with memory size
  sizes: 'M5 20v-4M10 20v-8M15 20v-12M20 20V4',
} satisfies Partial<Record<Stat | 'sizes', string>>

export type ChartIconName = keyof typeof PATHS

/** Whole class names, so Tailwind finds them; the hues are in tokens.css. */
const COLORS: Record<ChartIconName, string> = {
  cold: 'text-icon-cold',
  warm: 'text-icon-warm',
  mem: 'text-icon-mem',
  dur: 'text-icon-dur',
  sizes: 'text-icon-sizes',
}

/** The small glyph left of a chart's headline. */
export const ChartIcon = ({ name, className = '' }: { name: ChartIconName; className?: string }) => (
  <svg
    aria-hidden="true"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.75"
    strokeLinecap="round"
    strokeLinejoin="round"
    className={`shrink-0 self-center ${COLORS[name]} ${className}`}
  >
    <path d={PATHS[name]} />
  </svg>
)
