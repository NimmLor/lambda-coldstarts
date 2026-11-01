import { type ReactNode, useState } from 'react'
import { track } from './analytics'
import { Floating, tone, X_LABELS } from './Chart'
import { ChartIcon, type ChartIconName } from './ChartIcon'
import {
  ARCHS,
  coldStartCost,
  FAMILY_NAMES,
  type Family,
  type Fn,
  fixed,
  geomean,
  niceMax,
  PRICES,
  STACK_REGION,
  shortName,
  type View,
  when,
} from './data'
import bunIcon from './icons/bun.svg'
import llrtIcon from './icons/llrt.svg'
import nodeIcon from './icons/nodejs.svg'
import { WRAP } from './layout'
import { useStored } from './stored'

/** The id of the section, which the glance at the top links to. */
export const ARCH_SECTION = 'arm64-vs-x86_64'

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

/** A metric's panel: the metric, and each group's advantage in it at every memory size. */
type Panel = { metric: Metric; series: Series[] }

/**
 * The Event Functions by id, and one per variant for its family, which every size and
 * architecture shares. Web Functions and MicroVMs run on arm64 only, so they're left out.
 */
const indexEvents = (functions: Fn[]) => {
  const events = functions.filter((f) => !f.web && !f.microvm)
  return {
    byId: new Map(events.map((f) => [f.id, f])),
    variants: [...new Map(events.map((f) => [f.base, f])).values()],
  }
}

/**
 * Each group's advantage in `metric` at each memory size: the geometric mean, over its variants
 * with a value on both architectures at that size, of x86_64's value over arm64's. Web Functions
 * and MicroVMs, which run on arm64 only, are left out; the Functions filter doesn't apply.
 */
const advantage = (functions: Fn[], memories: number[], metric: Metric): Series[] => {
  const { byId, variants } = indexEvents(functions)
  const ratio = (base: string, mb: number) => {
    const arm = byId.get(`${base}/arm64/${mb}`)
    const x86 = byId.get(`${base}/x86_64/${mb}`)
    const a = arm && metric.value(arm)
    const b = x86 && metric.value(x86)
    return a && b ? b / a : undefined
  }
  return GROUPS.map((group) => {
    const members = variants.filter(group.has)
    return {
      group,
      values: memories.map((mb) => geomean(members.flatMap((v) => ratio(v.base, mb) ?? []))),
    }
  }).filter((s) => s.values.some((v) => v !== undefined))
}

/** Advantages a gridline may sit at, above 1×; below it, their reciprocals. */
const RATIO_TICKS = [1.25, 1.5, 2, 3, 4, 5, 10, 20, 50, 100]
/** Rounded up to, for the axis's extent. */
const NICE_RATIOS = [1.25, 1.5, 1.75, 2, 2.5, 3, 4, 5, 6, 8, 10, 15, 20, 50, 100]

/**
 * A tick: by how much the winner is faster, or even. Which one wins is the half it's in, which
 * the plot tints and the legend names once.
 */
const tickLabel = (r: number) => (r === 1 ? 'even' : `${Number(Math.max(r, 1 / r).toFixed(2))}×`)

/** Each half of the plot's tint: arm64 faster above even, x86_64 below, as the ratio chips colour them. */
const HALVES = [
  { name: 'arm64 faster', tint: 'color-mix(in oklab, var(--color-ok) 9%, transparent)' },
  { name: 'x86_64 faster', tint: 'color-mix(in oklab, var(--color-bad) 9%, transparent)' },
] as const

/** A readout's value: the winner and its advantage, to two places. */
const verdict = (r: number) => (r >= 1 ? `${r.toFixed(2)}× arm64` : `${(1 / r).toFixed(2)}× x86_64`)

