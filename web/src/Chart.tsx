import { type ReactNode, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { ChartIcon, type ChartIconName } from './ChartIcon'
import { DASHES, type Fn, fixed, niceMax, type Stat, type View, day, when } from './data'

export type Metric = {
  key: Stat
  /** Decimals in the readout, as the table shows them. */
  digits: number
  title: string
  unit: string
  height: number
  leader: string
  icon: ChartIconName
}

/**
 * The value labels in a column left of the plot; on a phone they sit inside it, over their
 * gridlines, so the plot takes the card's width and lines up under its heading.
 */
export const AXES = 'relative grid grid-cols-1 sm:grid-cols-[2.75rem_minmax(0,1fr)] sm:gap-x-2'
export const Y_LABELS = 'max-sm:pointer-events-none max-sm:absolute max-sm:inset-x-0 max-sm:z-1'
export const Y_LABEL =
  'measured absolute text-xs text-muted max-sm:left-0 max-sm:-translate-y-full max-sm:rounded-chip max-sm:bg-paper-2/85 max-sm:pr-1 sm:right-0 sm:-translate-y-1/2'
export const X_LABELS = 'relative mt-2 h-5 sm:col-start-2'

/** Between the readout and the card or crosshair it's placed by, and the viewport's edges. */
const READOUT_GAP = 12

/**
 * How many times lower `value` is than the baseline's, so 2.00× is twice as fast: greener above 1,
 * redder below, fully saturated from twice either way.
 */
export const Versus = ({ value, baseline }: { value?: number; baseline?: number }) => {
  if (value === undefined || baseline === undefined || !(value > 0) || !(baseline > 0)) return null
  const times = baseline / value
  return (
    <span className="measured rounded-chip px-1 text-xs" style={tone(times)}>
      {times.toFixed(2)}×
    </span>
  )
}

/**
 * The colours of a chip for `times`: green above 1, red below, fully saturated from twice either
 * way. The root lifts small differences off the neutral grey; oklab, as oklch would pass through
 * other hues on the way.
 */
export const tone = (times: number) => {
  const name = times >= 1 ? 'ok' : 'bad'
  const strength = Math.sqrt(Math.min(1, Math.abs(Math.log2(times)))) * 100
  return {
    color: `color-mix(in oklab, var(--color-${name}) ${strength}%, var(--color-muted))`,
    background: `color-mix(in oklab, var(--color-${name}-soft) ${strength}%, transparent)`,
  }
}

/**
 * A tooltip below the chart's card under the crosshair at `left`% of the plot, so it covers none of
 * the chart. Above the card when the viewport has no room below, else beside the crosshair: right
 * of it if it fits, else left, else as near it as the plot allows. In a portal, as the card grid
 * clips its cells to round its corners.
 */
export const Floating = ({ left, children }: { left: number; children: ReactNode }) => {
  /** Stays in the plot, which the readout is placed by from the portal. */
  const anchor = useRef<HTMLSpanElement>(null)
  const ref = useRef<HTMLDivElement>(null)
  // Its size changes with every run, so it's placed after every render, before paint.
  useLayoutEffect(() => {
    const el = ref.current!
    const plot = anchor.current!.parentElement!.getBoundingClientRect()
    const card = anchor.current!.closest('article')!.getBoundingClientRect()
    const viewport = document.documentElement
    const width = el.offsetWidth
    const height = el.offsetHeight
    const at = plot.left + (left / 100) * plot.width
    /** `start` moved as little as keeps `size` from it inside `from`..`to`. */
    const clamp = (start: number, size: number, from: number, to: number) =>
      Math.max(from, Math.min(to - size, start))
    const below = card.bottom + READOUT_GAP
    const above = card.top - READOUT_GAP - height
    let x = clamp(at - width / 2, width, READOUT_GAP, viewport.clientWidth - READOUT_GAP)
    let y: number
    if (below + height <= viewport.clientHeight - READOUT_GAP) y = below
    else if (above >= READOUT_GAP) y = above
    else {
      x =
        at + READOUT_GAP + width <= plot.right
          ? at + READOUT_GAP
          : at - READOUT_GAP - width >= plot.left
            ? at - READOUT_GAP - width
            : clamp(at - width / 2, width, plot.left, plot.right)
      y = clamp(
        plot.top + (plot.height - height) / 2,
        height,
        READOUT_GAP,
        viewport.clientHeight - READOUT_GAP
      )
    }
    el.style.left = `${x + window.scrollX}px`
    el.style.top = `${y + window.scrollY}px`
  })

  return (
    <>
      <span ref={anchor} hidden />
      {createPortal(
        <div
          ref={ref}
          role="tooltip"
          className="pointer-events-none absolute z-(--z-tooltip) flex flex-col gap-1 rounded-pill border border-rule-2 bg-paper px-3 py-2 text-xs whitespace-nowrap shadow-[0_8px_24px_oklch(0%_0_0/0.45)]"
        >
          {children}
        </div>,
        document.body
      )}
    </>
  )
}

/** The values under the pointer, lowest first, in a `Floating` tooltip. */
export const Readout = ({
  left,
  title,
  rows,
  unit,
  digits,
  focus,
  baseline,
}: {
  left: number
  title: string
  rows: { f: Fn; value: number | undefined }[]
  unit: string
  digits: number
  focus?: string
  /** The compared function's value, which each row's badge is against. */
  baseline?: number
}) => (
  <Floating left={left}>
    <span className="measured text-muted">{title}</span>
    {rows
      .filter((r) => r.value !== undefined)
      .sort((a, b) => a.value! - b.value!)
      .map(({ f, value }) => (
        <span
          key={f.id}
          className={`flex items-center gap-2 ${focus && focus !== f.base ? 'opacity-40' : ''}`}
        >
          <span
            aria-hidden="true"
            className="size-2 shrink-0 rounded-full"
            style={{ background: f.color }}
          />
          <span className={focus === f.base ? 'font-medium text-ink' : 'text-ink-2'}>{f.name}</span>
          <span className="measured ml-auto pl-4 text-ink">
            {fixed(value, digits)}{' '}
            {/* A phone-wide plot has room for the badge or the unit, and the chart's heading already names it. */}
            <span className={`text-muted ${baseline !== undefined ? 'max-sm:hidden' : ''}`}>
              {unit}
            </span>
          </span>
          {baseline !== undefined && (
            <span className="w-12 text-right">
              <Versus value={value} baseline={baseline} />
            </span>
          )}
        </span>
      ))}
  </Floating>
)

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
  caption,
  className = '',
}: {
  metric: Metric
  wide: boolean
  view: View
  /** What the values are, beside the title; by default the unit and the memory size. */
  caption?: string
  className?: string
}) => {
  const { runs, memoryMb, shown, scaled, hover, focus, agg, baseline } = view
  // Every chart follows the hovered run; only the one under the pointer reads it out.
  const [inside, setInside] = useState(false)
  const n = runs.length
  const x = (i: number) => (n <= 1 ? 50 : (i / (n - 1)) * 100)
  const series = shown.map((f) => ({ f, values: runs.map((r) => r.points.get(f.id)?.[m.key]) }))
  const max = niceMax(
    Math.max(0, ...runs.flatMap((r) => scaled.flatMap((f) => r.points.get(f.id)?.[m.key] ?? [])))
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
  // Three dates fit under a narrow chart without touching; a date shows once, however many runs fall on it.
  const ticks = dateTicks(n, wide ? 4 : 2).filter(
    (i, k, all) => k === 0 || day(runs[i]!.date) !== day(runs[all[k - 1]!]!.date)
  )

  return (
    <article className={`flex min-w-0 flex-col gap-5 bg-paper-2 p-5 sm:p-6 ${className}`}>
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 text-sm text-muted">
        <div className="flex flex-wrap items-baseline gap-x-3">
          <h2 className={`flex items-baseline gap-2 text-ink ${wide ? 'text-xl' : 'text-lg'}`}>
            <ChartIcon name={m.icon} className={wide ? 'size-5' : 'size-[1.125rem]'} />
            {m.title}
          </h2>
          {caption ?? `${m.unit}, mean per run at ${memoryMb} MB`}
        </div>
        {best && (
          <span className="inline-flex items-center gap-2">
            {m.leader}
            <span
              aria-hidden="true"
              className="mark size-2.5 shrink-0 rounded-full"
              style={{ background: best.color }}
            />
            <span className="datum font-medium text-ink">{best.name}</span>
            {baseline && baseline.base !== best.base && (
              <Versus value={agg(best, m.key)} baseline={agg(baseline, m.key)} />
            )}
          </span>
        )}
      </div>
      <div className={AXES}>
        <div className={`relative ${Y_LABELS}`} style={{ height: m.height }}>
          {grid.map((g) => (
            <span key={g.top} className={Y_LABEL} style={{ top: `${g.top}%` }}>
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
                strokeDasharray={DASHES[s.f.family]}
                points={s.values
                  .flatMap((v, i) => (v === undefined ? [] : [`${x(i)},${y(v)}`]))
                  .join(' ')}
              />
            ))}
          </svg>
          {/* A run with no run beside it to draw a line to, such as a function's first, is a dot. */}
          {ordered.flatMap((s) =>
            s.values.flatMap((v, i) =>
              v === undefined ||
              s.values[i - 1] !== undefined ||
              s.values[i + 1] !== undefined ||
              i === hover
                ? []
                : [
                    <div
                      key={`${s.f.id}:${i}`}
                      className="mark absolute size-1.5 -translate-1/2 rounded-full"
                      style={{
                        left: `${x(i)}%`,
                        top: `${y(v)}%`,
                        background: s.f.color,
                        opacity: !focus || focus === s.f.base ? 1 : 0.15,
                      }}
                    />,
                  ]
            )
          )}
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
              {/* Nothing to read out at a run before any shown function was measured. */}
              {inside && series.some((s) => s.values[hover] !== undefined) && (
                <Readout
                  left={x(hover)}
                  title={`${when(runs[hover]!.date)} UTC`}
                  rows={series.map((s) => ({ f: s.f, value: s.values[hover] }))}
                  unit={m.unit}
                  digits={m.digits}
                  focus={focus}
                  baseline={baseline && runs[hover]!.points.get(baseline.id)?.[m.key]}
                />
              )}
            </>
          )}
          <div
            className="absolute inset-0 flex"
            onMouseEnter={() => setInside(true)}
            onMouseLeave={() => setInside(false)}
          >
            {runs.map((r, i) => (
              <div key={r.finishedAt} className="flex-1" onMouseEnter={() => view.setHover(i)} />
            ))}
          </div>
        </div>
        <div className={X_LABELS}>
          {ticks.map((i, k) => (
            <span
              key={i}
              className={`measured absolute text-xs whitespace-nowrap text-muted ${
                n === 1 || (k > 0 && k < ticks.length - 1)
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
