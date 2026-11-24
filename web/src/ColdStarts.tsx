import { useState } from 'react'
import { track } from './analytics'
import { Chart, type Metric, Y_LABEL } from './Chart'
import {
  buildChanges,
  day,
  FAMILY_NAMES,
  type Figures,
  type Fn,
  isEvent,
  niceMax,
  type RunPoints,
  shortName,
  versionName,
} from './data'
import type { TabProps } from './tabs'
import { Badges, Card, Figure, FnLabel, Reading, Swatch, TabHead, Waiting } from './ui'

/** What a cold call waits for, in the order it happens. */
const SEGMENTS = [
  { key: 'cold', name: 'Init', color: 'var(--color-icon-cold)' },
  { key: 'dur', name: 'First invocation', color: 'var(--color-icon-warm)' },
  { key: 'load', name: 'Loading & API', color: 'var(--color-rule-2)' },
] as const

const TREND: Metric = {
  key: 'cold',
  digits: 1,
  title: 'Init over time',
  unit: 'ms',
  height: 260,
  leader: 'Fastest',
  icon: 'cold',
}

type Rank = 'trip' | 'cold'
const RANKS: [Rank, string][] = [
  ['trip', 'First answer'],
  ['cold', 'Init'],
]

type Row = { f: Fn; x: Figures }

/** The figures of `fns` that have `key`. */
const withFigure = (fns: Fn[], figures: Map<string, Figures>, key: keyof Figures): Row[] =>
  fns.flatMap((f) => {
    const x = figures.get(f.id)
    return x?.[key] !== undefined ? [{ f, x }] : []
  })

