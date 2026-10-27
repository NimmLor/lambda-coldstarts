import { type ReactNode, useCallback, useEffect, useState } from 'react'
import { Chart, type Metric } from './Chart'
import {
  type Family,
  ORDER,
  type Run,
  type RunPoints,
  type Stat,
  VARIANTS,
  type View,
  day,
  mean,
  toPoints,
} from './data'
import { Table } from './Table'

const REPO = 'https://github.com/NimmLor/bun-aot-lambda'
/** PerfApi, behind the same CloudFront distribution; see infra/perf.ts and dev.ts. */
const API = '/api'
const DAY_MS = 864e5
const RANGES = [14, 30, 90]

const METRICS: Metric[] = [
  { key: 'cold', title: 'Cold start', unit: 'ms', height: 300, leader: 'Fastest' },
  { key: 'warm', title: 'Warm start', unit: 'ms', height: 180, leader: 'Fastest' },
  { key: 'mem', title: 'Memory', unit: 'MB', height: 180, leader: 'Lowest' },
  { key: 'dur', title: 'Duration', unit: 'ms', height: 180, leader: 'Fastest' },
]

/** The page's one column: capped and centred, its gutters growing past 1440. */
const WRAP = 'mx-auto w-full max-w-(--container) px-(--gutter)'

const Segmented = <T extends string | number>({
  label,
  options,
  value,
  onPick,
  text = String,
}: {
  label: string
  options: readonly T[]
  value: T | undefined
  onPick: (v: T) => void
  text?: (v: T) => string
}) => (
  <div className="flex flex-col gap-2">
    <span className="text-sm font-medium text-muted">{label}</span>
    <div className="cells" role="group" aria-label={label}>
      {options.map((v) => (
        <button key={v} type="button" aria-pressed={v === value} onClick={() => onPick(v)}>
          {text(v)}
        </button>
      ))}
    </div>
  </div>
)

const Header = ({ latest }: { latest?: RunPoints }) => {
  const variants = new Set(latest?.functions.map((f) => f.base))
  const count = (family: Family) => [...variants].filter((b) => VARIANTS[b]?.family === family).length
  return (
    <header className={`${WRAP} grid gap-x-8 gap-y-6 pt-10 pb-10 sm:pt-16 lg:grid-cols-12 lg:items-end`}>
      <h1 className="text-3xl lg:col-span-12">Bun vs Node.js cold start benchmark</h1>
      <p className="max-w-prose text-lg/normal text-pretty text-ink-2 lg:col-span-8">
        {latest
          ? `${count('Bun')} ways to ship Bun against ${count('Node')} Node.js runtimes on AWS Lambda, with ${latest.rounds} cold starts per function every day. `
          : 'On AWS Lambda, updated daily. '}
        The charts plot each run’s mean. The table below shows the mean over the selected range.
      </p>
      <nav className="flex flex-col gap-1.5 text-sm lg:col-span-4 lg:items-end">
        <a href={`${REPO}#scheduled-runs-like-lambda-perf`}>How does it work</a>
        <a href={REPO}>Source on GitHub</a>
        <span className="text-muted">
          Inspired by{' '}
          <a className="whitespace-nowrap" href="https://github.com/maxday/lambda-perf">
            maxday/lambda-perf
          </a>
        </span>
      </nav>
    </header>
  )
}

/** A fact of the latest run, parted from its neighbour by a hairline. */
const Fact = ({ term, children }: { term: string; children: ReactNode }) => (
  <div className="flex flex-col gap-1 border-l border-rule px-6 first:border-l-0 first:pl-0">
    <dt className="text-xs text-muted">{term}</dt>
    <dd className="measured m-0 text-sm text-ink">{children}</dd>
  </div>
)

/** The first load, in the shape of the toolbar, the cold start chart and the board. */
const Skeleton = () => (
  <div aria-busy="true" aria-label="Loading runs" className={`${WRAP} flex flex-col gap-6`}>
    <div className="skeleton h-28" />
    <div className="skeleton h-96" />
    <div className="flex flex-col gap-2">
      {[0, 1, 2, 3].map((i) => (
        <div key={i} className="skeleton h-14" />
      ))}
    </div>
  </div>
)

