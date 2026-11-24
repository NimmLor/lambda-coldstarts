import { Y_LABEL } from './Chart'
import { DASHES, type Family, niceMax } from './data'

/** Each family's line where a chart draws one per family: its headline build's colour and dash. */
export const FAMILY_LINES: Record<Family, { color: string; dash?: string }> = {
  Bun: { color: 'var(--color-line-BunCompileTrim)', dash: DASHES.Bun },
  LLRT: { color: 'var(--color-line-Llrt)', dash: DASHES.LLRT },
  Node: { color: 'var(--color-line-Node24)', dash: DASHES.Node },
}

export type SizeSeries = {
  name: string
  color: string
  dash?: string
  /** One per memory size; a gap where a size wasn't measured. */
  values: (number | undefined)[]
}

/**
 * A line per series across the memory sizes, the picked size's column shaded. The value labels sit
 * inside the plot, over their gridlines.
 */
export const SizeChart = ({
  series,
  memories,
  highlight,
  label,
  height = 180,
}: {
  series: SizeSeries[]
  memories: number[]
  /** The picked size, whose column is shaded. */
  highlight?: number
  /** What the chart shows, for a screen reader. */
  label: string
  height?: number
}) => {
  const max = niceMax(
    Math.max(0, ...series.flatMap((s) => s.values.filter((v) => v !== undefined)))
  )
  const n = memories.length
  const x = (i: number) => (n <= 1 ? 50 : 6 + (i / (n - 1)) * 88)
  const y = (v: number) => 100 - (v / max) * 100
  const grid = [0, 0.5, 1].map((g) => ({
    top: 100 - g * 100,
    label: String(Number((max * g).toPrecision(3))),
  }))
  const at = highlight === undefined ? -1 : memories.indexOf(highlight)
  return (
    <div className="flex flex-col gap-2">
      <div className="relative" style={{ height }} role="img" aria-label={label}>
        {at >= 0 && (
          <div
            aria-hidden="true"
            className="absolute inset-y-0 w-[12%] -translate-x-1/2 rounded-chip bg-paper-3/70"
            style={{ left: `${x(at)}%` }}
          />
        )}
        <svg
          aria-hidden="true"
          viewBox="0 0 100 100"
          preserveAspectRatio="none"
          className="absolute inset-0 size-full overflow-visible"
        >
          {grid.map((g, i) => (
            <line
              key={g.top}
              x1={0}
              x2={100}
              y1={g.top}
              y2={g.top}
              className={i === 0 ? 'stroke-rule-2' : 'stroke-rule'}
              strokeWidth={1}
              vectorEffect="non-scaling-stroke"
            />
          ))}
          {series.map((s) => (
            <polyline
              key={s.name}
              fill="none"
              style={{ stroke: s.color }}
              strokeWidth={2.5}
              strokeDasharray={s.dash}
              strokeLinejoin="round"
              strokeLinecap="round"
              vectorEffect="non-scaling-stroke"
              points={s.values
                .flatMap((v, i) => (v === undefined ? [] : [`${x(i)},${y(v)}`]))
                .join(' ')}
            />
          ))}
        </svg>
        {series.flatMap((s) =>
          s.values.flatMap((v, i) =>
            v === undefined
              ? []
              : [
                  <span
                    key={`${s.name}:${i}`}
                    aria-hidden="true"
                    className="mark absolute size-1.5 -translate-1/2 rounded-full"
                    style={{ left: `${x(i)}%`, top: `${y(v)}%`, background: s.color }}
                  />,
                ]
          )
        )}
        <div aria-hidden="true" className="pointer-events-none absolute inset-0">
          {grid.slice(1).map((g) => (
            <span key={g.top} className={Y_LABEL} style={{ top: `${g.top}%` }}>
              {g.label}
            </span>
          ))}
        </div>
      </div>
      <div aria-hidden="true" className="relative h-5">
        {memories.map((mb, i) => (
          <span
            key={mb}
            className={`measured absolute -translate-x-1/2 text-xs whitespace-nowrap ${i === at ? 'text-ink' : 'text-muted'}`}
            style={{ left: `${x(i)}%` }}
          >
            {mb}
          </span>
        ))}
      </div>
    </div>
  )
}
