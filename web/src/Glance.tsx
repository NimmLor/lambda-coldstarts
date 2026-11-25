import { Fragment, type ReactNode, useEffect, useState } from 'react'
import {
  FAMILY_NAMES,
  type Figures,
  type Fn,
  fixed,
  niceMax,
  type RunPoints,
  SEGMENTS,
  shortName,
  VARIANTS,
  versionName,
} from './data'
import { BASELINE, compared, type Finding, GLANCE, type Mark } from './findings'
import { TABS, type TabId } from './tabs'
import { FamilyIcon } from './ui'

type Row = { f: Fn; x: Figures }

/** What the board ranks a column's leader by: less is better in each. */
const LED = ['cold', 'trip', 'p99', 'warm', 'workFirst', 'mem'] as const

/** Past this many times its median, a function's slowest 1% is a tail worth flagging. */
const TAIL = 2

/** The board's columns from `xl`; below it a row stacks, each reading under a label of its own. */
// Narrower than before the workload's column, so the first answer's bar keeps its width.
const COLUMNS = 'xl:grid-cols-[208px_188px_minmax(0,1fr)_128px_56px_76px_56px] xl:gap-x-6'
const HALF = 'col-span-full md:col-span-4 xl:col-span-1'
const STAT = 'flex flex-col gap-1 md:col-span-2 xl:col-span-1 xl:-mr-1 xl:items-end'

/** A column's name over a reading, where the board has no header row. */
const Label = ({ children }: { children: ReactNode }) => (
  <span className="text-xs text-muted xl:hidden">{children}</span>
)

/** A reading, on the cool tint when it leads its column. */
const Lead = ({
  on,
  off = 'text-ink-2',
  className = 'px-1',
  children,
}: {
  on: boolean
  off?: string
  className?: string
  children: ReactNode
}) => (
  <span className={`rounded-chip ${on ? 'bg-cool-soft text-cool' : off} ${className}`}>
    {children}
  </span>
)

/** The parts of a first answer, by the colour each has in its bar. */
const Legend = ({ className = '' }: { className?: string }) => (
  <span className={`flex flex-wrap gap-x-3.5 gap-y-0.5 text-xs text-muted ${className}`}>
    {SEGMENTS.map((s) => (
      <span key={s.key} className="inline-flex items-center gap-1.5">
        <span aria-hidden="true" className="size-2 rounded-[2px]" style={{ background: s.color }} />
        {s.name}
      </span>
    ))}
  </span>
)

const Head = ({ title, unit, end }: { title: string; unit?: string; end?: boolean }) => (
  <div role="columnheader" className={`flex flex-col gap-1 ${end ? 'items-end' : ''}`}>
    <span className="font-medium text-ink-2">{title}</span>
    {unit && <span className="text-xs text-muted">{unit}</span>}
  </div>
)

/**
 * The compared functions, fastest cold start first, each with every measure of the glance: its
 * init against the baseline's, its first answer by what it waited for, its median and slowest 1%,
 * its warm start, the workload's first run and its memory.
 */
