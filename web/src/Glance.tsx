import { ARCH_SECTION } from './Architectures'
import { type Fn, fixed, mean, type RunPoints } from './data'
import bunIcon from './icons/bun.svg'
import llrtIcon from './icons/llrt.svg'
import nodeIcon from './icons/nodejs.svg'

const ICONS = { Bun: bunIcon, LLRT: llrtIcon, Node: nodeIcon }
const DAY_MS = 864e5

const ARCH = 'arm64'
const MEMORY_MB = 256
const DAYS = 3
/** The ones compared, in the order every panel lists them, with names short enough for a quarter of the page. */
const CONTENDERS: { base: string; name: string; memoryMb?: number }[] = [
  { base: 'Llrt', name: 'LLRT' },
  { base: 'BunCompileAotTrim', name: 'Bun AOT, trimmed' },
  { base: 'Node24', name: 'Node.js 24' },
  // At the one size every Web Function has.
  { base: 'Node24Web', name: 'Node.js 24, Web Function', memoryMb: 2048 },
  // At Lambda's default size, the same as the Web Function's.
  { base: 'Node24MicroVm', name: 'Node.js 24, MicroVM', memoryMb: 2048 },
]
/** What each leader is measured against: the newest Node.js Lambda runs without a preview. */
const BASELINE = 'Node24'

type Key = 'cold' | 'trip' | 'warm' | 'mem'
const METRICS: {
  key: Key
  title: string
  unit: string
  digits: number
  better: string
  /** A MicroVM has neither an init nor warm invocations, so it's left out rather than shown missing. */
  microvm: boolean
}[] = [
  { key: 'cold', title: 'Cold start', unit: 'ms', digits: 1, better: 'faster', microvm: false },
  // How long a caller waits for a fresh instance's answer, the one number every kind has.
  { key: 'trip', title: 'First answer', unit: 'ms', digits: 0, better: 'faster', microvm: true },
  { key: 'warm', title: 'Warm start', unit: 'ms', digits: 2, better: 'faster', microvm: false },
  { key: 'mem', title: 'Memory used', unit: 'MB', digits: 1, better: 'less', microvm: true },
]

type Row = { fn: Fn; name: string; values: Record<Key, number | undefined> }

const Panel = ({ metric: m, rows: all }: { metric: (typeof METRICS)[number]; rows: Row[] }) => {
  const rows = m.microvm ? all : all.filter((r) => !r.fn.microvm)
  const present = rows.filter((r) => r.values[m.key] !== undefined)
  const max = Math.max(0, ...present.map((r) => r.values[m.key]!))
  const leader = present.toSorted((a, b) => a.values[m.key]! - b.values[m.key]!)[0]
  const baseline = rows.find((r) => r.fn.base === BASELINE)?.values[m.key]
  const ratio = leader && baseline !== undefined ? baseline / leader.values[m.key]! : undefined

  return (
    <article className="flex min-w-0 flex-col gap-4 bg-paper-2 p-5 sm:p-6">
      <div className="flex items-baseline justify-between gap-3 text-sm text-muted">
        <h3 className="text-lg">{m.title}</h3>
        {m.unit}
      </div>
      <dl className="m-0 flex flex-col gap-3">
        {rows.map((r) => {
          const v = r.values[m.key]
          const isLeader = r === leader
          return (
            <div key={r.fn.base} className="flex flex-col gap-1.5">
              <div className="flex items-baseline justify-between gap-3">
                <dt className="flex min-w-0 items-center gap-2 text-sm font-medium text-ink">
                  <img
                    src={ICONS[r.fn.family]}
                    alt=""
                    width={16}
                    height={16}
                    className="block shrink-0 self-center"
                  />
                  {r.name}
                </dt>
                <dd
                  className={`measured m-0 text-md whitespace-nowrap ${isLeader ? 'rounded-chip bg-cool-soft px-1 text-cool' : 'text-ink-2'}`}
                >
                  {fixed(v, m.digits)}
                </dd>
              </div>
              <div aria-hidden="true" className="h-1.5 rounded-full bg-paper-3">
                {v !== undefined && max > 0 && (
                  <div
                    className="h-full rounded-full"
                    style={{
                      width: `${(v / max) * 100}%`,
                      background: r.fn.color,
                    }}
                  />
                )}
              </div>
            </div>
          )
        })}
      </dl>
      <p className="mt-auto text-sm text-muted">
        {leader && ratio !== undefined && leader.fn.base !== BASELINE ? (
          <>
            <span className="text-ink">{leader.name}</span>{' '}
            <span className="measured text-ink">{ratio.toFixed(1)}×</span> {m.better} than Node.js
            24
          </>
        ) : (
          leader && (
            <>
              <span className="text-ink">{leader.name}</span> leads
            </>
          )
        )}
      </p>
    </article>
  )
}

/**
 * How many times faster arm64 starts than x86_64, cold or warm, over every function that runs on
 * both: each one's x86_64 time over its arm64 one at the same memory size, averaged geometrically,
 * as ratios are. Undefined without such a pair.
 */
