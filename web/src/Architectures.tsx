import { useState } from 'react'
import { Floating, Versus, X_LABELS } from './Chart'
import { ChartIcon, type ChartIconName } from './ChartIcon'
import {
  ARCH_DASHES,
  ARCHS,
  type Arch,
  coldStartCost,
  type Fn,
  fixed,
  PRICES,
  STACK_REGION,
  type View,
  when,
} from './data'
import { WRAP } from './layout'

/** The id of the section, which the glance at the top links to. */
export const ARCH_SECTION = 'arm64-vs-x86_64'

/** One shown variant on both architectures: its function at each memory size, if it has one. */
type Pair = {
  base: string
  name: string
  color: string
  fns: Record<Arch, (Fn | undefined)[]>
}

/** How many times as fast arm64 is, over the pairs with both values, averaged geometrically. */
const geomean = (ratios: number[]) =>
  ratios.length
    ? Math.exp(ratios.reduce((sum, r) => sum + Math.log(r), 0) / ratios.length)
    : undefined

/** A solid or dotted line sample, for the legend and the readout's headings. */
const Swatch = ({ arch, className = 'stroke-ink-2' }: { arch: Arch; className?: string }) => (
  <svg aria-hidden="true" width="24" height="4" className={`shrink-0 ${className}`}>
    <line
      x1="1"
      x2="23"
      y1="2"
      y2="2"
      strokeWidth="2"
      strokeLinecap="round"
      strokeDasharray={ARCH_DASHES[arch]}
    />
  </svg>
)

/**
 * What the section compares, each lower-is-better, so x86_64's value over arm64's is how many
 * times as fast, or as cheap, arm64 is.
 */
type Metric = {
  key: 'cold' | 'trip' | 'warm' | 'cost'
  title: string
  icon: ChartIconName
  value: (f: Fn) => number | undefined
}

const metricsOf = (agg: View['agg']): Metric[] => [
  { key: 'cold', title: 'Cold start', icon: 'cold', value: (f) => agg(f, 'cold') },
  { key: 'trip', title: 'First answer', icon: 'trip', value: (f) => agg(f, 'trip') },
  { key: 'warm', title: 'Warm start', icon: 'warm', value: (f) => agg(f, 'warm') },
  {
    key: 'cost',
    title: 'Cost per cold start',
    icon: 'cost',
    value: (f) => coldStartCost(f, agg(f, 'cold'), agg(f, 'dur')),
  },
]

/**
 * The groups the advantage panels average, in the page's family order: each family in the hue
 * its variants share on the page, told apart by colour alone, and every Event Function together,
 * thick and neutral on top.
 */
type Group = { name: string; color: string; width: number; has: (f: Fn) => boolean }
const GROUPS: Group[] = [
  {
    name: 'Bun',
    color: 'var(--color-line-BunCompileAotTrim)',
    width: 2,
    has: (f) => f.family === 'Bun',
  },
  { name: 'LLRT', color: 'var(--color-line-Llrt)', width: 2, has: (f) => f.family === 'LLRT' },
  {
    name: 'Node.js',
    color: 'var(--color-line-Node24)',
    width: 2,
    has: (f) => f.family === 'Node',
  },
  { name: 'All', color: 'var(--color-ink-2)', width: 3, has: () => true },
]

/** A group's advantage at each memory size. */
type Series = { group: Group; values: (number | undefined)[] }

/**
 * Each group's advantage in `metric` at each memory size: the geometric mean, over its variants
 * with a value on both architectures at that size, of x86_64's value over arm64's. Web Functions
 * and MicroVMs, which run on arm64 only, are left out; the Functions filter doesn't apply.
 */
const advantage = (functions: Fn[], memories: number[], metric: Metric): Series[] => {
  const events = functions.filter((f) => !f.web && !f.microvm)
  const byId = new Map(events.map((f) => [f.id, f]))
  /** One function per variant, for its family, which every size and architecture shares. */
  const variants = [...new Map(events.map((f) => [f.base, f])).values()]
  const ratio = (base: string, mb: number) => {
    const arm = byId.get(`${base}/arm64/${mb}`)
    const x86 = byId.get(`${base}/x86_64/${mb}`)
    const a = arm && metric.value(arm)
    const b = x86 && metric.value(x86)
    return a && b ? b / a : undefined
  }
  return GROUPS.map((group) => ({
    group,
    values: memories.map((mb) =>
      geomean(variants.filter(group.has).flatMap((v) => ratio(v.base, mb) ?? []))
    ),
  })).filter((s) => s.values.some((v) => v !== undefined))
}

