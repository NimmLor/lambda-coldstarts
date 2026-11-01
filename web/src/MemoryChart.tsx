import { useState } from 'react'
import { AXES, type Metric, Readout, X_LABELS, Y_LABEL, Y_LABELS } from './Chart'
import { ChartIcon } from './ChartIcon'
import { DASHES, type Fn, niceMax, type View, when } from './data'

/**
 * Each shown variant's `metric` at every memory size it runs at, on the shown architecture: the
 * hovered run's, or the mean over the range. Clicking a size's column shows that size everywhere.
 */
export const MemoryChart = ({
  metric: m,
  wide,
  view,
  sized,
  memories,
  onPick,
  className = '',
}: {
  metric: Metric
  /** Beside a wide chart over time, with its larger title, rather than in a row of small charts. */
  wide: boolean
  view: View
  /** Every function on the shown architecture, at every memory size. */
  sized: Fn[]
  /** Ascending. */
  memories: number[]
  onPick: (memoryMb: number) => void
  className?: string
}) => {
  const { runs, hover, shown, scaled, memoryMb, focus, agg, baseline } = view
  /** Index of the size column under the pointer. */
  const [pointed, setPointed] = useState<number>()
  // Each size sits in the middle of its column, so the columns double as its hit areas.
  const x = (i: number) => ((i + 0.5) / memories.length) * 100
  const at = (base: string, mb: number) => {
    const fn = sized.find((s) => s.base === base && s.memoryMb === mb)
    return fn && agg(fn, m.key)
  }
  const series = shown.map((f) => ({ f, values: memories.map((mb) => at(f.base, mb)) }))
  // On both architectures, so the axis holds still when the other is shown.
  const max = niceMax(Math.max(0, ...scaled.map((f) => agg(f, m.key) ?? 0)))
  const y = (v: number) => 100 - (v / max) * 100
  const grid = [0, 0.25, 0.5, 0.75, 1].map((g) => ({
    top: 100 - g * 100,
    label: (max * g).toFixed(max < 5 ? 1 : 0),
  }))
  const height = m.height
  // The focused line last, so it's drawn on top.
  const ordered = series.toSorted((a, b) => Number(a.f.base === focus) - Number(b.f.base === focus))
  const selected = memories.indexOf(memoryMb)

  return (
    <article className={`flex min-w-0 flex-col gap-5 bg-paper-2 p-5 sm:p-6 ${className}`}>
      {/* The caption on a line of its own: a hovered run's is too long to share the title's, and
          wrapping only then would move the chart on every hover. */}
      <div className="flex flex-col gap-1 text-sm text-muted">
        <h2 className={`flex items-baseline gap-2 text-ink ${wide ? 'text-xl' : 'text-lg'}`}>
          <ChartIcon name="sizes" className={wide ? 'size-5' : 'size-[1.125rem]'} />
          {m.title} by memory
        </h2>
        <p>
          {m.unit}, {hover !== undefined ? `run of ${when(runs[hover]!.date)} UTC` : 'mean'}
        </p>
      </div>
      {/* At the bottom, so its sizes line up with the dates under the small charts beside it. */}
      <div className={`${AXES} ${wide ? '' : 'mt-auto'}`}>
        <div className={`relative ${Y_LABELS}`} style={{ height }}>
          {grid.map((g) => (
            <span key={g.top} className={Y_LABEL} style={{ top: `${g.top}%` }}>
              {g.label}
            </span>
          ))}
        </div>
        <div className="relative" style={{ height }}>
          <div className="absolute inset-y-0 w-px bg-cool" style={{ left: `${x(selected)}%` }} />
          <svg
            viewBox="0 0 100 100"
            preserveAspectRatio="none"
            role="img"
            aria-label={`${m.title} in ${m.unit} at each memory size, one line per function`}
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
          {pointed !== undefined && (
            <Readout
              left={x(pointed)}
              title={`${memories[pointed]} MB, ${hover !== undefined ? `${when(runs[hover]!.date)} UTC` : 'mean'}`}
              rows={series.map((s) => ({ f: s.f, value: s.values[pointed] }))}
              unit={m.unit}
              digits={m.digits}
              focus={focus}
              // A Web Function has one size, which every size is compared with.
              baseline={
                baseline &&
                (baseline.web ? agg(baseline, m.key) : at(baseline.base, memories[pointed]!))
              }
            />
          )}
          {series
            .filter((s) => s.values[selected] !== undefined && (!focus || focus === s.f.base))
            .map((s) => (
              <div
                key={s.f.base}
                className="mark absolute size-2.5 -translate-1/2 rounded-full border-2 border-paper-2"
                style={{
                  left: `${x(selected)}%`,
                  top: `${y(s.values[selected]!)}%`,
                  background: s.f.color,
                }}
              />
            ))}
          <div className="absolute inset-0 flex" onMouseLeave={() => setPointed(undefined)}>
            {memories.map((mb, i) => (
              <button
                key={mb}
                type="button"
                aria-pressed={mb === memoryMb}
                aria-label={`Show ${mb} MB`}
                onClick={() => onPick(mb)}
                onMouseEnter={() => setPointed(i)}
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
              {/* Five sizes with their unit don't fit under a phone-wide chart, or a third-wide one. */}
              {mb}
              <span className={wide ? 'max-sm:hidden' : 'max-sm:hidden md:max-lg:hidden'}> MB</span>
            </span>
          ))}
        </div>
      </div>
    </article>
  )
}