/** Each function's cold call as init, first invocation and the rest of its first answer. */
const Waits = ({ fns, figures }: { fns: Fn[]; figures: Map<string, Figures> }) => {
  const [rank, setRank] = useState<Rank>('trip')
  const rows = withFigure(fns, figures, 'cold').sort(
    (a, b) => (a.x[rank] ?? Infinity) - (b.x[rank] ?? Infinity)
  )
  const max = niceMax(Math.max(0, ...rows.map((r) => r.x.trip ?? r.x.cold! + (r.x.dur ?? 0))))
  return (
    <Card
      id="waits"
      title="What a cold call waits for"
      caption="From calling Invoke on a cold function until its answer arrives."
      aside={
        <div className="flex shrink-0 items-center gap-2.5">
          <span className="text-xs font-medium text-muted">Rank by</span>
          <div className="cells" role="group" aria-label="Rank by">
            {RANKS.map(([key, label]) => (
              <button
                key={key}
                type="button"
                aria-pressed={rank === key}
                onClick={() => {
                  track('cold_ranked', { by: key })
                  setRank(key)
                }}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
      }
    >
      <div className="flex flex-wrap gap-x-5 gap-y-1.5">
        {SEGMENTS.map((s) => (
          <Swatch key={s.key} color={s.color}>
            {s.name}
          </Swatch>
        ))}
      </div>
      <ol className="m-0 flex list-none flex-col p-0">
        {rows.map(({ f, x }) => {
          const widths = SEGMENTS.map((s) => Math.max(0, x[s.key] ?? 0) / max)
          return (
            <li
              key={f.id}
              className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-1.5 border-t border-rule py-2.5 sm:grid-cols-[minmax(0,15rem)_minmax(0,1fr)_7.5rem] lg:grid-cols-[minmax(0,19rem)_minmax(0,1fr)_7.5rem]"
            >
              <span className="flex min-w-0 items-center gap-2 text-sm">
                <FnLabel f={f} />
                <Badges f={f} />
              </span>
              <span
                aria-hidden="true"
                className="col-span-full row-start-2 flex h-3.5 overflow-hidden rounded-[3px] bg-paper-3 sm:col-span-1 sm:col-start-2 sm:row-start-1"
              >
                {SEGMENTS.map((s, i) => (
                  <span
                    key={s.key}
                    className="mark h-full"
                    style={{ width: `${widths[i]! * 100}%`, background: s.color }}
                  />
                ))}
              </span>
              <span className="col-start-2 row-start-1 flex flex-col items-end leading-tight sm:col-start-3">
                <Reading
                  value={rank === 'trip' ? x.trip : x.cold}
                  digits={rank === 'trip' ? 0 : 1}
                  unit="ms"
                  className="text-md text-ink"
                />
                <span className="measured text-xs text-muted">
                  {rank === 'trip'
                    ? `init ${x.cold!.toFixed(1)}`
                    : x.trip !== undefined
                      ? `answer ${x.trip.toFixed(0)}`
                      : ''}
                </span>
              </span>
            </li>
          )
        })}
      </ol>
    </Card>
  )
}

/** Every cold start of each function: p50 to p90 a box, the fastest to the slowest 1% a whisker. */
const Spread = ({ fns, figures }: { fns: Fn[]; figures: Map<string, Figures> }) => {
  const rows = withFigure(fns, figures, 'p50').sort((a, b) => a.x.p50! - b.x.p50!)
  const max = niceMax(Math.max(0, ...rows.map((r) => r.x.p99!)))
  const at = (v: number) => `${(v / max) * 100}%`
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((g) => g * max)
  return (
    <Card
      id="spread"
      title="Every cold start"
      caption="Init of every cold start in view: a box from p50 to p90, a whisker from the fastest to the slowest 1%."
    >
      <div className="grid grid-cols-[minmax(0,9rem)_minmax(0,1fr)] gap-x-3 sm:grid-cols-[minmax(0,11rem)_minmax(0,1fr)]">
        <span />
        <span aria-hidden="true" className="relative h-4">
          {ticks.map((t, i) => (
            <span
              key={t}
              className={`measured absolute text-xs text-muted ${i === 0 ? '' : i === ticks.length - 1 ? '-translate-x-full' : '-translate-x-1/2'}`}
              style={{ left: at(t) }}
            >
              {t.toFixed(0)}
            </span>
          ))}
        </span>
      </div>
      <ol className="m-0 flex list-none flex-col gap-1 p-0">
        {rows.map(({ f, x }) => (
          <li
            key={f.id}
            className="grid grid-cols-[minmax(0,9rem)_minmax(0,1fr)] items-center gap-x-3 sm:grid-cols-[minmax(0,11rem)_minmax(0,1fr)]"
          >
            <span className="flex min-w-0 flex-col leading-tight">
              <span className="truncate text-sm text-ink" title={f.about}>
                {f.name}
              </span>
              <span className="measured text-xs text-muted">
                {x.p50!.toFixed(0)} · {x.p90!.toFixed(0)} · {x.p99!.toFixed(0)}
              </span>
            </span>
            <span
              aria-hidden="true"
              className="relative h-5"
              style={{
                background: `repeating-linear-gradient(90deg, var(--color-rule) 0 1px, transparent 1px ${100 / 4}%)`,
              }}
            >
              <span
                className="mark absolute top-[9px] h-0.5 bg-muted"
                style={{ left: at(x.min!), width: at(x.p99! - x.min!) }}
              />
              <span
                className="mark absolute top-1 h-3 rounded-[2px]"
                style={{
                  left: at(x.p50!),
                  width: `max(3px, ${at(x.p90! - x.p50!)})`,
                  background: f.color,
                }}
              />
              <span
                className="mark absolute top-0.5 h-4 w-0.5 bg-ink"
                style={{ left: at(x.p50!) }}
              />
            </span>
          </li>
        ))}
      </ol>
    </Card>
  )
}

/** The least-squares line through `points`: its slope and where it crosses 0. */
const fit = (points: { x: number; y: number }[]) => {
  const n = points.length
  const mx = points.reduce((s, p) => s + p.x, 0) / n
  const my = points.reduce((s, p) => s + p.y, 0) / n
  const sxx = points.reduce((s, p) => s + (p.x - mx) ** 2, 0)
  const slope = sxx ? points.reduce((s, p) => s + (p.x - mx) * (p.y - my), 0) / sxx : 0
  return { slope, intercept: my - slope * mx }
}

/** How much more a first answer waits outside init and the first call as the package grows. */
const Package = ({ fns, figures }: { fns: Fn[]; figures: Map<string, Figures> }) => {
  const rows = withFigure(fns, figures, 'load')
  if (rows.length < 3) return null
  const xmax = niceMax(Math.max(...rows.map((r) => r.x.size)))
  const ymax = niceMax(Math.max(...rows.map((r) => r.x.load!)))
  // From a little below 0 MB, so the KB-sized Node.js points clear the axis labels.
  const from = -xmax * 0.08
  const px = (size: number) => ((size - from) / (xmax - from)) * 100
  const py = (load: number) => 100 - (load / ymax) * 100
  const { slope, intercept } = fit(rows.map((r) => ({ x: r.x.size, y: r.x.load! })))
  const end = slope > 0 ? Math.min(xmax, (ymax - intercept) / slope) : xmax
  // Points of a family that would overlap share a label: the family's name, or their builds'.
  const clusters: Row[][] = []
  for (const r of rows.toSorted((a, b) => a.x.size - b.x.size || a.x.load! - b.x.load!)) {
    const near = clusters.find(
      (c) =>
        c[0]!.f.family === r.f.family &&
        Math.abs(px(c[0]!.x.size) - px(r.x.size)) < 6 &&
        Math.abs(py(c[0]!.x.load!) - py(r.x.load!)) < 10
    )
    if (near) near.push(r)
    else clusters.push([r])
  }
  const labelOf = (c: Row[]) => {
    const family = c[0]!.f.family
    if (c.length > 1 && family !== 'Bun') return FAMILY_NAMES[family]
    return `${FAMILY_NAMES[family]} ${c.map((r) => shortName(r.f.base)).join(', ')}`
  }
  // Each label beside its cluster's middle, stepped down past any label it would cover. Widths
  // are guessed from the text, in percent of a plot about 560 px wide.
  const placed: { top: number; from: number; to: number }[] = []
  const labels = clusters
    .map((c) => ({
      c,
      text: labelOf(c),
      left: px(c[0]!.x.size),
      top: c.reduce((sum, r) => sum + py(r.x.load!), 0) / c.length,
    }))
    .sort((a, b) => a.top - b.top)
    .map((l) => {
      const width = l.text.length * 1.2 + 2
      const from = l.left > 60 ? l.left - width : l.left
      const to = from + width
      let top = l.top
      while (placed.some((p) => Math.abs(p.top - top) < 6 && p.from < to && from < p.to)) top += 6
      placed.push({ top, from, to })
      return { ...l, top }
    })
  return (
    <Card
      id="package"
      title="Loading & API grows with the package"
      caption={
        <>
          Each function’s loading & API time against the size of its deployed code. The dashed fit:
          about <Figure>{slope.toFixed(1)} ms</Figure> more per MB.
        </>
      }
    >
      <div
        className="relative h-72 border-b border-rule-2"
        role="img"
        aria-label={`Loading and API time against package size for ${rows.length} functions: about ${slope.toFixed(1)} ms more per MB`}
        style={{
          background: `repeating-linear-gradient(0deg, var(--color-rule) 0 1px, transparent 1px 25%)`,
        }}
      >
        <svg
          aria-hidden="true"
          viewBox="0 0 100 100"
          preserveAspectRatio="none"
          className="absolute inset-0 size-full overflow-visible"
        >
          <line
            x1={px(0)}
            y1={py(intercept)}
            x2={px(end)}
            y2={py(intercept + slope * end)}
            className="stroke-muted"
            strokeWidth={1.5}
            strokeDasharray="5 5"
            vectorEffect="non-scaling-stroke"
          />
        </svg>
        {rows.map(({ f, x }) => (
          <span
            key={f.id}
            title={`${f.name}: ${x.size.toFixed(1)} MB, ${x.load!.toFixed(0)} ms`}
            className="mark absolute size-3 -translate-1/2 rounded-full border-2 border-paper-2"
            style={{ left: `${px(x.size)}%`, top: `${py(x.load!)}%`, background: f.color }}
          />
        ))}
        {labels.map((l) => (
          <span
            key={l.c[0]!.f.id}
            aria-hidden="true"
            className={`absolute -translate-y-1/2 text-xs whitespace-nowrap text-ink-2 ${l.left > 60 ? '-translate-x-full pr-3' : 'pl-3'}`}
            style={{ left: `${l.left}%`, top: `${l.top}%` }}
          >
            {l.text}
          </span>
        ))}
        <div aria-hidden="true" className="pointer-events-none absolute inset-0">
          {[0.25, 0.5, 0.75, 1].map((g) => (
            <span key={g} className={Y_LABEL} style={{ top: `${100 - g * 100}%` }}>
              {(ymax * g).toFixed(0)}
              {g === 1 && ' ms'}
            </span>
          ))}
        </div>
      </div>
      <div aria-hidden="true" className="relative -mt-2 h-5">
        {[0, 0.25, 0.5, 0.75, 1].map((g) => (
          <span
            key={g}
            className={`measured absolute text-xs whitespace-nowrap text-muted ${g === 1 ? '-translate-x-full' : '-translate-x-1/2'}`}
            style={{ left: `${px(xmax * g)}%` }}
          >
            {(xmax * g).toFixed(0)} MB
          </span>
        ))}
      </div>
    </Card>
  )
}

/**
 * The runs where a shown function changed build, each a marker with the new versions; changes a few
 * runs apart share one, so their labels don't collide.
 */
const markersOf = (runs: RunPoints[], fns: Fn[]) => {
  const changes = buildChanges(runs, fns).sort((a, b) => a.index - b.index)
  const near = Math.max(2, Math.round(runs.length * 0.06))
  const groups: (typeof changes)[] = []
  for (const c of changes) {
    const last = groups.at(-1)
    if (last && c.index - last[0]!.index <= near) last.push(c)
    else groups.push([c])
  }
  return groups.map((g) => ({
    index: g[0]!.index,
    label: `${day(runs[g[0]!.index]!.date)} · ${[...new Set(g.map((c) => versionName(c.to)))].join(', ')}`,
  }))
}

export const ColdStarts = ({ view, figures, memoryMb, waiting }: TabProps) => {
  const fns = view.shown.filter(isEvent)
  const days = Math.round(
    (view.latest.date.getTime() - (view.runs[0]?.date.getTime() ?? 0)) / 864e5
  )
  return (
    <div className="flex flex-col gap-8">
      <TabHead title="Cold starts" />
      <Waits fns={fns} figures={figures} />
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Spread fns={fns} figures={figures} />
        <Package fns={fns} figures={figures} />
      </div>
      {waiting ? (
        <Waiting height={360}>Loading the last 15 days of runs…</Waiting>
      ) : (
        <div
          className="overflow-hidden rounded-card border border-rule"
          onMouseLeave={() => view.setHover(undefined)}
        >
          <Chart
            metric={TREND}
            wide
            view={{ ...view, shown: fns, scaled: view.scaled.filter(isEvent) }}
            markers={markersOf(view.runs, fns)}
            caption={`ms, mean per run at ${memoryMb} MB over ${days} days; a marker where a build changed`}
          />
        </div>
      )}
    </div>
  )
}
