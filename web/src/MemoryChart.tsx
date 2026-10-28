import { AXES, X_LABELS, Y_LABEL, Y_LABELS } from './Chart'
import { ChartIcon } from './ChartIcon'
import { DASHES, type Fn, niceMax, type View } from './data'

const HEIGHT = 300

/**
 * Each shown variant's cold start at every memory size it runs at, on the shown architecture: the
 * hovered run's, or the mean over the range. Clicking a size's column shows that size everywhere.
 */
export const MemoryChart = ({
  view,
  sized,
  memories,
  onPick,
  className = '',
}: {
  view: View
  /** Every function on the shown architecture, at every memory size. */
  sized: Fn[]
  /** Ascending. */
  memories: number[]
  onPick: (memoryMb: number) => void
  className?: string
}) => {
  const { shown, memoryMb, focus, agg } = view
  // Each size sits in the middle of its column, so the columns double as its hit areas.
  const x = (i: number) => ((i + 0.5) / memories.length) * 100
  const series = shown.map((f) => ({
    f,
    values: memories.map((mb) => {
      const at = sized.find((s) => s.base === f.base && s.memoryMb === mb)
      return at && agg(at, 'cold')
    }),
  }))
  const max = niceMax(
    Math.max(0, ...series.flatMap((s) => s.values.filter((v) => v !== undefined)))
  )
  const y = (v: number) => 100 - (v / max) * 100
  const grid = [0, 0.25, 0.5, 0.75, 1].map((g) => ({
    top: 100 - g * 100,
    label: (max * g).toFixed(0),
  }))
  // The focused line last, so it's drawn on top.
  const ordered = series.toSorted((a, b) => Number(a.f.base === focus) - Number(b.f.base === focus))
  const selected = memories.indexOf(memoryMb)

  return (
    <article className={`flex min-w-0 flex-col gap-5 bg-paper-2 p-5 sm:p-6 ${className}`}>
      <h2 className="flex items-baseline gap-2 text-xl text-ink">
        <ChartIcon name="sizes" className="size-5" />
        Cold start by memory
      </h2>
      <div className={AXES}>
        <div className={`relative ${Y_LABELS}`} style={{ height: HEIGHT }}>
          {grid.map((g) => (
            <span key={g.top} className={Y_LABEL} style={{ top: `${g.top}%` }}>
              {g.label}
            </span>
          ))}
        </div>
        <div className="relative" style={{ height: HEIGHT }}>
          <div className="absolute inset-y-0 w-px bg-cool" style={{ left: `${x(selected)}%` }} />
          <svg
            viewBox="0 0 100 100"
            preserveAspectRatio="none"
            role="img"
            aria-label="Cold start in ms at each memory size, one line per function"
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
            {ordered.map((s) => (
              <polyline
                key={s.f.base}
                fill="none"
                style={{ stroke: s.f.color }}
                strokeOpacity={!focus || focus === s.f.base ? 1 : 0.15}
                strokeWidth={focus === s.f.base ? 3 : 2}
                strokeLinejoin="round"
                strokeLinecap="round"
                vectorEffect="non-scaling-stroke"
                strokeDasharray={DASHES[s.f.family]}
                points={s.values
                  .flatMap((v, i) => (v === undefined ? [] : [`${x(i)},${y(v)}`]))
                  .join(' ')}
              />
            ))}
          </svg>
          {series
            .filter((s) => s.values[selected] !== undefined && (!focus || focus === s.f.base))
            .map((s) => (
              <div
                key={s.f.base}
                className="absolute size-2.5 -translate-1/2 rounded-full border-2 border-paper-2"
                style={{
                  left: `${x(selected)}%`,
                  top: `${y(s.values[selected]!)}%`,
                  background: s.f.color,
                }}
              />
            ))}
          <div className="absolute inset-0 flex">
            {memories.map((mb) => (
              <button
                key={mb}
                type="button"
                aria-pressed={mb === memoryMb}
                aria-label={`Show ${mb} MB`}
                onClick={() => onPick(mb)}
                className="flex-1 cursor-pointer hover:bg-rule/30 focus-visible:-outline-offset-2"
              />
            ))}
          </div>
        </div>
        <div className={X_LABELS}>
          {memories.map((mb, i) => (
            <span
              key={mb}
              className={`measured absolute -translate-x-1/2 text-xs whitespace-nowrap ${mb === memoryMb ? 'text-cool' : 'text-muted'}`}
              style={{ left: `${x(i)}%` }}
            >
              {/* Five sizes with their unit don't fit under a phone-wide chart. */}
              {mb}
              <span className="max-sm:hidden"> MB</span>
            </span>
          ))}
        </div>
      </div>
    </article>
  )
}
