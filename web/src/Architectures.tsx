import { useState } from 'react'
import { AXES, Floating, Versus, X_LABELS, Y_LABEL, Y_LABELS } from './Chart'
import { ChartIcon, type ChartIconName } from './ChartIcon'
import {
  ARCH_DASHES,
  ARCHS,
  type Arch,
  coldStartCost,
  type Fn,
  fixed,
  niceMax,
  PRICES,
  STACK_REGION,
  type View,
  when,
} from './data'
import { WRAP } from './layout'

/** The id of the section, which the glance at the top links to. */
export const ARCH_SECTION = 'arm64-vs-x86_64'

/** What a chart plots of each function, at each memory size. */
type Measure = {
  title: string
  unit: string
  digits: number
  icon: ChartIconName
  value: (f: Fn) => number | undefined
}

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
 * `measure` of each pair at every memory size, arm64 solid and x86_64 dotted in the pair's
 * colour. Clicking a size's column shows that size everywhere.
 */
const ArchChart = ({
  measure: m,
  wide,
  view,
  pairs,
  memories,
  onPick,
  className = '',
}: {
  measure: Measure
  wide: boolean
  view: View
  pairs: Pair[]
  /** Ascending. */
  memories: number[]
  onPick: (memoryMb: number) => void
  className?: string
}) => {
  const { runs, hover, memoryMb, focus } = view
  const [pointed, setPointed] = useState<number>()
  const x = (i: number) => ((i + 0.5) / memories.length) * 100
  const values = (p: Pair, arch: Arch) => p.fns[arch].map((f) => f && m.value(f))
  const series = pairs.flatMap((p) => ARCHS.map((arch) => ({ p, arch, values: values(p, arch) })))
  const max = niceMax(
    Math.max(0, ...series.flatMap((s) => s.values.filter((v) => v !== undefined)))
  )
  const y = (v: number) => 100 - (v / max) * 100
  const grid = [0, 0.25, 0.5, 0.75, 1].map((g) => ({
    top: 100 - g * 100,
    label: (max * g).toFixed(max < 5 ? 1 : 0),
  }))
  const height = wide ? 300 : 180
  // x86_64 under arm64, and the focused pair over both.
  const rank = (s: (typeof series)[number]) =>
    Number(s.p.base === focus) * 2 + Number(s.arch === 'arm64')
  const ordered = series.toSorted((a, b) => rank(a) - rank(b))
  const selected = memories.indexOf(memoryMb)
  const period = hover !== undefined ? `run of ${when(runs[hover]!.date)} UTC` : 'mean'

  return (
    <article className={`flex min-w-0 flex-col gap-5 bg-paper-2 p-5 sm:p-6 ${className}`}>
      <div className="flex flex-col gap-1 text-sm text-muted">
        <h3 className={`flex items-baseline gap-2 text-ink ${wide ? 'text-xl' : 'text-lg'}`}>
          <ChartIcon name={m.icon} className={wide ? 'size-5' : 'size-[1.125rem]'} />
          {m.title} by memory
        </h3>
        <p>
          {m.unit}, {period}
        </p>
      </div>
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
            aria-label={`${m.title} in ${m.unit} at each memory size, a solid line per function on arm64 and a dotted one on x86_64`}
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
                key={`${s.p.base}/${s.arch}`}
                fill="none"
                style={{ stroke: s.p.color }}
                strokeOpacity={!focus || focus === s.p.base ? 1 : 0.15}
                strokeWidth={focus === s.p.base ? 3 : 2}
                strokeLinejoin="round"
                strokeLinecap="round"
                vectorEffect="non-scaling-stroke"
                strokeDasharray={ARCH_DASHES[s.arch]}
                points={s.values
                  .flatMap((v, i) => (v === undefined ? [] : [`${x(i)},${y(v)}`]))
                  .join(' ')}
              />
            ))}
          </svg>
          {pointed !== undefined && (
            <ArchReadout
              left={x(pointed)}
              title={`${memories[pointed]} MB, ${hover !== undefined ? `${when(runs[hover]!.date)} UTC` : 'mean'}`}
              rows={pairs.map((p) => ({
                p,
                arm: values(p, 'arm64')[pointed],
                x86: values(p, 'x86_64')[pointed],
              }))}
              digits={m.digits}
              focus={focus}
            />
          )}
          {/* At the picked size, arm64's point filled and x86_64's hollow. */}
          {series
            .filter((s) => s.values[selected] !== undefined && (!focus || focus === s.p.base))
            .map((s) => (
              <div
                key={`${s.p.base}/${s.arch}`}
                className="absolute size-2.5 -translate-1/2 rounded-full border-2"
                style={{
                  left: `${x(selected)}%`,
                  top: `${y(s.values[selected]!)}%`,
                  ...(s.arch === 'arm64'
                    ? { background: s.p.color, borderColor: 'var(--color-paper-2)' }
                    : { background: 'var(--color-paper-2)', borderColor: s.p.color }),
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
              {mb}
              <span className={wide ? 'max-sm:hidden' : 'max-sm:hidden md:max-lg:hidden'}> MB</span>
            </span>
          ))}
        </div>
      </div>
    </article>
  )
}