const archRatio = (runs: RunPoints[], functions: Fn[], key: 'cold' | 'warm') => {
  const logs = functions.flatMap((arm) => {
    if (arm.arch !== 'arm64') return []
    const x86 = functions.find(
      (f) => f.arch === 'x86_64' && f.base === arm.base && f.memoryMb === arm.memoryMb
    )
    if (!x86) return []
    const armTime = mean(runs.map((r) => r.points.get(arm.id)?.[key]))
    const x86Time = mean(runs.map((r) => r.points.get(x86.id)?.[key]))
    return armTime && x86Time ? [Math.log(x86Time / armTime)] : []
  })
  return logs.length ? Math.exp(logs.reduce((sum, l) => sum + l, 0) / logs.length) : undefined
}

/** A ratio as its stat: arm64's bar against x86_64's, the slower one full width. */
const ArchFigure = ({ label, ratio }: { label: string; ratio: number }) => {
  const slower = Math.max(1, 1 / ratio)
  const bars = [
    ['arm64', 1 / ratio / slower, 'bg-cool'],
    ['x86_64', 1 / slower, 'bg-muted'],
  ] as const
  return (
    <article className="flex min-w-0 flex-col gap-3 bg-paper-2 p-5 sm:p-6">
      <h4 className="text-sm text-ink-2">{label}</h4>
      <p className="m-0 flex items-baseline gap-2">
        <span className="measured text-2xl text-ink">
          {(ratio >= 1 ? ratio : 1 / ratio).toFixed(2)}×
        </span>
        <span className="text-sm text-muted">{ratio >= 1 ? 'faster' : 'slower'} on arm64</span>
      </p>
      <dl className="m-0 grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-3 gap-y-1.5">
        {bars.map(([arch, width, color]) => (
          <div key={arch} className="contents">
            <dt className="measured text-xs text-muted">{arch}</dt>
            <dd className="m-0 h-1.5 rounded-full bg-paper-3">
              <div
                className={`h-full rounded-full ${color}`}
                style={{ width: `${width * 100}%` }}
              />
            </dd>
          </div>
        ))}
      </dl>
    </article>
  )
}

/** A row under the panels: arm64's cold and warm starts against x86_64's, over every function. */
const Architectures = ({ runs, functions }: { runs: RunPoints[]; functions: Fn[] }) => {
  const figures = [
    ['Cold starts', archRatio(runs, functions, 'cold')],
    ['Warm starts', archRatio(runs, functions, 'warm')],
  ] as const
  if (figures.every(([, ratio]) => ratio === undefined)) return null
  return (
    <div className="col-span-full grid grid-cols-1 gap-px bg-rule sm:grid-cols-2 lg:grid-cols-4">
      <div className="flex flex-col gap-2 bg-paper-2 p-5 sm:col-span-2 sm:p-6">
        <h3 className="text-lg">arm64 vs. x86_64</h3>
        <p className="m-0 max-w-prose text-sm text-pretty text-muted">
          How every function starts on arm64 against x86_64, cold and warm, across every memory
          size. Web Functions and MicroVMs run on arm64 only.
        </p>
        {/* A line of its own, so it never breaks across two. */}
        <a href={`#${ARCH_SECTION}`} className="mt-auto self-start text-sm">
          Each size and runtime
        </a>
      </div>
      {figures.map(
        ([label, ratio]) =>
          ratio !== undefined && <ArchFigure key={label} label={label} ratio={ratio} />
      )}
    </div>
  )
}

/**
 * LLRT, Bun's trimmed AOT executable, Node.js 24, and Node.js 24 as a Web Function and in a
 * MicroVM side by side, whatever the dashboard below shows, and under them arm64 against x86_64.
 */
export const Glance = ({ history }: { history: RunPoints[] }) => {
  const latest = history.at(-1)
  if (!latest) return null
  const since = latest.date.getTime() - DAYS * DAY_MS
  const runs = history.filter((r) => r.date.getTime() > since)
  const rows: Row[] = CONTENDERS.flatMap(({ base, name, memoryMb = MEMORY_MB }) => {
    const fn = latest.functions.find((f) => f.id === `${base}/${ARCH}/${memoryMb}`)
    if (!fn) return []
    const avg = (key: Key) => mean(runs.map((r) => r.points.get(fn.id)?.[key]))
    return [
      {
        fn,
        name,
        values: {
          cold: avg('cold'),
          trip: avg('trip'),
          warm: avg('warm'),
          mem: avg('mem'),
        },
      },
    ]
  })
  if (rows.length < 2) return null

  return (
    <section aria-labelledby="glance" className="flex flex-col gap-5">
      <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1">
        <h2 id="glance" className="text-xl">
          At a glance
        </h2>
        <p className="measured text-sm text-muted">
          {ARCH} · {MEMORY_MB} MB · {DAYS}-day mean
          {rows.some((r) => r.fn.web) && ' · Web Function at 2 GB'}
          {rows.some((r) => r.fn.microvm) && ' · MicroVM at 2 GB'}
        </p>
      </div>
      <div className="grid grid-cols-1 gap-px overflow-hidden rounded-card border border-rule bg-rule sm:grid-cols-2 lg:grid-cols-4">
        {METRICS.map((m) => (
          <Panel key={m.key} metric={m} rows={rows} />
        ))}
        <Architectures runs={runs} functions={latest.functions} />
      </div>
    </section>
  )
}