/** Advantages a gridline may sit at, above 1×; below it, their reciprocals. */
const RATIO_TICKS = [1.25, 1.5, 2, 3, 4, 5, 10, 20, 50, 100]
/** Rounded up to, for the axis's extent. */
const NICE_RATIOS = [1.25, 1.5, 1.75, 2, 2.5, 3, 4, 5, 6, 8, 10, 15, 20, 50, 100]

/** A tick: who is faster, and by how much, or even. */
const tickLabel = (r: number) =>
  r === 1
    ? 'even'
    : r > 1
      ? `${Number(r.toFixed(2))}× arm64`
      : `${Number((1 / r).toFixed(2))}× x86_64`

/** A readout's value: the winner and its advantage, to two places. */
const verdict = (r: number) => (r >= 1 ? `${r.toFixed(2)}× arm64` : `${(1 / r).toFixed(2)}× x86_64`)

const PLOT_HEIGHT = 180
/** Wide enough for "1.25× x86_64". */
const TICKS_WIDTH = 'w-[5.75rem]'

/** A line sample in a group's colour, for the legend. */
const LineSample = ({ color, width }: { color: string; width: number }) => (
  <svg aria-hidden="true" width="24" height="4" className="shrink-0 overflow-visible">
    <line
      x1="1"
      x2="23"
      y1="2"
      y2="2"
      style={{ stroke: color }}
      strokeWidth={width}
      strokeLinecap="round"
    />
  </svg>
)

type Tick = { r: number; top: number; label: string }

/** The shared log axis's labels, right-aligned against the plot. */
const TickLabels = ({ ticks, className = '' }: { ticks: Tick[]; className?: string }) => (
  <div className={`relative shrink-0 ${TICKS_WIDTH} ${className}`} style={{ height: PLOT_HEIGHT }}>
    {ticks.map((t) => (
      <span
        key={t.r}
        className={`measured absolute right-0 -translate-y-1/2 text-xs whitespace-nowrap ${t.r === 1 ? 'text-ink-2' : 'text-muted'}`}
        style={{ top: `${t.top}%` }}
      >
        {t.label}
      </span>
    ))}
  </div>
)

/**
 * One metric's panel of the advantage chart: a line per group across the memory sizes, on the
 * log axis every panel shares. Clicking a size's column picks it for the whole page.
 */