/** Each pair's arm64 and x86_64 values at the pointed size, fastest on arm64 first. */
const ArchReadout = ({
  left,
  title,
  rows,
  digits,
  focus,
}: {
  left: number
  title: string
  rows: { p: Pair; arm?: number; x86?: number }[]
  digits: number
  focus?: string
}) => (
  <Floating left={left}>
    <span className="measured text-muted">{title}</span>
    <span className="grid grid-cols-[auto_auto_auto_auto] items-center gap-x-3 gap-y-1">
      <span />
      <span className="flex items-center justify-end gap-1.5 text-muted">
        <Swatch arch="arm64" className="stroke-muted max-sm:hidden" />
        arm64
      </span>
      <span className="flex items-center justify-end gap-1.5 text-muted">
        <Swatch arch="x86_64" className="stroke-muted max-sm:hidden" />
        x86_64
      </span>
      <span />
      {rows
        .filter((r) => r.arm !== undefined || r.x86 !== undefined)
        .sort((a, b) => (a.arm ?? Infinity) - (b.arm ?? Infinity))
        .map(({ p, arm, x86 }) => (
          <span
            key={p.base}
            className={`contents ${focus && focus !== p.base ? '[&>*]:opacity-40' : ''}`}
          >
            <span className="flex items-center gap-2">
              <span
                aria-hidden="true"
                className="size-2 shrink-0 rounded-full"
                style={{ background: p.color }}
              />
              <span className={focus === p.base ? 'font-medium text-ink' : 'text-ink-2'}>
                {p.name}
              </span>
            </span>
            <span className="measured text-right text-ink">{fixed(arm, digits)}</span>
            <span className="measured text-right text-ink-2">{fixed(x86, digits)}</span>
            <span className="w-12 text-right">
              <Versus value={arm} baseline={x86} />
            </span>
          </span>
        ))}
    </span>
  </Floating>
)

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
 * Every shown Event Function on arm64 against x86_64, at every memory size: the cold start beside
 * a table of it at the picked size, then the warm start, the round trip of the cold invocation and
 * what a cold start costs. Its own section, as the charts above show one architecture at a time.
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
  const { agg } = view
  const measures: Measure[] = [
    {
      title: 'Cold start',
      unit: 'ms',
      digits: 1,
      icon: 'cold',
      value: (f) => agg(f, 'cold'),
    },
    {
      title: 'Warm start',
      unit: 'ms',
      digits: 2,
      icon: 'warm',
      value: (f) => agg(f, 'warm'),
    },
    {
      title: 'First answer',
      unit: 'ms',
      digits: 0,
      icon: 'dur',
      value: (f) => agg(f, 'trip'),
    },
    {
      title: 'Cold start cost',
      unit: 'USD per million cold starts',
      digits: 2,
      icon: 'cost',
      value: (f) => coldStartCost(f, agg(f, 'cold'), agg(f, 'dur')),
    },
  ]
  const [cold, ...small] = measures
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
          {STACK_REGION}. Each runtime keeps its colour from above: solid on arm64, dotted on
          x86_64. Click a size to pick it for the whole page.
        </p>
      </div>
      <div className="flex flex-wrap items-center justify-end gap-5 text-sm text-muted">
        {ARCHS.map((arch) => (
          <span key={arch} className="inline-flex items-center gap-2">
            <Swatch arch={arch} />
            {arch}
          </span>
        ))}
      </div>
      <div className="grid grid-cols-1 gap-px overflow-hidden rounded-card border border-rule bg-rule md:grid-cols-3">
        <ArchChart
          measure={cold!}
          wide
          view={view}
          pairs={pairs}
          memories={memories}
          onPick={onPick}
          className="col-span-full lg:col-span-2"
        />
        <ArchTable
          view={view}
          pairs={pairs}
          memories={memories}
          className="col-span-full lg:col-span-1"
        />
        {small.map((m) => (
          <ArchChart
            key={m.title}
            measure={m}
            wide={false}
            view={view}
            pairs={pairs}
            memories={memories}
            onPick={onPick}
          />
        ))}
      </div>
      <p className="max-w-prose text-sm text-pretty text-muted">
        First answer is the cold invocation’s round trip, as PerfMeasure in the same region sees it.
        Cold start cost is the init plus the invocation, billed as duration on every runtime since
        August 2025, and the request, at {STACK_REGION}’s first-tier prices: arm64’s GB-second is{' '}
        {discount}% cheaper.
      </p>
    </section>
  )
}