export const App = () => {
  /** Oldest first. */
  const [history, setHistory] = useState<RunPoints[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string>()
  const [family, setFamily] = useState<Family | 'All'>()
  const [arch, setArch] = useState('arm64')
  // One full vCPU, and the only size before there were more.
  const [memory, setMemory] = useState(1769)
  const [range, setRange] = useState(30)
  const [hover, setHover] = useState<number>()
  const [focus, setFocus] = useState<string>()
  const [hidden, setHidden] = useState(new Set<string>())

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const response = await fetch(`${API}/runs/history?limit=${Math.max(...RANGES)}`)
      if (!response.ok) throw new Error(`/runs/history: ${response.status}`)
      const { runs } = (await response.json()) as { runs: Run[] }
      setHistory(runs.map(toPoints).reverse())
      setError(undefined)
    } catch (e) {
      setError(String(e))
    } finally {
      setLoading(false)
    }
  }, [])
  useEffect(() => void load(), [load])

  const latest = history.at(-1)

  const showFamily = (f: Family | 'All') => {
    setFamily(f)
    setHidden(new Set(ORDER.filter((base) => f !== 'All' && VARIANTS[base]!.family !== f)))
  }
  const toggle = (base: string) => {
    const next = new Set(hidden)
    if (!next.delete(base)) next.add(base)
    setHidden(next)
    setFamily(undefined)
  }

  const dashboard = (latest: RunPoints) => {
    const archs = [...new Set(latest.functions.map((f) => f.arch))].sort()
    const shownArch = archs.includes(arch) ? arch : archs[0]!
    const memories = [...new Set(latest.functions.map((f) => f.memoryMb))].sort((a, b) => a - b)
    const shownMemory = memories.includes(memory) ? memory : memories.at(-1)!
    const since = latest.date.getTime() - range * DAY_MS
    const runs = history.filter((r) => r.date.getTime() > since)
    const hovered = hover !== undefined && hover < runs.length ? hover : undefined
    const fns = latest.functions
      .filter((f) => f.arch === shownArch && f.memoryMb === shownMemory)
      .sort((a, b) => (ORDER.indexOf(a.base) >>> 0) - (ORDER.indexOf(b.base) >>> 0))
    const visible = fns.filter((f) => !hidden.has(f.base))
    const view: View = {
      runs,
      latest,
      fns,
      shown: visible.length ? visible : fns,
      hidden,
      hover: hovered,
      focus,
      agg: (f, key: Stat) =>
        hovered !== undefined
          ? runs[hovered]!.points.get(f.id)?.[key]
          : mean(runs.map((r) => r.points.get(f.id)?.[key])),
      setHover,
      setFocus,
      toggle,
    }

    return (
      <>
        <section className={`${WRAP} flex flex-col gap-6`}>
          <div className="flex flex-col gap-5 rounded-card border border-rule bg-paper-2 p-5 sm:p-6">
            <div className="flex flex-wrap items-end gap-x-8 gap-y-4">
              <Segmented label="Show" options={['All', 'Bun', 'Node'] as const} value={family} onPick={showFamily} />
              <Segmented
                label="Arch"
                options={archs}
                value={shownArch}
                onPick={(a) => {
                  setArch(a)
                  setHover(undefined)
                }}
              />
              <Segmented
                label="Memory"
                options={memories}
                value={shownMemory}
                text={(mb) => `${mb} MB`}
                onPick={(mb) => {
                  setMemory(mb)
                  setHover(undefined)
                }}
              />
              <Segmented
                label="Range"
                options={RANGES}
                value={range}
                text={(r) => `${r}d`}
                onPick={(r) => {
                  setRange(r)
                  setHover(undefined)
                }}
              />
              <button type="button" onClick={load} aria-busy={loading} className="btn btn--primary hit relative sm:ml-auto">
                {loading ? 'Refreshing…' : 'Refresh'}
              </button>
            </div>
            <dl className="m-0 flex flex-wrap gap-y-4 border-t border-rule pt-4">
              <Fact term="Last run">{latest.finishedAt.replace(/\.\d+Z$/, 'Z')}</Fact>
              <Fact term="Rounds">{latest.rounds}</Fact>
              <Fact term="Functions">
                {new Set(latest.functions.map((f) => f.base)).size} on {archs.length} architectures ×{' '}
                {memories.length} memory sizes
              </Fact>
            </dl>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3">
            <div className="flex flex-wrap gap-2">
              {fns.map((f) => {
                const on = !hidden.has(f.base)
                return (
                  <button
                    key={f.id}
                    type="button"
                    aria-pressed={on}
                    onClick={() => toggle(f.base)}
                    onMouseEnter={() => on && setFocus(f.base)}
                    onMouseLeave={() => setFocus(undefined)}
                    className="hit relative inline-flex min-h-9 cursor-pointer items-center gap-2 rounded-pill border border-rule px-2.5 text-sm font-medium text-muted hover:border-rule-2 hover:text-ink-2 active:translate-y-px aria-pressed:border-rule-2 aria-pressed:bg-paper-2 aria-pressed:text-ink"
                  >
                    <span
                      aria-hidden="true"
                      className="size-2.5 shrink-0 rounded-full border-2"
                      style={{ borderColor: f.color, background: on ? f.color : 'transparent' }}
                    />
                    {f.name}
                  </button>
                )
              })}
            </div>
            <div className="flex gap-5 text-sm text-muted">
              {(['Bun', 'Node.js'] as const).map((name) => (
                <span key={name} className="inline-flex items-center gap-2">
                  <svg aria-hidden="true" width="24" height="4" className="stroke-ink-2">
                    <line x1="0" x2="24" y1="2" y2="2" strokeWidth="2" strokeDasharray={name === 'Bun' ? undefined : '5 4'} />
                  </svg>
                  {name}
                </span>
              ))}
            </div>
          </div>

          <div onMouseLeave={() => setHover(undefined)} className="grid grid-cols-1 gap-px overflow-hidden rounded-card border border-rule bg-rule md:grid-cols-3">
            {METRICS.map((m, i) => (
              <Chart key={m.key} metric={m} wide={i === 0} view={view} />
            ))}
          </div>
        </section>

        <section className="band mt-16 py-12 sm:py-16">
          <div className={`${WRAP} flex flex-col gap-8`}>
            <div className="flex flex-wrap items-end justify-between gap-x-8 gap-y-3">
              <h2 className="text-2xl">
                {hovered !== undefined ? `Run of ${day(runs[hovered]!.date)}` : `${range}-day mean`}
              </h2>
              <p className="max-w-prose text-sm text-muted">
                Ticks are the {(hovered !== undefined ? runs[hovered]! : latest).rounds} cold starts of{' '}
                {hovered !== undefined ? 'that' : 'the latest'} run. Warm is {latest.rounds} ×{' '}
                {latest.warmInvocations ?? '—'} invocations. Click a row to hide it.
              </p>
            </div>
            <Table view={view} />
          </div>
        </section>
      </>
    )
  }

  /** What stands in for the dashboard until there is a run to show. */
  const pending = () => {
    if (loading && !error) return <Skeleton />
    return (
      <div className={WRAP}>
        <div
          role={error ? 'alert' : undefined}
          className="flex flex-col items-start gap-4 rounded-card border border-rule bg-paper-2 p-6"
        >
          <h2 className="text-lg">{error ? 'The runs didn’t load' : 'No runs yet.'}</h2>
          {error && <p className="measured text-sm text-bad">{error}</p>}
          <button type="button" onClick={load} aria-busy={loading} className="btn btn--primary hit relative">
            {loading ? 'Refreshing…' : 'Refresh'}
          </button>
        </div>
      </div>
    )
  }

  return (
    <main>
      <Header latest={latest} />
      {latest ? dashboard(latest) : pending()}
      <footer className={`${WRAP} flex flex-col gap-6 pt-12 pb-16 text-sm text-muted ${latest ? '' : 'mt-16'}`}>
        <dl className="m-0 grid gap-x-8 gap-y-3 sm:grid-cols-[max-content_minmax(0,1fr)]">
          <dt className="font-medium text-ink">Cold start</dt>
          <dd className="m-0">Lambda init duration</dd>
          <dt className="font-medium text-ink">Warm start</dt>
          <dd className="m-0">handler duration on an already-initialised instance</dd>
          <dt className="font-medium text-ink">Duration</dt>
          <dd className="m-0">handler duration of the cold invocation</dd>
          <dt className="font-medium text-ink">Memory</dt>
          <dd className="m-0">max memory used</dd>
          <dt className="font-medium text-ink">Size</dt>
          <dd className="m-0">deployed code size</dd>
        </dl>
        <p className="max-w-prose">
          Compiled builds also pass <code>--target=bun-linux-{'<arch>'}</code>, <code>--no-compile-autoload-dotenv</code>{' '}
          and <code>--no-compile-autoload-bunfig</code>; “canary Bun” is the Bun build that <code>--trim</code> and{' '}
          <code>--aot</code> need.
        </p>
        <a href={REPO} className="self-start">
          NimmLor/bun-aot-lambda
        </a>
      </footer>
    </main>
  )
}