const AdvantagePanel = ({
  metric: m,
  series,
  ticks,
  y,
  memories,
  memoryMb,
  onPick,
  period,
}: {
  metric: Metric
  series: Series[]
  ticks: Tick[]
  y: (r: number) => number
  memories: number[]
  memoryMb: number
  onPick: (memoryMb: number) => void
  /** What the values are, for the readout: the mean, or a run's time. */
  period: string
}) => {
  const [pointed, setPointed] = useState<number>()
  const x = (i: number) => ((i + 0.5) / memories.length) * 100
  const selected = memories.indexOf(memoryMb)
  return (
    <article className="flex min-w-0 flex-col gap-3">
      <h4 className="flex h-6 items-center gap-2 text-md font-medium text-ink">
        <ChartIcon name={m.icon} className="size-4" />
        {m.title}
      </h4>
      <div className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-2 xl:gap-x-0">
        {/* Beside each panel until they're in one row, which shares the axis's labels. */}
        <TickLabels ticks={ticks} className="row-start-1 xl:hidden" />
        <div className="relative col-start-2 row-start-1" style={{ height: PLOT_HEIGHT }}>
          <div className="absolute inset-y-0 w-px bg-cool" style={{ left: `${x(selected)}%` }} />
          <svg
            viewBox="0 0 100 100"
            preserveAspectRatio="none"
            role="img"
            aria-label={`${m.title}: how many times as fast or cheap arm64 is as x86_64 at each memory size, one line per family and one for all`}
            className="absolute inset-0 size-full overflow-visible"
          >
            {ticks.map((t) => (
              <line
                key={t.r}
                x1={0}
                x2={100}
                y1={t.top}
                y2={t.top}
                className={t.r === 1 ? 'stroke-ink-2' : 'stroke-rule'}
                strokeWidth={t.r === 1 ? 1.5 : 1}
                vectorEffect="non-scaling-stroke"
              />
            ))}
            {series.map(({ group: g, values }) => (
              <polyline
                key={g.name}
                fill="none"
                style={{ stroke: g.color }}
                strokeWidth={g.width}
                strokeLinejoin="round"
                strokeLinecap="round"
                vectorEffect="non-scaling-stroke"
                points={values
                  .flatMap((v, i) => (v === undefined ? [] : [`${x(i)},${y(v)}`]))
                  .join(' ')}
              />
            ))}
          </svg>
          {series
            .filter((s) => s.values[selected] !== undefined)
            .map((s) => (
              <div
                key={s.group.name}
                className="absolute size-2.5 -translate-1/2 rounded-full border-2 border-paper-2"
                style={{
                  left: `${x(selected)}%`,
                  top: `${y(s.values[selected]!)}%`,
                  background: s.group.color,
                }}
              />
            ))}
          {pointed !== undefined && (
            <Floating left={x(pointed)}>
              <span className="measured text-muted">
                {m.title}, {memories[pointed]} MB, {period}
              </span>
              {series
                .filter((s) => s.values[pointed] !== undefined)
                .sort((a, b) => b.values[pointed]! - a.values[pointed]!)
                .map(({ group: g, values }) => (
                  <span key={g.name} className="flex items-center gap-2">
                    <span
                      aria-hidden="true"
                      className="size-2 shrink-0 rounded-full"
                      style={{ background: g.color }}
                    />
                    <span className="text-ink-2">{g.name}</span>
                    <span className="measured ml-auto pl-4 text-ink">
                      {verdict(values[pointed]!)}
                    </span>
                  </span>
                ))}
            </Floating>
          )}
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
        <div className={`col-start-2 ${X_LABELS}`}>
          {memories.map((mb, i) => (
            <span
              key={mb}
              className={`measured absolute -translate-x-1/2 text-xs whitespace-nowrap ${mb === memoryMb ? 'text-cool' : 'text-muted'}`}
              style={{ left: `${x(i)}%` }}
            >
              {mb}
            </span>
          ))}
        </div>
      </div>
    </article>
  )
}

/**
 * How many times as fast or cheap arm64 is as x86_64, for each family and all of them, at every
 * memory size: a panel per metric, side by side on one log axis around even, so the panels
 * compare directly; stacked on a narrow screen.
 */
