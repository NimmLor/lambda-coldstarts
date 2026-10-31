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
]
/** What each leader is measured against: the newest Node.js Lambda runs without a preview. */
const BASELINE = 'Node24'

type Key = 'cold' | 'warm' | 'mem' | 'size'
const METRICS: {
  key: Key
  title: string
  unit: string
  digits: number
  better: string
}[] = [
  { key: 'cold', title: 'Cold start', unit: 'ms', digits: 1, better: 'faster' },
  { key: 'warm', title: 'Warm start', unit: 'ms', digits: 2, better: 'faster' },
  { key: 'mem', title: 'Memory used', unit: 'MB', digits: 1, better: 'less' },
  { key: 'size', title: 'Size', unit: 'MB', digits: 1, better: 'smaller' },
]

type Row = { fn: Fn; name: string; values: Record<Key, number | undefined> }

const Panel = ({ metric: m, rows }: { metric: (typeof METRICS)[number]; rows: Row[] }) => {
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
 * LLRT, Bun's trimmed AOT executable, Node.js 24 and Node.js 24 as a Web Function side by side,
 * whatever the dashboard below shows.
 */
export const Glance = ({ history }: { history: RunPoints[] }) => {
  const latest = history.at(-1)
  if (!latest) return null
  const since = latest.date.getTime() - DAYS * DAY_MS
  const runs = history.filter((r) => r.date.getTime() > since)
  const rows: Row[] = CONTENDERS.flatMap(({ base, name, memoryMb = MEMORY_MB }) => {
    const fn = latest.functions.find((f) => f.id === `${base}/${ARCH}/${memoryMb}`)
    if (!fn) return []
    // Node.js functions report no code size: 0, which the table shows as missing too.
    const avg = (key: Key) => mean(runs.map((r) => r.points.get(fn.id)?.[key] || undefined))
    return [
      {
        fn,
        name,
        values: {
          cold: avg('cold'),
          warm: avg('warm'),
          mem: avg('mem'),
          size: avg('size'),
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
        </p>
      </div>
      <div className="grid grid-cols-1 gap-px overflow-hidden rounded-card border border-rule bg-rule sm:grid-cols-2 lg:grid-cols-4">
        {METRICS.map((m) => (
          <Panel key={m.key} metric={m} rows={rows} />
        ))}
      </div>
    </section>
  )
}