const Board = ({
  rows,
  total,
  onOpen,
}: {
  rows: Row[]
  /** How many functions All results ranks. */
  total: number
  onOpen: (tab: TabId) => void
}) => {
  const baseline = rows.find((r) => r.f.base === BASELINE)
  const maxCold = Math.max(0, ...rows.map((r) => r.x.cold ?? 0))
  const axis = niceMax(Math.max(0, ...rows.map((r) => r.x.trip ?? 0)))
  /** Each column's least, which leads it; none with a single row. */
  const least = Object.fromEntries(
    LED.map((key) => [
      key,
      rows.length > 1 ? Math.min(...rows.flatMap((r) => r.x[key] ?? [])) : undefined,
    ])
  ) as Record<(typeof LED)[number], number | undefined>
  const starts = rows.map((r) => r.x.starts)
  const fewest = Math.min(...starts)
  const most = Math.max(...starts)
  return (
    <div className="overflow-hidden rounded-card border border-rule bg-paper-2">
      <div role="table" aria-labelledby="glance">
        <div
          role="row"
          className={`hidden items-end gap-x-7 border-b border-rule px-6 pt-4 pb-3 text-sm/tight xl:grid ${COLUMNS}`}
        >
          <Head title="Function" />
          <Head title="Cold start" unit={`init, ms · against ${VARIANTS[BASELINE]!.name}`} />
          <div role="columnheader" className="flex min-w-0 flex-col gap-1">
            <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-0.5">
              <span className="font-medium text-ink-2">First answer</span>
              <Legend />
            </div>
            <div className="flex items-baseline gap-3">
              <span
                aria-hidden="true"
                className="measured flex flex-1 justify-between text-xs text-muted"
              >
                {[0, 0.25, 0.5, 0.75, 1].map((t) => (
                  <span key={t}>{(axis * t).toFixed(0)}</span>
                ))}
              </span>
              <span className="w-12 shrink-0 text-right text-xs text-muted">ms</span>
            </div>
          </div>
          <Head title="Spread" unit="median → p99, ms" end />
          <Head title="Warm" unit="ms" end />
          <Head title="Workload" unit="first run, ms" end />
          <Head title="Memory" unit="MB" end />
        </div>
        <Legend className="border-b border-rule px-5 py-3 sm:px-6 xl:hidden" />
        {rows.map((r) => {
          const { f, x } = r
          const release = x.version
            ? versionName(x.version).replace(`${FAMILY_NAMES[f.family]} `, '')
            : undefined
          const times = baseline?.x.cold && x.cold ? baseline.x.cold / x.cold : undefined
          const tail = x.p50 !== undefined && x.p99 !== undefined && x.p99 > TAIL * x.p50
          return (
            <div
              key={f.base}
              role="row"
              className={`grid grid-cols-2 items-center gap-x-7 gap-y-4 border-b border-rule px-5 py-4.5 sm:px-6 md:grid-cols-8 ${COLUMNS}`}
            >
              <div role="rowheader" className={`${HALF} flex min-w-0 items-center gap-3`}>
                <FamilyIcon family={f.family} size={20} />
                <span className="flex min-w-0 flex-col leading-snug">
                  <span className="font-medium text-ink">
                    {FAMILY_NAMES[f.family]}{' '}
                    {release && (
                      <span className="measured text-xs font-normal text-muted">{release}</span>
                    )}
                  </span>
                  <span className="truncate text-sm text-muted" title={f.about}>
                    {f.family === 'Node' && x.runtime.startsWith('nodejs')
                      ? `Lambda’s ${x.runtime}`
                      : shortName(f.base)}
                  </span>
                </span>
              </div>

              <div role="cell" className={`${HALF} flex min-w-0 flex-col gap-2`}>
                <Label>Cold start, ms</Label>
                <div className="flex items-baseline justify-between gap-3">
                  <Lead
                    on={x.cold !== undefined && x.cold === least.cold}
                    off="text-ink"
                    className="measured -ml-1.5 px-1.5 py-0.5 text-2xl/none"
                  >
                    {fixed(x.cold, 1)}
                  </Lead>
                  {r === baseline ? (
                    <span className="text-sm whitespace-nowrap text-muted">the baseline</span>
                  ) : (
                    times !== undefined && (
                      <span className="datum text-sm whitespace-nowrap text-muted">
                        <span className="measured text-ink">
                          {(times >= 1 ? times : 1 / times).toFixed(1)}×
                        </span>{' '}
                        {times >= 1 ? 'faster' : 'slower'}
                      </span>
                    )
                  )}
                </div>
                <div aria-hidden="true" className="h-1.5 rounded-full bg-paper-3">
                  <div
                    className="mark h-full rounded-full"
                    style={{
                      width: `${maxCold > 0 ? ((x.cold ?? 0) / maxCold) * 100 : 0}%`,
                      background: f.color,
                    }}
                  />
                </div>
              </div>

              <div
                role="cell"
                className="col-span-full flex min-w-0 flex-col gap-1.5 xl:col-span-1"
              >
                <Label>First answer, ms</Label>
                <div className="flex items-center gap-3">
                  <span
                    aria-hidden="true"
                    className="flex h-3.5 min-w-0 flex-1 gap-0.5 overflow-hidden rounded-chip bg-paper-3"
                  >
                    {SEGMENTS.filter((s) => (x[s.key] ?? 0) > 0).map((s) => (
                      <span
                        key={s.key}
                        className="mark h-full min-w-0.5"
                        style={{ width: `${(x[s.key]! / axis) * 100}%`, background: s.color }}
                      />
                    ))}
                  </span>
                  <span className="measured w-12 shrink-0 text-right">
                    <Lead on={x.trip !== undefined && x.trip === least.trip}>
                      {fixed(x.trip, 0)}
                    </Lead>
                  </span>
                </div>
                <span className="measured text-xs/tight text-muted">
                  {SEGMENTS.map((s, i) => (
                    <Fragment key={s.key}>
                      {i > 0 && <span aria-hidden="true"> + </span>}
                      <span style={{ color: s.key === 'load' ? 'var(--color-ink-2)' : s.color }}>
                        <span className="sr-only">
                          {i > 0 && ', '}
                          {s.name}{' '}
                        </span>
                        {fixed(x[s.key], 1)}
                      </span>
                    </Fragment>
                  ))}
                </span>
              </div>

              <div role="cell" className={`col-span-full ${STAT}`}>
                <Label>Spread, median → p99, ms</Label>
                <span className="measured whitespace-nowrap text-ink-2">
                  {fixed(x.p50, 1)} →{' '}
                  {tail ? (
                    <span
                      className="rounded-chip bg-bad-soft px-1 text-bad"
                      title={`Its slowest 1% takes over ${TAIL}× its median`}
                    >
                      {fixed(x.p99, 1)}
                    </span>
                  ) : (
                    <Lead on={x.p99 !== undefined && x.p99 === least.p99}>{fixed(x.p99, 1)}</Lead>
                  )}
                </span>
              </div>

              <div role="cell" className={STAT}>
                <Label>Warm, ms</Label>
                <span className="measured max-xl:-ml-1">
                  <Lead on={x.warm !== undefined && x.warm === least.warm}>{fixed(x.warm, 2)}</Lead>
                </span>
              </div>

              <div role="cell" className={STAT}>
                <Label>Workload, first run, ms</Label>
                <span className="measured max-xl:-ml-1">
                  <Lead on={x.workFirst !== undefined && x.workFirst === least.workFirst}>
                    {fixed(x.workFirst, x.workFirst !== undefined && x.workFirst >= 100 ? 0 : 1)}
                  </Lead>
                </span>
              </div>

              <div role="cell" className={STAT}>
                <Label>Memory, MB</Label>
                <span className="measured max-xl:-ml-1">
                  <Lead on={x.mem !== undefined && x.mem === least.mem}>{fixed(x.mem, 1)}</Lead>
                </span>
              </div>
            </div>
          )
        })}
      </div>
      <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-2 px-5 py-3.5 text-sm sm:px-6">
        <p className="datum m-0 text-pretty text-muted">
          Means over each function’s current build:{' '}
          <span className="measured text-ink-2">
            {fewest === most ? fewest : `${fewest} to ${most}`}
          </span>{' '}
          cold starts each.
        </p>
        <a
          href="#results"
          className="datum whitespace-nowrap"
          onClick={(e) => {
            e.preventDefault()
            onOpen('results')
          }}
        >
          All {total} functions →
        </a>
      </div>
    </div>
  )
}