const AdvantageChart = ({
  view,
  functions,
  memories,
  onPick,
  className = '',
}: {
  view: View
  /** Every Event Function, on both architectures and at every size. */
  functions: Fn[]
  /** Ascending. */
  memories: number[]
  onPick: (memoryMb: number) => void
  className?: string
}) => {
  const { runs, hover, memoryMb, agg } = view
  const panels = metricsOf(agg).map((metric) => ({
    metric,
    series: advantage(functions, memories, metric),
  }))
  // Symmetric around even, as far as the largest advantage either way in any panel, rounded up,
  // with that advantage at most 85% of the way to the edge.
  const most = Math.max(
    1,
    ...panels.flatMap((p) =>
      p.series.flatMap((s) => s.values.flatMap((v) => (v === undefined ? [] : [v, 1 / v])))
    )
  )
  const m = NICE_RATIOS.find((n) => n >= most ** (1 / 0.85)) ?? NICE_RATIOS.at(-1)!
  const y = (r: number) => 50 - (Math.log(r) / Math.log(m)) * 50
  const above = RATIO_TICKS.filter((t) => t <= m * 1.0001)
  const ticks = [...above.map((t) => 1 / t).reverse(), 1, ...above].map((r) => ({
    r,
    top: y(r),
    label: tickLabel(r),
  }))
  const period = hover !== undefined ? `run of ${when(runs[hover]!.date)} UTC` : 'mean'

  return (
    <div className={`flex min-w-0 flex-col gap-6 bg-paper-2 p-5 sm:p-6 ${className}`}>
      <div className="flex flex-wrap items-start justify-between gap-x-8 gap-y-3">
        <div className="flex flex-col gap-1 text-sm text-muted">
          <h3 className="flex items-baseline gap-2 text-xl text-ink">
            <ChartIcon name="sizes" className="size-5" />
            Advantage by memory
          </h3>
          <p>Geometric mean per family, {period}; memory in MB</p>
        </div>
        <ul className="m-0 flex list-none flex-wrap gap-x-5 gap-y-1 p-0 text-sm text-muted">
          {GROUPS.map((g) => (
            <li key={g.name} className="inline-flex items-center gap-2">
              <LineSample color={g.color} width={g.width} />
              {g.name}
            </li>
          ))}
        </ul>
      </div>
      <div className="grid grid-cols-1 gap-x-6 gap-y-8 sm:grid-cols-2 xl:grid-cols-[auto_repeat(4,minmax(0,1fr))]">
        {/* One set of labels for the row the panels share once there's room for one. */}
        <div aria-hidden="true" className="hidden flex-col gap-3 xl:flex">
          <div className="h-6" />
          <TickLabels ticks={ticks} />
        </div>
        {panels.map((p) => (
          <AdvantagePanel
            key={p.metric.key}
            metric={p.metric}
            series={p.series}
            ticks={ticks}
            y={y}
            memories={memories}
            memoryMb={memoryMb}
            onPick={onPick}
            period={period}
          />
        ))}
      </div>
    </div>
  )
}

/**
 * Each pair's cold start on both architectures at the picked size, beside the wide chart, with
 * how many times as fast arm64 is; hovering a row brings its lines forward.
 */
const ArchTable = ({
  view,
  pairs,
  memories,
  className = '',
}: {
  view: View
  pairs: Pair[]
  memories: number[]
  className?: string
}) => {
  const { runs, hover, memoryMb, focus, agg, setFocus } = view
  const i = memories.indexOf(memoryMb)
  const rows = pairs.map((p) => {
    const [arm, x86] = ARCHS.map((arch) => p.fns[arch][i])
    return {
      p,
      arm: arm && agg(arm, 'cold'),
      x86: x86 && agg(x86, 'cold'),
      armCost: arm && coldStartCost(arm, agg(arm, 'cold'), agg(arm, 'dur')),
      x86Cost: x86 && coldStartCost(x86, agg(x86, 'cold'), agg(x86, 'dur')),
    }
  })
  const speed = geomean(rows.flatMap((r) => (r.arm && r.x86 ? [r.x86 / r.arm] : [])))
  const cost = geomean(rows.flatMap((r) => (r.armCost && r.x86Cost ? [r.x86Cost / r.armCost] : [])))
  return (
    <article className={`flex min-w-0 flex-col gap-4 bg-paper-2 p-5 sm:p-6 ${className}`}>
      <div className="flex flex-col gap-1 text-sm text-muted">
        <h3 className="flex items-baseline gap-2 text-xl text-ink">
          <ChartIcon name="cold" className="size-5" />
          Cold start at {memoryMb} MB
        </h3>
        <p>ms, {hover !== undefined ? `run of ${when(runs[hover]!.date)} UTC` : 'mean'}</p>
      </div>
      <div
        role="table"
        aria-label={`Cold start on arm64 and x86_64 at ${memoryMb} MB`}
        className="grid grid-cols-[minmax(0,1fr)_auto_auto_auto] items-baseline gap-x-3 text-sm"
        onMouseLeave={() => setFocus(undefined)}
      >
        <div role="row" className="contents text-xs text-muted">
          <span role="columnheader" />
          <span role="columnheader" className="flex items-center justify-end gap-1.5 self-center">
            <Swatch arch="arm64" className="stroke-muted max-sm:hidden" />
            arm64
          </span>
          <span role="columnheader" className="flex items-center justify-end gap-1.5 self-center">
            <Swatch arch="x86_64" className="stroke-muted max-sm:hidden" />
            x86_64
          </span>
          {/* Its text out of sight but the cell in the grid, which an sr-only cell would leave. */}
          <span role="columnheader">
            <span className="sr-only">arm64 against x86_64</span>
          </span>
        </div>
        {rows.map(({ p, arm, x86 }) => (
          <div
            key={p.base}
            role="row"
            className={`contents ${focus && focus !== p.base ? '[&>*]:opacity-40' : ''}`}
            onMouseEnter={() => setFocus(p.base)}
          >
            <span role="rowheader" className="flex min-w-0 items-center gap-2 py-1 text-ink-2">
              <span
                aria-hidden="true"
                className="size-2.5 shrink-0 self-center rounded-full"
                style={{ background: p.color }}
              />
              <span className="truncate">{p.name}</span>
            </span>
            <span role="cell" className="measured text-right text-ink">
              {fixed(arm, 1)}
            </span>
            <span role="cell" className="measured text-right text-ink-2">
              {fixed(x86, 1)}
            </span>
            <span role="cell" className="w-12 text-right">
              <Versus value={arm} baseline={x86} />
            </span>
          </div>
        ))}
      </div>
      {speed !== undefined && (
        <p className="mt-auto border-t border-rule pt-4 text-sm text-pretty text-muted">
          On arm64, the {rows.length === 1 ? 'function' : `${rows.length} functions`} cold-start{' '}
          <span className="measured text-ink">{speed.toFixed(2)}×</span> as fast
          {cost !== undefined && (
            <>
              {' '}
              and, with a GB-second a fifth cheaper, for{' '}
              <span className="measured text-ink">{Math.round((1 - 1 / cost) * 100)}%</span> less
            </>
          )}
          .
        </p>
      )}
    </article>
  )
}

