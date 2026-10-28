import { niceMax, type Stat, type View, day } from './data'

export type Metric = { key: Stat; title: string; unit: string; height: number; leader: string }

/** About `segments` + 1 dates under the chart, always including the last. */
const dateTicks = (n: number, segments: number) => {
  const step = Math.max(1, Math.round((n - 1) / segments))
  const ticks: number[] = []
  for (let i = 0; i < n; i += step) ticks.push(i)
  if (ticks.at(-1) !== n - 1) {
    if (n - 1 - ticks.at(-1)! < step / 2) ticks.pop()
    ticks.push(n - 1)
  }
  return ticks
}

/** One line per shown function, one point per run in range. */
export const Chart = ({
  metric: m,
  wide,
  view,
  className = '',
}: {
  metric: Metric
  wide: boolean
  view: View
  className?: string
}) => {
  const { runs, memoryMb, shown, hover, focus, agg } = view
  const n = runs.length
  const x = (i: number) => (n <= 1 ? 50 : (i / (n - 1)) * 100)
  const series = shown.map((f) => ({ f, values: runs.map((r) => r.points.get(f.id)?.[m.key]) }))
  const max = niceMax(
    Math.max(0, ...series.flatMap((s) => s.values.filter((v) => v !== undefined)))
  )
  const y = (v: number) => 100 - (v / max) * 100
  const grid = [0, 0.25, 0.5, 0.75, 1].map((g) => ({
    top: 100 - g * 100,
    label: (max * g).toFixed(max < 5 ? 1 : 0),
  }))
  // The focused line last, so it's drawn on top.
  const ordered = series.toSorted((a, b) => Number(a.f.base === focus) - Number(b.f.base === focus))
  const best = shown
    .filter((f) => agg(f, m.key) !== undefined)
    .sort((a, b) => agg(a, m.key)! - agg(b, m.key)!)[0]
  // Three dates fit under a narrow chart without touching.
  const ticks = dateTicks(n, wide ? 4 : 2)

  return (
    <article className={`flex min-w-0 flex-col gap-5 bg-paper-2 p-5 sm:p-6 ${className}`}>
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 text-sm text-muted">
        <div className="flex flex-wrap items-baseline gap-x-3">
          <h2 className={`text-ink ${wide ? 'text-xl' : 'text-lg'}`}>{m.title}</h2>
          {m.unit}, mean per run at {memoryMb} MB
        </div>
        {best && (
          <span className="inline-flex items-center gap-2">
            {m.leader}
            <span
              aria-hidden="true"
              className="size-2.5 shrink-0 rounded-full"
              style={{ background: best.color }}
            />
            <span className="font-medium text-ink">{best.name}</span>
          </span>
        )}
      </div>
      <div className="grid grid-cols-[2.75rem_minmax(0,1fr)] gap-x-2">
        <div className="relative" style={{ height: m.height }}>
          {grid.map((g) => (
            <span
              key={g.top}
              className="measured absolute right-0 -translate-y-1/2 text-xs text-muted"
              style={{ top: `${g.top}%` }}
            >
              {g.label}
            </span>
          ))}
        </div>
        <div className="relative" style={{ height: m.height }}>
          <svg
            viewBox="0 0 100 100"
            preserveAspectRatio="none"
            role="img"
            aria-label={`${m.title} in ${m.unit}, one line per function`}
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
                key={s.f.id}
                fill="none"
                style={{ stroke: s.f.color }}
                strokeOpacity={!focus || focus === s.f.base ? 1 : 0.15}
                strokeWidth={focus === s.f.base ? 3 : 2}
                strokeLinejoin="round"
                strokeLinecap="round"
                vectorEffect="non-scaling-stroke"
                strokeDasharray={s.f.family === 'Node' ? '5 4' : undefined}
                points={s.values
                  .flatMap((v, i) => (v === undefined ? [] : [`${x(i)},${y(v)}`]))
                  .join(' ')}
              />
            ))}
          </svg>
          {hover !== undefined && (
            <>
              <div className="absolute inset-y-0 w-px bg-rule-2" style={{ left: `${x(hover)}%` }} />
              {series
                .filter((s) => s.values[hover] !== undefined && (!focus || focus === s.f.base))
                .map((s) => (
                  <div
                    key={s.f.id}
                    className="absolute size-2.5 -translate-1/2 rounded-full border-2 border-paper-2"
                    style={{
                      left: `${x(hover)}%`,
                      top: `${y(s.values[hover]!)}%`,
                      background: s.f.color,
                    }}
                  />
                ))}
            </>
          )}
          <div className="absolute inset-0 flex">
            {runs.map((r, i) => (
              <div key={r.finishedAt} className="flex-1" onMouseEnter={() => view.setHover(i)} />
            ))}
          </div>
        </div>
        <div className="relative col-start-2 mt-2 h-5">
          {ticks.map((i, k) => (
            <span
              key={i}
              className={`measured absolute text-xs whitespace-nowrap text-muted ${
                ticks.length === 1 || (k > 0 && k < ticks.length - 1)
                  ? '-translate-x-1/2'
                  : k === 0
                    ? ''
                    : '-translate-x-full'
              }`}
              style={{ left: `${x(i)}%` }}
            >
              {day(runs[i]!.date)}
            </span>
          ))}
        </div>
      </div>
    </article>
  )
}