/** A finding's bars, each as long as its value against the longest, named in a column as wide as the longest name. */
const Bars = ({ mark }: { mark: Extract<Mark, { kind: 'bars' }> }) => {
  const max = Math.max(...mark.bars.map((b) => b.value))
  const width = Math.max(...mark.bars.map((b) => b.name.length))
  return (
    <span role="img" aria-label={mark.label} className="flex w-full flex-col gap-2 py-1">
      {mark.bars.map((b) => (
        <span key={b.name} className="flex items-center gap-2.5">
          <span
            className="measured shrink-0 text-xs/none text-muted"
            style={{ width: `${width}ch` }}
          >
            {b.name}
          </span>
          <span className="h-1.5 flex-1 rounded-full bg-paper-3">
            <span
              className="mark block h-full rounded-full"
              style={{ width: `${max > 0 ? (b.value / max) * 100 : 0}%`, background: b.color }}
            />
          </span>
        </span>
      ))}
    </span>
  )
}

/** A finding's lines from zero, each named at its end, over what they start and end at. */
const Lines = ({ mark }: { mark: Extract<Mark, { kind: 'lines' }> }) => {
  const width = 150
  const height = 44
  const max = Math.max(...mark.lines.flatMap((l) => l.values))
  const y = (value: number) => 2 + (1 - (max > 0 ? value / max : 0)) * height
  // Each name beside its line's end, pushed down where two lines end too close for both.
  const names = mark.lines
    .map((l) => ({ name: l.name, y: y(l.values.at(-1)!) }))
    .sort((a, b) => a.y - b.y)
  names.forEach((n, i) => {
    n.y = Math.max(n.y, i ? names[i - 1]!.y + 11 : 4)
  })
  return (
    <svg
      role="img"
      aria-label={mark.label}
      viewBox="0 0 220 62"
      width="220"
      height="62"
      className="max-w-full overflow-visible"
    >
      {mark.lines.map((l) => (
        <polyline
          key={l.name}
          fill="none"
          stroke="var(--color-ink-2)"
          strokeWidth="1.5"
          strokeLinejoin="round"
          strokeLinecap="round"
          points={l.values
            .map((v, i) => `${((i / (l.values.length - 1)) * width).toFixed(1)},${y(v).toFixed(1)}`)
            .join(' ')}
        />
      ))}
      {names.map((n) => (
        <text
          key={n.name}
          x={width + 8}
          y={n.y}
          fontSize="11"
          dominantBaseline="middle"
          className="measured fill-current text-muted"
        >
          {n.name}
        </text>
      ))}
      <text x="0" y="61" fontSize="10" className="measured fill-current text-muted">
        {mark.from}
      </text>
      <text
        x={width}
        y="61"
        fontSize="10"
        textAnchor="end"
        className="measured fill-current text-muted"
      >
        {mark.to}
      </text>
    </svg>
  )
}