/**
 * arm64 or x86_64, and whether the answer changes with memory, runtime or metric: each family's
 * advantage at every memory size, then each shown Event Function at the picked size. The charts
 * above show one architecture at a time.
 */
export const Architectures = ({
  view,
  functions,
  memories,
  onPick,
}: {
  /** The functions on the toolbar's architecture at the picked size, for which are shown. */
  view: View
  /** Every Event Function, on both architectures and at every size. */
  functions: Fn[]
  /** Ascending. */
  memories: number[]
  onPick: (memoryMb: number) => void
}) => {
  const byId = new Map(functions.map((f) => [f.id, f]))
  const pairs: Pair[] = view.shown.flatMap((s) => {
    const fns = Object.fromEntries(
      ARCHS.map((arch) => [arch, memories.map((mb) => byId.get(`${s.base}/${arch}/${mb}`))])
    ) as Pair['fns']
    // A variant on one architecture only has nothing to compare.
    if (!ARCHS.every((arch) => fns[arch].some(Boolean))) return []
    return [{ base: s.base, name: s.name, color: s.color, fns }]
  })
  if (!pairs.length) return null
  const discount = Math.round((1 - PRICES.gbSecond.arm64 / PRICES.gbSecond.x86_64) * 100)

  return (
    <section
      id={ARCH_SECTION}
      className={`${WRAP} flex scroll-mt-20 flex-col gap-6 pt-16 sm:pt-20`}
    >
      <div className="flex flex-col gap-3">
        <h2 className="text-2xl">arm64 vs x86_64</h2>
        <p className="max-w-prose text-pretty text-ink-2">
          The same Event Functions on Graviton and on x86_64, at every memory size, in{' '}
          {STACK_REGION}. Click a size to pick it for the whole page.
        </p>
      </div>
      <div className="grid grid-cols-1 gap-px overflow-hidden rounded-card border border-rule bg-rule">
        <AdvantageChart view={view} functions={functions} memories={memories} onPick={onPick} />
        <ArchTable view={view} pairs={pairs} memories={memories} />
      </div>
      <p className="max-w-prose text-sm text-pretty text-muted">
        Each ratio is x86_64’s value over arm64’s, averaged geometrically over a family’s Event
        Functions measured on both. First answer is the cold invocation’s round trip, as PerfMeasure
        in the same region sees it. Cost per cold start is the init plus the invocation, billed as
        duration on every runtime since August 2025, and the request, at {STACK_REGION}’s first-tier
        prices: arm64’s GB-second is {discount}% cheaper.
      </p>
    </section>
  )
}
