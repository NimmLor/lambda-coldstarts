import { useEffect, useState } from 'react'
import {
  FAMILY_NAMES,
  type Figures,
  type Fn,
  fixed,
  type RunPoints,
  shortName,
  versionName,
} from './data'
import { type Finding, GLANCE } from './findings'
import { TABS, type TabId } from './tabs'
import { FamilyIcon } from './ui'

/** What every panel measures the leader against: the newest Node.js out of preview. */
const BASELINE = 'Node24'

/** The functions every panel compares, by variant. */
const COMPARED = ['Llrt', BASELINE, 'BunRuntimeCmr', 'BunCompileAotTrim']

type Key = 'cold' | 'trip' | 'mem' | 'p99'
const PANELS: { key: Key; title: string; unit: string; digits: number; better: string }[] = [
  { key: 'cold', title: 'Cold start', unit: 'ms', digits: 1, better: 'faster' },
  // How long a caller waits for a fresh instance's answer, loading its code included.
  { key: 'trip', title: 'First answer', unit: 'ms', digits: 0, better: 'faster' },
  { key: 'mem', title: 'Memory used', unit: 'MB', digits: 1, better: 'less' },
  // Over every cold start of the current builds, not a mean of each run's.
  { key: 'p99', title: 'Slowest 1%', unit: 'ms, p99', digits: 1, better: 'faster' },
]

type Row = { f: Fn; value: number }

const rowsOf = (key: Key, fns: Fn[], figures: Map<string, Figures>): Row[] =>
  fns
    .flatMap((f) => {
      const value = figures.get(f.id)?.[key]
      return value === undefined ? [] : [{ f, value }]
    })
    .sort((a, b) => a.value - b.value)

/**
 * Node.js by the exact release it ran, e.g. `Node.js 24.22.3`; anything else by its name, with its
 * short one when that says more, e.g. `LLRT, no SDK`.
 */
const nameOf = (f: Fn, figures: Map<string, Figures>) => {
  const version = figures.get(f.id)?.version
  if (f.family === 'Node' && version) return versionName(version)
  return f.short ? `${f.name}, ${f.short}` : f.name
}

/** A function under its family's name: Node.js by its release, e.g. `24.22.3`; the rest by build. */
const subOf = (f: Fn, figures: Map<string, Figures>) =>
  f.family === 'Node' ? nameOf(f, figures).replace(`${FAMILY_NAMES.Node} `, '') : shortName(f.base)

const Panel = ({
  panel: p,
  fns,
  figures,
}: {
  panel: (typeof PANELS)[number]
  fns: Fn[]
  figures: Map<string, Figures>
}) => {
  const rows = rowsOf(p.key, fns, figures)
  const max = Math.max(0, ...rows.map((r) => r.value))
  const leader = rows[0]
  const baseline = rows.find((r) => r.f.base === BASELINE)
  return (
    <article className="flex min-w-0 flex-col gap-4 bg-paper-2 p-5 sm:p-6">
      <div className="flex items-baseline justify-between gap-3 text-sm text-muted">
        <h3 className="text-lg">{p.title}</h3>
        {p.unit}
      </div>
      <dl className="m-0 flex flex-col gap-3.5">
        {rows.map((r) => (
          <div key={r.f.base} className="flex flex-col gap-1.5">
            <div className="flex items-center justify-between gap-3">
              <dt className="flex min-w-0 items-center gap-2">
                <FamilyIcon family={r.f.family} />
                <span className="flex min-w-0 flex-col leading-tight">
                  <span className="text-sm font-medium text-ink">{FAMILY_NAMES[r.f.family]}</span>
                  <span className="truncate text-xs text-muted" title={r.f.about}>
                    {subOf(r.f, figures)}
                  </span>
                </span>
              </dt>
              <dd
                className={`measured m-0 text-md whitespace-nowrap ${r === leader ? 'rounded-chip bg-cool-soft px-1 text-cool' : 'text-ink-2'}`}
              >
                {fixed(r.value, p.digits)}
              </dd>
            </div>
            <div aria-hidden="true" className="h-1.5 rounded-full bg-paper-3">
              <div
                className="mark h-full rounded-full"
                style={{ width: `${max > 0 ? (r.value / max) * 100 : 0}%`, background: r.f.color }}
              />
            </div>
          </div>
        ))}
      </dl>
      <p className="datum mt-auto text-sm text-muted">
        {leader && baseline && leader !== baseline ? (
          <>
            <span className="text-ink">{nameOf(leader.f, figures)}</span>{' '}
            <span className="measured text-ink">{(baseline.value / leader.value).toFixed(1)}×</span>{' '}
            {p.better} than {nameOf(baseline.f, figures)}
          </>
        ) : (
          leader && (
            <>
              <span className="text-ink">{nameOf(leader.f, figures)}</span> leads
            </>
          )
        )}
      </p>
    </article>
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
 * runtime and Bun's trimmed AOT executable side by side on arm64 at 256 MB, over their current
 * builds whatever the toolbar picks, and under them a finding from each tab that opens it.
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
  const fns = latest.functions.filter(
    (f) => COMPARED.includes(f.base) && f.arch === GLANCE.arch && f.memoryMb === GLANCE.memoryMb
  )
  if (!fns.length) return null
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
      <div className="grid grid-cols-1 gap-px overflow-hidden rounded-card border border-rule bg-rule sm:grid-cols-2 lg:grid-cols-4">
        {PANELS.map((p) => (
          <Panel key={p.key} panel={p} fns={fns} figures={figures} />
        ))}
      </div>
      {findings.length > 0 && (
        <ul className="m-0 grid list-none grid-cols-1 gap-3 p-0 sm:grid-cols-2 lg:grid-cols-4">
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
                <span className="datum text-sm text-pretty text-muted">{f.sub}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