const RELATIVE = new Intl.RelativeTimeFormat('en', { numeric: 'auto' })
const UNITS = [
  ['day', 864e5],
  ['hour', 36e5],
  ['minute', 6e4],
  ['second', 1e3],
] as const
/** How often PerfSchedule starts a run (infra/perf.ts). */
const RUN_EVERY_MS = 4 * 36e5

/**
 * When the latest run finished, as how long ago, kept current; the dot turns once a run is missed.
 * It first reads as of `from`, App's `now`, as the prerendered page does, then the visitor's clock.
 */
const LastRun = ({ run, from }: { run: RunPoints; from: number }) => {
  const [now, setNow] = useState(from)
  useEffect(() => {
    setNow(Date.now())
    const id = setInterval(() => setNow(Date.now()), 1e3)
    return () => clearInterval(id)
  }, [])
  const ms = run.date.getTime() - now
  const [unit, size] = UNITS.find(([, size]) => Math.abs(ms) >= size) ?? UNITS.at(-1)!
  return (
    <span
      className="inline-flex items-center gap-2 text-ink-2"
      title={run.finishedAt.replace(/\.\d+Z$/, 'Z')}
    >
      <span
        aria-hidden="true"
        className={`size-1.5 shrink-0 rounded-full ${-ms > 2 * RUN_EVERY_MS ? 'bg-bad' : 'bg-ok'}`}
      />
      <span>
        Last run{' '}
        <time dateTime={run.finishedAt}>{RELATIVE.format(Math.trunc(ms / size), unit)}</time>
      </span>
    </span>
  )
}

/**
 * The page's answer before any tab: LLRT without the SDK, Node.js 24, Bun on a customer-managed
 * runtime and Bun's trimmed AOT executable on one board, on arm64 at 256 MB, over their current
 * builds whatever the toolbar picks, and under it a finding from each tab that opens it.
 */
export const Glance = ({
  runs,
  figures,
  findings,
  now,
  onOpen,
}: {
  runs: RunPoints[]
  /** Over each function's current build. */
  figures: Map<string, Figures>
  findings: Finding[]
  now: number
  onOpen: (tab: TabId) => void
}) => {
  const latest = runs.at(-1)
  if (!latest) return null
  const rows = compared(latest.functions)
    .flatMap((f) => {
      const x = figures.get(f.id)
      return x ? [{ f, x }] : []
    })
    .sort((a, b) => (a.x.cold ?? Infinity) - (b.x.cold ?? Infinity))
  if (!rows.length) return null
  const total = latest.functions.filter(
    (f) => !f.web && !f.microvm && f.arch === GLANCE.arch && f.memoryMb === GLANCE.memoryMb
  ).length
  return (
    <section aria-labelledby="glance" className="flex flex-col gap-5">
      <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1">
        <h2 id="glance" className="text-xl">
          At a glance
        </h2>
        <p className="measured m-0 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted">
          <span>
            {GLANCE.arch} · {GLANCE.memoryMb} MB · current builds
          </span>
          <LastRun run={latest} from={now} />
        </p>
      </div>
      <Board rows={rows} total={total} onOpen={onOpen} />
      {findings.length > 0 && (
        <ul className="m-0 grid list-none grid-cols-[repeat(auto-fit,minmax(min(16rem,100%),1fr))] gap-3 p-0">
          {findings.map((f) => (
            <li key={f.tab} className="flex">
              <button
                type="button"
                onClick={() => onOpen(f.tab)}
                className="flex w-full cursor-pointer flex-col items-start gap-2 rounded-card border border-rule-2 bg-paper p-5 text-left transition-colors duration-(--dur-short) hover:bg-paper-2"
              >
                <span className="text-xs font-medium text-cool">
                  {TABS.find((t) => t.id === f.tab)!.label} →
                </span>
                <span className="datum font-medium text-pretty text-ink">{f.title}</span>
                <span className="measured text-xl text-ink">{f.figure}</span>
                {f.mark?.kind === 'bars' && <Bars mark={f.mark} />}
                {f.mark?.kind === 'lines' && <Lines mark={f.mark} />}
                <span className="datum mt-auto text-sm text-pretty text-muted">{f.sub}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