const PLOT_HEIGHT = 180
/** Wide enough for "1.25×". */
const TICKS_WIDTH = 'w-10'

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
          {/* Even is the middle of the plot, which the axis is symmetric around. */}
          <div className="absolute inset-x-0 top-0 h-1/2" style={{ background: HALVES[0].tint }} />
          <div
            className="absolute inset-x-0 bottom-0 h-1/2"
            style={{ background: HALVES[1].tint }}
          />
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
  panels,
  memories,
  onPick,
  className = '',
}: {
  view: View
  panels: Panel[]
  /** Ascending. */
  memories: number[]
  onPick: (memoryMb: number) => void
  className?: string
}) => {
  const { runs, hover, memoryMb } = view
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
        <div className="flex flex-col gap-2 sm:items-end">
          <ul className="m-0 flex list-none flex-wrap gap-x-5 gap-y-1 p-0 text-sm text-muted">
            {GROUPS.map((g) => (
              <li key={g.name} className="inline-flex items-center gap-2">
                <LineSample color={g.color} width={g.width} />
                {g.name}
              </li>
            ))}
          </ul>
          {/* Which architecture each half of the plots favours, named once for all four. */}
          <ul className="m-0 flex list-none flex-wrap gap-x-5 gap-y-1 p-0 text-sm text-muted">
            {HALVES.map((h, i) => (
              <li key={h.name} className="inline-flex items-center gap-2">
                <span
                  aria-hidden="true"
                  className={`h-3 w-6 rounded-chip border ${i === 0 ? 'border-ok/40' : 'border-bad/40'}`}
                  style={{ background: h.tint }}
                />
                {h.name}
              </li>
            ))}
          </ul>
        </div>
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

const FAMILY_ICONS: Record<Family, string> = { Bun: bunIcon, LLRT: llrtIcon, Node: nodeIcon }

/** arm64's advantage as a chip: green and above 1× when it's faster, red and below when it's not. */
const RatioChip = ({ r }: { r?: number }) =>
  r === undefined ? (
    <span className="text-muted">—</span>
  ) : (
    <span className="measured rounded-chip px-1 text-xs" style={tone(r)}>
      {r.toFixed(2)}×
    </span>
  )

/** What a cold start costs on arm64 against x86_64, as a difference: −25% is a quarter less. */
const CostChip = ({ r }: { r?: number }) => {
  if (r === undefined) return <span className="text-muted">—</span>
  const percent = Math.round((1 / r - 1) * 100)
  return (
    <span className="measured rounded-chip px-1 text-xs" style={tone(r)}>
      {percent > 0 ? '+' : percent < 0 ? '−' : '±'}
      {Math.abs(percent)}%
    </span>
  )
}

/**
 * A chip for each metric's ratio, cost as a difference, in the order the record was built in,
 * which is metricsOf's, as the headings are.
 */
const RatioCells = ({ ratios }: { ratios: Record<Metric['key'], number | undefined> }) => (
  <>
    {(Object.entries(ratios) as [Metric['key'], number | undefined][]).map(([key, r]) => (
      <td key={key} className="px-1 py-1.5 text-right last:pr-0 sm:px-2">
        {key === 'cost' ? <CostChip r={r} /> : <RatioChip r={r} />}
      </td>
    ))}
  </>
)

/** Each architecture's colour where a row shows both: tokens.css's `--color-arch-*`. */
const ARCH_COLORS = { arm64: 'var(--color-arch-arm)', x86_64: 'var(--color-arch-x86)' } as const

/** Each architecture's mark on the track; the legend draws them a little smaller. */
const MARKS = { arm64: 'size-3.5 rounded-full', x86_64: 'h-4 w-1.5 rounded-[2px]' } as const

/**
 * A value on the track, ringed off the bar under it: arm64 a green circle, x86_64 an upright red
 * bar, so the two differ in shape as well as colour.
 */
const Marker = ({ arch, left }: { arch: keyof typeof ARCH_COLORS; left: string }) => (
  <span
    className={`absolute top-1/2 -translate-1/2 ring-2 ring-paper-2 ${MARKS[arch]}`}
    style={{ left, background: ARCH_COLORS[arch] }}
  />
)

/** The dumbbell's track, on the axis every row shares, and the values beside it. */
const TRACK = 'relative h-5 min-w-32 flex-1 max-sm:hidden'
const VALUES = 'shrink-0 text-right whitespace-nowrap max-sm:ml-auto sm:w-[6.5rem]'

/** What the table's dumbbells can show, with the decimals its values take. */
const SPANS = [
  { key: 'cold', title: 'Cold start', digits: 0 },
  { key: 'trip', title: 'First answer', digits: 0 },
  { key: 'warm', title: 'Warm start', digits: 2 },
] as const
type SpanKey = (typeof SPANS)[number]['key']
const isSpanKey = (value: unknown): value is SpanKey => SPANS.some((m) => m.key === value)

/**
 * Each shown Event Function at the picked size, under its family's heading: its cold start, first
 * answer or warm start, as picked and kept, on both architectures as a dumbbell on a shared axis,
 * and arm64's advantage in every metric. Hovering a row brings it forward on the charts above.
 */
const ArchTable = ({
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
  const { runs, hover, memoryMb, focus, agg, setFocus, shown } = view
  const [spanKey, setSpanKey] = useStored<SpanKey>('archTableMetric', 'cold', isSpanKey)
  const span = SPANS.find((m) => m.key === spanKey)!
  const metrics = metricsOf(agg)
  const byId = new Map(functions.map((f) => [f.id, f]))
  const rows = shown.flatMap((f) => {
    const arm = byId.get(`${f.base}/arm64/${memoryMb}`)
    const x86 = byId.get(`${f.base}/x86_64/${memoryMb}`)
    // A variant on one architecture only has nothing to compare.
    if (!arm || !x86) return []
    const ratios = Object.fromEntries(
      metrics.map((m) => {
        const a = m.value(arm)
        const b = m.value(x86)
        return [m.key, a && b ? b / a : undefined]
      })
    ) as Record<Metric['key'], number | undefined>
    return [{ f, values: [agg(arm, span.key), agg(x86, span.key)] as const, ratios }]
  })
  const families = (Object.keys(FAMILY_NAMES) as Family[]).flatMap((family) => {
    const members = rows.filter((r) => r.f.family === family)
    if (!members.length) return []
    const ratios = Object.fromEntries(
      metrics.map((m) => [m.key, geomean(members.flatMap((r) => r.ratios[m.key] ?? []))])
    ) as Record<Metric['key'], number | undefined>
    return [{ family, members, ratios }]
  })
  const max = niceMax(Math.max(0, ...rows.flatMap((r) => r.values.filter((v) => v !== undefined))))
  const at = (ms: number) => `${(ms / max) * 100}%`
  const period = hover !== undefined ? `run of ${when(runs[hover]!.date)} UTC` : 'mean'

  return (
    <div className={`flex min-w-0 flex-col gap-5 bg-paper-2 p-5 sm:p-6 ${className}`}>
      <div className="flex flex-wrap items-start justify-between gap-x-8 gap-y-3">
        <div className="flex flex-col gap-1 text-sm text-muted">
          <h3 className="flex items-baseline gap-2 text-xl text-ink">
            <ChartIcon name={span.key} className="size-5" />
            Per function at {memoryMb} MB
          </h3>
          <p>
            {period}; ratios are arm64’s advantage, above 1× when it’s faster, and cost its
            difference
          </p>
        </div>
        <div className="flex flex-wrap gap-3">
          {/* Which value the dumbbells show; the ratio columns keep all of them. */}
          <div className="cells" role="group" aria-label="Dumbbells show">
            {SPANS.map((m) => (
              <button
                key={m.key}
                type="button"
                aria-pressed={m.key === span.key}
                onClick={() => {
                  track('arch_table_metric_picked', { metric: m.key })
                  setSpanKey(m.key)
                }}
              >
                {m.title}
              </button>
            ))}
          </div>
          <div className="cells" role="group" aria-label="Memory, MB">
            {memories.map((mb) => (
              <button
                key={mb}
                type="button"
                aria-pressed={mb === memoryMb}
                onClick={() => onPick(mb)}
              >
                {mb}
              </button>
            ))}
          </div>
        </div>
      </div>
      {/* Sideways on a phone, its names held at the left; there it shows the values without the track. */}
      <div className="-mx-5 overflow-x-auto px-5 sm:-mx-6 sm:px-6">
        <table
          className="w-full border-collapse text-sm sm:min-w-[42rem]"
          onMouseLeave={() => setFocus(undefined)}
        >
          <thead className="text-xs text-muted">
            <tr>
              {/* The names and ratios as narrow as they go, which leaves the rest to the track. */}
              <th className="sticky left-0 z-1 w-px bg-paper-2" />
              <th className="pb-1 text-left font-normal">
                <span className="flex flex-wrap items-center gap-x-4">
                  <span className="whitespace-nowrap text-ink-2">{span.title}, ms</span>
                  {/* What the marks' colours are; a phone has no track, and the values' heading says it. */}
                  <span className="inline-flex items-center gap-1.5 max-sm:hidden">
                    <span aria-hidden="true" className="size-2.5 rounded-full bg-arch-arm" />
                    <span className="text-arch-arm">arm64</span>
                  </span>
                  <span className="inline-flex items-center gap-1.5 max-sm:hidden">
                    <span aria-hidden="true" className="h-3 w-1 rounded-[1px] bg-arch-x86" />
                    <span className="text-arch-x86">x86_64</span>
                  </span>
                </span>
              </th>
              <th colSpan={4} className="pb-1 text-right font-normal text-ink-2">
                arm64 vs x86_64
              </th>
            </tr>
            <tr className="border-b border-rule">
              <th className="sticky left-0 z-1 bg-paper-2" />
              <th className="pb-2 font-normal">
                <span className="flex items-center gap-3">
                  <span aria-hidden="true" className={`${TRACK} measured`}>
                    {[0, 0.5, 1].map((g) => (
                      <span
                        key={g}
                        className={`absolute ${g === 0 ? '' : g === 1 ? '-translate-x-full' : '-translate-x-1/2'}`}
                        style={{ left: `${g * 100}%` }}
                      >
                        {Number((max * g).toFixed(2))}
                      </span>
                    ))}
                  </span>
                  {/* Flex items, so the font's contextual alternates don't read "4 x8" as "4 ×8". */}
                  <span className={`${VALUES} flex justify-end gap-x-[1ch]`}>
                    <span className="text-arch-arm">arm64</span>
                    <span className="text-arch-x86">x86_64</span>
                  </span>
                </span>
              </th>
              {metrics.map((m) => (
                <th
                  key={m.key}
                  className="w-px px-1 pb-2 text-right font-normal whitespace-nowrap last:pr-0 sm:px-2"
                >
                  {/* One word each on a phone, where the four have to fit beside the names. */}
                  <span className="sm:hidden">{m.title.split(' ')[0]}</span>
                  <span className="max-sm:hidden">{m.key === 'cost' ? 'Cost' : m.title}</span>
                </th>
              ))}
            </tr>
          </thead>
          {families.map(({ family, members, ratios }) => (
            <tbody key={family} className="border-b border-rule last:border-b-0">
              <tr>
                <th
                  scope="rowgroup"
                  className="sticky left-0 z-1 bg-paper-2 pt-3 pb-1.5 text-left font-medium whitespace-nowrap text-ink"
                >
                  <span className="inline-flex items-center gap-2">
                    <img
                      src={FAMILY_ICONS[family]}
                      alt=""
                      width={16}
                      height={16}
                      className="block shrink-0"
                    />
                    {FAMILY_NAMES[family]}
                  </span>
                </th>
                <td />
                <RatioCells ratios={ratios} />
              </tr>
              {members.map(({ f, values: [arm, x86], ratios: r }) => (
                <tr
                  key={f.base}
                  onMouseEnter={() => setFocus(f.base)}
                  className={focus && focus !== f.base ? 'opacity-40' : ''}
                >
                  <th
                    scope="row"
                    className="sticky left-0 z-1 bg-paper-2 py-1.5 pr-3 pl-2 text-left font-normal whitespace-nowrap text-ink-2 sm:pr-4 sm:pl-6"
                  >
                    <span className="flex items-center gap-2">
                      <span
                        aria-hidden="true"
                        className="size-2.5 shrink-0 rounded-full"
                        style={{ background: f.color }}
                      />
                      {shortName(f.base)}
                    </span>
                  </th>
                  <td className="py-1.5">
                    <span className="flex items-center gap-3">
                      <span aria-hidden="true" className={TRACK}>
                        {[0.25, 0.5, 0.75].map((g) => (
                          <span
                            key={g}
                            className="absolute inset-y-0 w-px bg-rule"
                            style={{ left: `${g * 100}%` }}
                          />
                        ))}
                        {arm !== undefined && x86 !== undefined && (
                          // Neutral, so the circles' colours stand out at its ends.
                          <span
                            className="absolute top-1/2 h-2 -translate-y-1/2 rounded-full bg-rule-2"
                            style={{
                              left: at(Math.min(arm, x86)),
                              width: `${(Math.abs(x86 - arm) / max) * 100}%`,
                            }}
                          />
                        )}
                        {x86 !== undefined && <Marker arch="x86_64" left={at(x86)} />}
                        {arm !== undefined && <Marker arch="arm64" left={at(arm)} />}
                      </span>
                      <span className={`${VALUES} measured`}>
                        <span className="text-arch-arm">{fixed(arm, span.digits)}</span>{' '}
                        <span className="text-arch-x86">{fixed(x86, span.digits)}</span>
                      </span>
                    </span>
                  </td>
                  <RatioCells ratios={r} />
                </tr>
              ))}
            </tbody>
          ))}
        </table>
      </div>
    </div>
  )
}

/** Within this of each other, two values are even: the headline names no winner. */
const EVEN = 1.05

/**
 * The largest relative spread of cold start across the memory sizes: per group and
 * architecture, the geometric mean of the cold start of its variants measured at every size,
 * from the lowest size's to the highest's.
 */
const coldSpread = (functions: Fn[], memories: number[], cold: (f: Fn) => number | undefined) => {
  const { byId, variants } = indexEvents(functions)
  let most = 0
  for (const g of GROUPS) {
    for (const arch of ARCHS) {
      const series = variants
        .filter(g.has)
        .map((v) =>
          memories.map((mb) => {
            const f = byId.get(`${v.base}/${arch}/${mb}`)
            return f && cold(f)
          })
        )
        .filter((values): values is number[] => values.every((v) => v !== undefined && v > 0))
      if (!series.length) continue
      const means = memories.map((_, i) => geomean(series.map((s) => s[i]!))!)
      most = Math.max(most, Math.max(...means) / Math.min(...means) - 1)
    }
  }
  return most
}

const Figure = ({ children }: { children: ReactNode }) => (
  <span className="measured text-ink">{children}</span>
)

/**
 * The section's answer in a sentence, from the same geometric means as the panels: all Event
 * Functions' cold start and cost at the picked size, where their warm start favours x86_64, and how
 * little memory moves cold start.
 */
const Headline = ({
  view,
  panels,
  functions,
  memories,
}: {
  view: View
  panels: Panel[]
  functions: Fn[]
  memories: number[]
}) => {
  const all = (key: Metric['key']) =>
    panels.find((p) => p.metric.key === key)?.series.find((s) => s.group.name === 'All')?.values ??
    []
  const at = memories.indexOf(view.memoryMb)
  const cold = all('cold')[at]
  const cost = all('cost')[at]
  const warm = all('warm')
  if (cold === undefined) return null

  const percent = cost === undefined ? undefined : Math.round((1 / cost - 1) * 100)
  // The sizes where x86_64's warm start is more than even, and by how much at most.
  const losses = memories.flatMap((_, i) =>
    warm[i] !== undefined && warm[i]! < 1 / EVEN ? [i] : []
  )
  const most = Math.max(...losses.map((i) => 1 / warm[i]!))
  const prefix = losses.every((i, k) => i === k)
  const where =
    losses.length === memories.length
      ? 'at every size'
      : prefix
        ? `below ${memories[losses.length]} MB`
        : `at ${losses.map((i) => memories[i]).join(', ')} MB`
  const spread = Math.round(coldSpread(functions, memories, (f) => view.agg(f, 'cold')) * 100)

  return (
    <p className="max-w-prose text-lg/normal text-pretty text-ink-2">
      At {view.memoryMb} MB arm64{' '}
      {cold >= 1 ? (
        <>
          cold-starts <Figure>{cold.toFixed(2)}×</Figure> as fast
        </>
      ) : (
        <>
          takes <Figure>{(1 / cold).toFixed(2)}×</Figure> as long to cold-start
        </>
      )}
      {percent !== undefined &&
        (percent === 0 ? (
          ' and costs the same per cold start'
        ) : (
          <>
            {' '}
            and costs <Figure>{Math.abs(percent)}%</Figure> {percent < 0 ? 'less' : 'more'} per cold
            start
          </>
        ))}
      {/* Nothing to say of the warm start when no run in view measured one. */}
      {!warm.some((r) => r !== undefined) ? (
        '.'
      ) : losses.length ? (
        <>
          ; warm, x86_64 is up to <Figure>{most.toFixed(2)}×</Figure> faster {where}.
        </>
      ) : warm.every((r) => r === undefined || r >= EVEN) ? (
        '; warm, arm64 is faster too.'
      ) : (
        '; warm, x86_64 is nowhere more than 5% faster.'
      )}{' '}
      {spread <= 10 ? (
        <>
          Memory barely moves cold start: by <Figure>{spread}%</Figure> at most.
        </>
      ) : (
        <>
          Memory moves cold start by up to <Figure>{spread}%</Figure>.
        </>
      )}
    </p>
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
  // Nothing to compare without a variant on both architectures.
  const archs = new Map<string, Set<string>>()
  for (const f of functions) archs.set(f.base, (archs.get(f.base) ?? new Set()).add(f.arch))
  if (![...archs.values()].some((a) => a.has('arm64') && a.has('x86_64'))) return null
  const discount = Math.round((1 - PRICES.gbSecond.arm64 / PRICES.gbSecond.x86_64) * 100)
  // Once per render, for the headline and the chart both.
  const panels = metricsOf(view.agg).map((metric) => ({
    metric,
    series: advantage(functions, memories, metric),
  }))

  return (
    <section
      id={ARCH_SECTION}
      className={`${WRAP} flex scroll-mt-20 flex-col gap-6 pt-16 sm:pt-20`}
    >
      <div className="flex flex-col gap-3">
        <h2 className="text-2xl">arm64 vs x86_64</h2>
        <Headline view={view} panels={panels} functions={functions} memories={memories} />
      </div>
      <div className="grid grid-cols-1 gap-px overflow-hidden rounded-card border border-rule bg-rule">
        <AdvantageChart view={view} panels={panels} memories={memories} onPick={onPick} />
        <ArchTable view={view} functions={functions} memories={memories} onPick={onPick} />
      </div>
      <p className="max-w-prose text-sm text-pretty text-muted">
        The same Event Functions on both architectures, at every memory size, in {STACK_REGION}.
        Each ratio is x86_64 over arm64, the geometric mean across a family’s functions. First
        answer is the cold invocation’s round trip from PerfMeasure. Cost per cold start bills init,
        invocation and request at first-tier prices; arm64’s GB-second is {discount}% cheaper.
      </p>
    </section>
  )
}
